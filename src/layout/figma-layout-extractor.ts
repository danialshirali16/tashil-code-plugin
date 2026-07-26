/**
 * Extract a selected Figma layer tree into the serializable React layout IR.
 *
 * Connected instances are atomic production-component usages. Ordinary frames,
 * groups, sections, and text remain in document order. Unsupported leaves are
 * represented by explicit JSX comments and diagnostics instead of disappearing.
 */

import {
  GenerationContext,
  type GenerationLimits,
} from './generation-context';
import { formatTokenName } from '../sync-tokens/serialize';
import { resolveInstance, type InstanceLike } from './figma-component-resolver';
import { resolveClassNames, toClassName } from './naming';
import type {
  ChildStyle,
  CompositionNode,
  ContainerCompositionNode,
  CssTokenReference,
  LayoutDiagnostic,
  LayoutDocument,
  LayoutStyle,
  LayoutTokenField,
  SizingMode,
} from './types';

type VariableAliasLike = { id: string };
type VariableLike = { id: string; name: string };
type VariableLoader = (id: string) => Promise<VariableLike | null>;

export type LayoutSourceNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean | null;
  children?: readonly LayoutSourceNode[];
  layoutMode?: string | null;
  layoutWrap?: string | null;
  itemSpacing?: number | null;
  counterAxisSpacing?: number | null;
  paddingTop?: number | null;
  paddingRight?: number | null;
  paddingBottom?: number | null;
  paddingLeft?: number | null;
  primaryAxisAlignItems?: string | null;
  counterAxisAlignItems?: string | null;
  characters?: string;
  layoutPositioning?: string | null;
  layoutGrow?: number | null;
  layoutAlign?: string | null;
  layoutSizingHorizontal?: string | null;
  layoutSizingVertical?: string | null;
  width?: number | null;
  height?: number | null;
  x?: number | null;
  y?: number | null;
  boundVariables?: object;
  getCSSAsync?: () => Promise<Record<string, string>>;
};

class StructuralTokenResolver {
  private readonly cache = new Map<string, Promise<CssTokenReference | undefined>>();

  constructor(private readonly load: VariableLoader) {}

  resolve(alias: VariableAliasLike | undefined): Promise<CssTokenReference | undefined> {
    if (!alias) {
      return Promise.resolve(undefined);
    }
    const cached = this.cache.get(alias.id);
    if (cached) {
      return cached;
    }
    const pending = this.load(alias.id)
      .then((variable) => variable
        ? {
            cssName: `--${formatTokenName(variable.name, 'kebab')}`,
            variableId: variable.id,
          }
        : undefined)
      .catch(() => undefined);
    this.cache.set(alias.id, pending);
    return pending;
  }
}

class ClassNameRegistry {
  private readonly assigned = new Map<string, string>();
  private readonly originals = new Map<string, string>();

  assign(nodeId: string, name: string): string {
    const existing = this.assigned.get(nodeId);
    if (existing) {
      return existing;
    }

    this.originals.set(nodeId, name);
    const resolved = resolveClassNames(
      Array.from(this.originals, ([id, original]) => ({ nodeId: id, name: original })),
    );
    for (const [id, className] of resolved) {
      this.assigned.set(id, className);
    }
    return this.assigned.get(nodeId) ?? toClassName(name);
  }
}

export type ExtractLayoutOptions = GenerationLimits & {
  loadVariable?: VariableLoader;
};

export async function extractLayout(
  root: LayoutSourceNode,
  options: ExtractLayoutOptions = {},
): Promise<LayoutDocument> {
  const context = new GenerationContext(options);
  const tokens = new StructuralTokenResolver(
    options.loadVariable ?? loadFigmaVariable,
  );
  const diagnostics: LayoutDiagnostic[] = [];
  const classNames = new ClassNameRegistry();
  const composition = await traverseRoot(
    root,
    context,
    diagnostics,
    classNames,
    tokens,
  );

  if (context.isLimitReached) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: 'The selected design was truncated at the node limit.',
    });
  }

  if (
    composition.kind === 'container'
    && composition.layout.width !== undefined
    && (
      composition.layout.mode === 'freeform'
      || composition.layout.sizingHorizontal === 'fixed'
    )
  ) {
    diagnostics.push({
      severity: 'info',
      reason: 'root-fixed-size-omitted',
      message: 'The selected frame width was omitted so the generated layout can remain responsive.',
      nodeId: root.id,
      layerPath: [root.name],
    });
  }

  return {
    root: composition,
    name: root.name,
    diagnostics,
  };
}

