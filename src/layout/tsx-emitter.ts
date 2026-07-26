/**
 * Emit one complete styled-components React module from layout IR.
 */

import { formatJsxChildren } from '../codegen';
import { toComponentName } from './naming';
import {
  createStyledRegistry,
  renderStyledDefinitions,
  type StyledRegistry,
  usesColorTokens,
} from './styled-components-emitter';
import type {
  CompositionNode,
  ComponentCompositionNode,
  ComponentImport,
  ContainerCompositionNode,
  LayoutDocument,
  PlaceholderCompositionNode,
  TextCompositionNode,
} from './types';

export const COMPONENT_LIBRARY_PATH = '@tashilcar/swiss-army-knife';

type ImportAliases = Map<string, string>;

export type RenderedTsx = {
  componentName: string;
  tsx: string;
};

export function renderTsx(document: LayoutDocument): RenderedTsx {
  const imports = collectImports(document.root);
  const importedNames = unique(imports.map(({ importedName }) => importedName));
  const baseComponentName = toComponentName(document.name);
  const componentName = importedNames.includes(baseComponentName)
    ? `${baseComponentName}Layout`
    : baseComponentName;
  const styled = createStyledRegistry(
    document.root,
    componentName,
    importedNames,
  );
  const hasColorTokens = usesColorTokens(styled.definitions);
  const styledNames = new Set(styled.definitions.map(({ name }) => name));
  const aliases = createImportAliases(importedNames, new Set([
    'styled',
    ...(hasColorTokens ? ['colors'] : []),
    componentName,
    ...styledNames,
  ]));
  const importBlock = renderComponentImport(importedNames, aliases);
  const styledBlock = renderStyledDefinitions(styled.definitions);
  const renderedRoot = renderNode(document.root, 0, aliases, styled);
  const body = document.root.kind === 'text' || document.root.kind === 'placeholder'
    ? ['<>', indent(renderedRoot, 2), '</>'].join('\n')
    : renderedRoot;
  const header = [
    ...(styled.definitions.length > 0
      ? ['import styled from "styled-components";']
      : []),
    ...(hasColorTokens
      ? ["import colors from 'styles/colors';"]
      : []),
    ...(importBlock ? [importBlock] : []),
  ];

  return {
    componentName,
    tsx: [
      ...header,
      ...(header.length > 0 ? [''] : []),
      ...(styledBlock ? [styledBlock, ''] : []),
      `export function ${componentName}() {`,
      '  return (',
      indent(body, 4),
      '  );',
      '}',
      '',
    ].join('\n'),
  };
}

function collectImports(node: CompositionNode): ComponentImport[] {
  if (node.kind === 'component') {
    return [...node.usage.imports];
  }
  if (node.kind !== 'container') {
    return [];
  }
  return node.children.flatMap(collectImports);
}

function createImportAliases(
  importedNames: readonly string[],
  reserved: ReadonlySet<string>,
): ImportAliases {
  const aliases: ImportAliases = new Map();
  const used = new Set(reserved);

  for (const importedName of importedNames) {
    let localName = importedName;
    if (used.has(localName)) {
      const base = `SwissArmy${toComponentName(importedName)}`;
      localName = base;
      let suffix = 2;
      while (used.has(localName)) {
        localName = `${base}${suffix}`;
        suffix += 1;
      }
    }
    used.add(localName);
    aliases.set(importedName, localName);
  }

  return aliases;
}

function renderComponentImport(
  importedNames: readonly string[],
  aliases: ImportAliases,
): string {
  if (importedNames.length === 0) {
    return '';
  }

  const specifiers = importedNames.map((importedName) => {
    const localName = aliases.get(importedName) ?? importedName;
    return localName === importedName
      ? importedName
      : `${importedName} as ${localName}`;
  });

  return `import { ${specifiers.join(', ')} } from ${JSON.stringify(COMPONENT_LIBRARY_PATH)};`;
}

function renderNode(
  node: CompositionNode,
  depth: number,
  aliases: ImportAliases,
  styled: StyledRegistry,
): string {
  switch (node.kind) {
    case 'container':
      return renderContainer(node, depth, aliases, styled);
    case 'component':
      return renderComponent(node, depth, aliases, styled);
    case 'text':
      return renderText(node, depth, styled);
    case 'placeholder':
      return renderPlaceholder(node, depth);
  }
}

function renderComponent(
  node: ComponentCompositionNode,
  depth: number,
  aliases: ImportAliases,
  styled: StyledRegistry,
): string {
  const jsx = rewriteUsageAliases(node, aliases);
  const wrapper = styled.namesByNodeId.get(node.nodeId);
  if (wrapper) {
    const pad = '  '.repeat(depth);
    return [
      `${pad}<${wrapper}>`,
      indent(jsx, (depth + 1) * 2),
      `${pad}</${wrapper}>`,
    ].join('\n');
  }
  return indent(jsx, depth * 2);
}

function rewriteUsageAliases(
  node: ComponentCompositionNode,
  aliases: ImportAliases,
): string {
  let jsx = node.usage.jsx;

  for (const entry of node.usage.imports) {
    const localName = aliases.get(entry.importedName);
    if (!localName || localName === entry.importedName) {
      continue;
    }
    const name = escapeRegExp(entry.importedName);
    jsx = jsx.replace(
      new RegExp(`(<\\/?)(?:${name})(?=[\\s/>])`, 'g'),
      `$1${localName}`,
    );
  }

  return jsx;
}

function renderContainer(
  node: ContainerCompositionNode,
  depth: number,
  aliases: ImportAliases,
  styled: StyledRegistry,
): string {
  const pad = '  '.repeat(depth);
  const element = styled.namesByNodeId.get(node.nodeId)
    ?? toComponentName(last(node.layerPath) ?? 'Layer');
  if (node.children.length === 0) {
    return `${pad}<${element} />`;
  }

  return [
    `${pad}<${element}>`,
    ...node.children.map((child) =>
      renderNode(child, depth + 1, aliases, styled)),
    `${pad}</${element}>`,
  ].join('\n');
}

function renderText(
  node: TextCompositionNode,
  depth: number,
  styled: StyledRegistry,
): string {
  const pad = '  '.repeat(depth);
  const text = formatJsxChildren(node.text);
  const element = styled.namesByNodeId.get(node.nodeId);
  return element
    ? `${pad}<${element}>${text}</${element}>`
    : `${pad}${text}`;
}

function renderPlaceholder(
  node: PlaceholderCompositionNode,
  depth: number,
): string {
  const label = (node.label ?? node.reason)
    .replace(/\*\//g, '*\\/')
    .replace(/\r?\n/g, ' ');
  return `${'  '.repeat(depth)}{/* ${label} */}`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function last<T>(values: readonly T[]): T | undefined {
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => line ? `${pad}${line}` : line)
    .join('\n');
}
