/**
 * TSX emitter for the layout composer (Phase 1).
 *
 * Turns a layout IR document into a complete `.tsx` string: a deduplicated
 * import block, then an exported React function component wrapping the root
 * composition node. Text and JSX comments are escaped so output is always
 * syntactically valid TSX.
 *
 * Pure, Figma-independent. Spec: roadmap §"Naming and formatting rules".
 */

import { formatJsxChildren } from '../codegen';
import { renderImportLines } from './imports';
import { toComponentName } from './naming';
import type {
  CompositionNode,
  ComponentCompositionNode,
  ContainerCompositionNode,
  LayoutDocument,
  PlaceholderCompositionNode,
  TextCompositionNode,
} from './types';

/**
 * Render the whole document as a TSX module. Indentation is two spaces, line
 * endings `\n`, matching the existing component-snippet style.
 */
export function renderTsx(document: LayoutDocument, cssModulePath: string): string {
  const componentName = toComponentName(document.name);
  const imports = collectImports(document.root);
  const importBlock = renderImportLines(imports);
  const cssImport = `import styles from ${JSON.stringify(cssModulePath)};`;
  const body = renderNode(document.root, 0);
  const indentedBody = indent(body, 2);

  const sections = [
    importBlock,
    cssImport,
    '',
    `export function ${componentName}() {`,
    '  return (',
    indentedBody,
    '  );',
    '}',
  ];

  return `${sections.join('\n')}\n`;
}

/** Collect every component usage's imports, in document order. */
function collectImports(node: CompositionNode): ComponentCompositionNode['usage']['imports'] {
  const imports: ComponentCompositionNode['usage']['imports'] = [];
  collectImportsInto(node, imports);
  return imports;
}

function collectImportsInto(
  node: CompositionNode,
  imports: ComponentCompositionNode['usage']['imports'],
): void {
  if (node.kind === 'component') {
    imports.push(...node.usage.imports);
    return;
  }
  if (node.kind === 'container') {
    for (const child of node.children) {
      collectImportsInto(child, imports);
    }
  }
}

/** Render a node to one or more JSX lines at the given indent depth. */
function renderNode(node: CompositionNode, depth: number): string {
  switch (node.kind) {
    case 'container':
      return renderContainer(node, depth);
    case 'component':
      return renderComponent(node, depth);
    case 'text':
      return renderText(node, depth);
    case 'placeholder':
      return renderPlaceholder(node, depth);
  }
}

/**
 * Render a connected component. When the instance declares flex-item behavior
 * (grow/stretch/sizing), it is wrapped in a `<div>` carrying the wrapper class
 * so the connected component stays atomic while the wrapper owns the layout.
 */
function renderComponent(node: ComponentCompositionNode, depth: number): string {
  if (node.childStyle && node.className) {
    const pad = '  '.repeat(depth);
    return [
      `${pad}<div className={styles.${node.className}}>`,
      indent(node.usage.jsx, (depth + 1) * 2),
      `${pad}</div>`,
    ].join('\n');
  }
  return indent(node.usage.jsx, depth * 2);
}

function renderContainer(node: ContainerCompositionNode, depth: number): string {
  const pad = '  '.repeat(depth);
  const open = `${pad}<div className={styles.${node.className}}>`;

  const childLines = node.children
    .map((child) => renderNode(child, depth + 1))
    .filter((line) => line.length > 0);

  if (childLines.length === 0) {
    return `${pad}<div className={styles.${node.className}} />`;
  }

  return [open, ...childLines, `${pad}</div>`].join('\n');
}

function renderText(node: TextCompositionNode, depth: number): string {
  const pad = '  '.repeat(depth);
  const text = formatJsxChildren(node.text);
  // A className is set when the text declares flex-item behavior (childStyle)
  // or an explicit wrapper; wrap it in a span so the CSS class applies.
  if (node.className) {
    return `${pad}<span className={styles.${node.className}}>${text}</span>`;
  }
  return `${pad}${text}`;
}

function renderPlaceholder(node: PlaceholderCompositionNode, depth: number): string {
  const pad = '  '.repeat(depth);
  // Inline JSX comment. The label is escaped for the comment context: JSX
  // comments are `/* … */`, so we strip the characters that could close one.
  const label = escapeJsxComment(node.label ?? node.reason);
  return `${pad}{/* ${label} */}`;
}

/**
 * Escape text for a JSX block comment. A comment body must not contain the
 * star-slash sequence, which would terminate it early. That sequence is
 * replaced defensively and newlines collapse to spaces.
 */
function escapeJsxComment(value: string): string {
  return value.replace(/\*\//g, '*\\/').replace(/\r?\n/g, ' ');
}

/** Indent every line of `text` by `spaces` spaces. */
function indent(text: string, spaces: number): string {
  if (spaces === 0) {
    return text;
  }
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((line) => (line.length > 0 ? `${pad}${line}` : line))
    .join('\n');
}