async function traverseRoot(
  root: LayoutSourceNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  tokens: StructuralTokenResolver,
): Promise<CompositionNode> {
  context.visit();
  const path = [root.name];

  if (root.type === 'INSTANCE') {
    return resolveInstanceNode(
      root as unknown as InstanceLike,
      context,
      diagnostics,
      classNames,
      path,
      tokens,
    );
  }
  if (root.type === 'TEXT') {
    return resolveTextNode(root, path, classNames, diagnostics, false, tokens);
  }
  if (isContainer(root)) {
    return resolveContainer(
      root,
      context,
      diagnostics,
      classNames,
      path,
      tokens,
      true,
      false,
    );
  }

  diagnostics.push({
    severity: 'warning',
    reason: 'unsupported-root',
    message: `"${root.name}" (${root.type}) cannot be represented as a React layout root.`,
    nodeId: root.id,
    layerPath: path,
  });
  return placeholder(root, path, 'unsupported-root');
}

async function resolveContainer(
  node: LayoutSourceNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
  tokens: StructuralTokenResolver,
  isRoot = false,
  parentIsFreeform = false,
): Promise<ContainerCompositionNode> {
  const className = classNames.assign(node.id, node.name);
  const layout = await layoutStyle(node, diagnostics, layerPath, tokens);
  const childStyle = isRoot
    ? undefined
    : await getChildStyle(node, tokens, parentIsFreeform);
  const declarations = await readCssDeclarations(node, diagnostics, layerPath);
  const children: CompositionNode[] = [];

  if (!context.enter()) {
    diagnostics.push({
      severity: 'warning',
      reason: 'depth-limit',
      message: `Reached maximum depth at "${node.name}"; deeper descendants were omitted.`,
      nodeId: node.id,
      layerPath,
    });
    return containerNode(
      node,
      className,
      layout,
      declarations,
      children,
      layerPath,
      isRoot,
      childStyle,
    );
  }

  for (const child of node.children ?? []) {
    if (context.isLimitReached) {
      break;
    }
    if (child.visible === false) {
      continue;
    }
    if (!context.visit()) {
      break;
    }

    const childPath = [...layerPath, child.name];
    const resolved = await traverseChild(
      child,
      context,
      diagnostics,
      classNames,
      childPath,
      !isAutoLayout(node),
      tokens,
    );
    if (resolved) {
      children.push(resolved);
    }
  }

  context.exit();
  return containerNode(
    node,
    className,
    layout,
    declarations,
    children,
    layerPath,
    isRoot,
    childStyle,
  );
}

async function traverseChild(
  child: LayoutSourceNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
  parentIsFreeform: boolean,
  tokens: StructuralTokenResolver,
): Promise<CompositionNode | null> {
  if (child.layoutPositioning === 'ABSOLUTE' || parentIsFreeform) {
    diagnostics.push({
      severity: 'info',
      reason: 'absolute-positioning',
      message: `"${child.name}" is absolutely positioned; its Figma coordinates and CSS were preserved.`,
      nodeId: child.id,
      layerPath,
    });
  }

  if (child.type === 'INSTANCE') {
    return resolveInstanceNode(
      child as unknown as InstanceLike,
      context,
      diagnostics,
      classNames,
      layerPath,
      tokens,
      parentIsFreeform,
    );
  }
  if (child.type === 'TEXT') {
    return resolveTextNode(
      child,
      layerPath,
      classNames,
      diagnostics,
      parentIsFreeform,
      tokens,
    );
  }
  if (isContainer(child)) {
    return resolveContainer(
      child,
      context,
      diagnostics,
      classNames,
      layerPath,
      tokens,
      false,
      parentIsFreeform,
    );
  }

  diagnostics.push({
    severity: 'info',
    reason: 'unsupported-node',
    message: `"${child.name}" (${child.type}) was preserved as a JSX comment.`,
    nodeId: child.id,
    layerPath,
  });
  return placeholder(child, layerPath, 'unsupported-node');
}

async function resolveInstanceNode(
  instance: InstanceLike,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
  tokens: StructuralTokenResolver,
  parentIsFreeform = false,
): Promise<CompositionNode> {
  const resolved = await resolveInstance(instance, context);
  if (resolved.kind === 'placeholder') {
    diagnostics.push({ ...resolved.diagnostic, layerPath });
    return { ...resolved.node, layerPath };
  }

  const childStyle = await getChildStyle(
    instance as unknown as LayoutSourceNode,
    tokens,
    parentIsFreeform,
  );
  return {
    ...resolved.node,
    layerPath,
    ...(childStyle
      ? {
          childStyle,
          className: classNames.assign(instance.id, instance.name),
        }
      : {}),
  };
}

async function resolveTextNode(
  node: LayoutSourceNode,
  layerPath: string[],
  classNames: ClassNameRegistry,
  diagnostics: LayoutDiagnostic[],
  parentIsFreeform: boolean,
  tokens: StructuralTokenResolver,
): Promise<CompositionNode> {
  const childStyle = await getChildStyle(node, tokens, parentIsFreeform);
  const declarations = await readCssDeclarations(node, diagnostics, layerPath);
  return {
    kind: 'text',
    nodeId: node.id,
    layerPath,
    text: typeof node.characters === 'string' ? node.characters : node.name,
    declarations,
    ...(childStyle || declarations.length > 0
      ? {
          ...(childStyle ? { childStyle } : {}),
          className: classNames.assign(node.id, node.name),
        }
      : {}),
  };
}

function containerNode(
  node: LayoutSourceNode,
  className: string,
  layout: LayoutStyle,
  declarations: ContainerCompositionNode['declarations'],
  children: CompositionNode[],
  layerPath: string[],
  isRoot: boolean,
  childStyle: ChildStyle | undefined,
): ContainerCompositionNode {
  return {
    kind: 'container',
    nodeId: node.id,
    layerPath,
    className,
    element: 'div',
    layout,
    declarations,
    children,
    ...(childStyle ? { childStyle } : {}),
  };
}

async function readCssDeclarations(
  node: LayoutSourceNode,
  diagnostics: LayoutDiagnostic[],
  layerPath: string[],
): Promise<ContainerCompositionNode['declarations']> {
  if (typeof node.getCSSAsync !== 'function') {
    return [];
  }

  try {
    const css = await node.getCSSAsync();
    return Object.entries(css)
      .filter(([property, value]) => property.trim() !== '' && value.trim() !== '')
      .map(([property, value]) => ({
        property,
        value,
        source: 'figma-css' as const,
      }));
  } catch (_error) {
    diagnostics.push({
      severity: 'warning',
      reason: 'css-unavailable',
      message: `Could not read token-aware CSS for "${node.name}"; structural layout fallbacks were used.`,
      nodeId: node.id,
      layerPath,
    });
    return [];
  }
}

async function layoutStyle(
  node: LayoutSourceNode,
  diagnostics: LayoutDiagnostic[],
  layerPath: string[],
  tokens: StructuralTokenResolver,
): Promise<LayoutStyle> {
  if (node.type === 'FRAME' && !isAutoLayout(node)) {
    const reason = node.layoutMode === 'GRID'
      ? 'grid-layout'
      : 'unsupported-layout-mode';
    diagnostics.push({
      severity: 'warning',
      reason,
      message: `"${node.name}" uses ${node.layoutMode ?? 'NONE'} layout; children were emitted in document order and may need manual positioning.`,
      nodeId: node.id,
      layerPath,
    });
  }

  const autoLayout = isAutoLayout(node);
  const structuralTokens = await resolveStructuralTokens(node, tokens);
  return {
    mode: autoLayout ? 'auto-layout' : 'freeform',
    axis: node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical',
    wrap: autoLayout && node.layoutWrap === 'WRAP',
    gap: autoLayout ? finite(node.itemSpacing) : 0,
    ...(autoLayout && node.layoutWrap === 'WRAP'
      ? { counterGap: finite(node.counterAxisSpacing) }
      : {}),
    justifyContent: autoLayout
      ? mapJustify(node.primaryAxisAlignItems)
      : 'flex-start',
    alignItems: autoLayout
      ? mapAlign(node.counterAxisAlignItems)
      : 'flex-start',
    paddingTop: autoLayout ? finite(node.paddingTop) : 0,
    paddingRight: autoLayout ? finite(node.paddingRight) : 0,
    paddingBottom: autoLayout ? finite(node.paddingBottom) : 0,
    paddingLeft: autoLayout ? finite(node.paddingLeft) : 0,
    sizingHorizontal: mapSizing(node.layoutSizingHorizontal),
    sizingVertical: mapSizing(node.layoutSizingVertical),
    ...(isFiniteNumber(node.width) ? { width: node.width } : {}),
    ...(isFiniteNumber(node.height) ? { height: node.height } : {}),
    ...(Object.keys(structuralTokens).length > 0
      ? { tokens: structuralTokens }
      : {}),
  };
}

async function getChildStyle(
  node: LayoutSourceNode,
  tokens: StructuralTokenResolver,
  parentIsFreeform = false,
): Promise<ChildStyle | undefined> {
  const style: ChildStyle = {};
  const absolute = node.layoutPositioning === 'ABSOLUTE' || parentIsFreeform;
  const horizontal = mapSizing(node.layoutSizingHorizontal);
  const vertical = mapSizing(node.layoutSizingVertical);
  const widthToken = await resolveBoundToken(node, 'width', tokens);
  const heightToken = await resolveBoundToken(node, 'height', tokens);
  if (widthToken || heightToken) {
    style.tokens = {
      ...(widthToken ? { width: widthToken } : {}),
      ...(heightToken ? { height: heightToken } : {}),
    };
  }

  if (absolute) {
    style.position = 'absolute';
    if (isFiniteNumber(node.x)) {
      style.left = node.x;
    }
    if (isFiniteNumber(node.y)) {
      style.top = node.y;
    }
    if (isFiniteNumber(node.width)) {
      style.width = node.width;
    }
    if (isFiniteNumber(node.height)) {
      style.height = node.height;
    }
    return style;
  }

  if (isFiniteNumber(node.layoutGrow) && node.layoutGrow > 0) {
    style.grow = node.layoutGrow;
  }
  if (node.layoutAlign === 'STRETCH') {
    style.alignSelf = 'stretch';
  }
  if (horizontal && horizontal !== 'hug') {
    style.sizingHorizontal = horizontal;
    if (horizontal === 'fixed' && isFiniteNumber(node.width)) {
      style.width = node.width;
    }
  }
  if (vertical && vertical !== 'hug') {
    style.sizingVertical = vertical;
    if (vertical === 'fixed' && isFiniteNumber(node.height)) {
      style.height = node.height;
    }
  }

  return Object.keys(style).length > 0 ? style : undefined;
}

function placeholder(
  node: LayoutSourceNode,
  layerPath: string[],
  reason: 'absolute-positioning' | 'unsupported-node' | 'unsupported-root',
): CompositionNode {
  return {
    kind: 'placeholder',
    nodeId: node.id,
    layerPath,
    reason,
    label: `${node.type}: ${node.name}`,
  };
}

function isContainer(node: LayoutSourceNode): boolean {
  return node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION';
}

function isAutoLayout(node: LayoutSourceNode): boolean {
  return node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL';
}

function mapSizing(value: string | null | undefined): SizingMode | undefined {
  switch (value) {
    case 'FILL': return 'fill';
    case 'FIXED': return 'fixed';
    case 'HUG': return 'hug';
    default: return undefined;
  }
}

function mapJustify(value: string | null | undefined): LayoutStyle['justifyContent'] {
  switch (value) {
    case 'CENTER': return 'center';
    case 'MAX': return 'flex-end';
    case 'SPACE_BETWEEN': return 'space-between';
    default: return 'flex-start';
  }
}

function mapAlign(value: string | null | undefined): LayoutStyle['alignItems'] {
  switch (value) {
    case 'CENTER': return 'center';
    case 'MAX': return 'flex-end';
    case 'BASELINE': return 'baseline';
    case 'STRETCH': return 'stretch';
    default: return 'flex-start';
  }
}

const STRUCTURAL_TOKEN_FIELDS: ReadonlyArray<[
  LayoutTokenField,
  string,
]> = [
  ['gap', 'itemSpacing'],
  ['counterGap', 'counterAxisSpacing'],
  ['paddingTop', 'paddingTop'],
  ['paddingRight', 'paddingRight'],
  ['paddingBottom', 'paddingBottom'],
  ['paddingLeft', 'paddingLeft'],
  ['width', 'width'],
  ['height', 'height'],
];

async function resolveStructuralTokens(
  node: LayoutSourceNode,
  tokens: StructuralTokenResolver,
): Promise<NonNullable<LayoutStyle['tokens']>> {
  const resolved = await Promise.all(
    STRUCTURAL_TOKEN_FIELDS.map(async ([target, source]) =>
      [target, await resolveBoundToken(node, source, tokens)] as const),
  );
  const result: NonNullable<LayoutStyle['tokens']> = {};
  for (const [field, token] of resolved) {
    if (token) {
      result[field] = token;
    }
  }
  return result;
}

function resolveBoundToken(
  node: LayoutSourceNode,
  field: string,
  tokens: StructuralTokenResolver,
): Promise<CssTokenReference | undefined> {
  const binding = (
    node.boundVariables as Readonly<Record<string, unknown>> | undefined
  )?.[field];
  const candidate = Array.isArray(binding) ? binding[0] : binding;
  return tokens.resolve(
    isVariableAlias(candidate) ? candidate : undefined,
  );
}

function isVariableAlias(value: unknown): value is VariableAliasLike {
  return typeof value === 'object'
    && value !== null
    && 'id' in value
    && typeof value.id === 'string';
}

async function loadFigmaVariable(id: string): Promise<VariableLike | null> {
  if (typeof figma === 'undefined' || !figma.variables) {
    return null;
  }
  const variable = await figma.variables.getVariableByIdAsync(id);
  return variable ? { id: variable.id, name: variable.name } : null;
}

function finite(value: number | null | undefined): number {
  return isFiniteNumber(value) ? value : 0;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
