/**
 * Extract a selected Figma layer tree into the serializable React layout IR.
 *
 * Connected instances are atomic production-component usages. Ordinary frames,
 * groups, sections, and text remain in document order. Unsupported leaves are
 * represented by explicit JSX comments and diagnostics instead of disappearing.
 */

import {
  GenerationContext,
  mapWithConcurrency,
  type GenerationLimits,
  type GenerationTraversal,
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
import { normalizeCssValue } from '../css-values';

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
  exportAsync?: (settings: { format: 'SVG_STRING' }) => Promise<string | Uint8Array>;
};

class StructuralTokenResolver {
  constructor(
    private readonly load: VariableLoader,
    private readonly context: GenerationContext,
  ) {}

  resolve(alias: VariableAliasLike | undefined): Promise<CssTokenReference | undefined> {
    if (!alias) {
      return Promise.resolve(undefined);
    }
    return this.context.getVariable(alias.id, () => this.load(alias.id))
      .then((variable) => variable
        ? {
            cssName: `--${formatTokenName(variable.name, 'kebab')}`,
            variableId: variable.id,
          }
        : undefined)
      .catch(() => undefined);
  }

  getNodeCss(
    nodeId: string,
    load: () => Promise<Record<string, string>>,
  ): Promise<Record<string, string>> {
    return this.context.getNodeCss(nodeId, load);
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
  context?: GenerationContext;
  loadVariable?: VariableLoader;
  /** Public component name to use when the selected layer is one variant. */
  rootName?: string;
};

export async function extractLayout(
  root: LayoutSourceNode,
  options: ExtractLayoutOptions = {},
): Promise<LayoutDocument> {
  const context = options.context ?? new GenerationContext(options);
  const traversal = context.createTraversal();
  const tokens = new StructuralTokenResolver(
    options.loadVariable ?? loadFigmaVariable,
    context,
  );
  const diagnostics: LayoutDiagnostic[] = [];
  const classNames = new ClassNameRegistry();
  const rootName = options.rootName?.trim() || root.name;
  const composition = await traverseRoot(
    root,
    context,
    traversal,
    diagnostics,
    classNames,
    tokens,
    rootName,
  );

  if (traversal.isLimitReached) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: 'The selected design was truncated at the node limit.',
    });
  }

  if (
    composition.kind === 'container'
    && composition.layout.width !== undefined
    && !composition.declarations.some(({ property }) =>
      property.trim().toLowerCase() === 'width')
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
      layerPath: [rootName],
    });
  }

  return {
    root: composition,
    name: rootName,
    diagnostics,
  };
}

async function traverseRoot(
  root: LayoutSourceNode,
  context: GenerationContext,
  traversal: GenerationTraversal,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  tokens: StructuralTokenResolver,
  rootName: string,
): Promise<CompositionNode> {
  traversal.visit();
  const path = [rootName];

  if (root.type === 'TEXT') {
    return resolveTextNode(root, path, classNames, diagnostics, false, tokens);
  }
  if (isContainer(root)) {
    return resolveContainer(
      root,
      context,
      traversal,
      diagnostics,
      classNames,
      path,
      tokens,
      0,
      true,
      false,
      rootName,
    );
  }
  if (root.type === 'LINE') {
    return resolveLineNode(
      root,
      path,
      diagnostics,
      classNames,
      tokens,
      false,
    );
  }
  if (isExportableAsset(root)) {
    return resolveAssetNode(
      root,
      path,
      diagnostics,
      tokens,
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
  traversal: GenerationTraversal,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
  tokens: StructuralTokenResolver,
  depth: number,
  isRoot = false,
  parentIsFreeform = false,
  nameOverride?: string,
): Promise<ContainerCompositionNode> {
  const className = classNames.assign(node.id, nameOverride ?? node.name);
  const layout = await layoutStyle(node, diagnostics, layerPath, tokens);
  const childStyle = isRoot
    ? undefined
    : await getChildStyle(node, tokens, parentIsFreeform);
  const declarations = await readCssDeclarations(
    node,
    tokens,
    diagnostics,
    layerPath,
  );
  const children: CompositionNode[] = [];

  if (depth >= context.maxDepth) {
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

  const candidates: Array<{ child: LayoutSourceNode; path: string[] }> = [];
  for (const child of node.children ?? []) {
    if (traversal.isLimitReached) {
      break;
    }
    if (child.visible === false) {
      continue;
    }
    if (!traversal.visit()) {
      break;
    }

    candidates.push({ child, path: [...layerPath, child.name] });
  }
  const resolvedChildren = await mapWithConcurrency(
    candidates,
    context.maxConcurrency,
    async ({ child, path }) => {
      const childDiagnostics: LayoutDiagnostic[] = [];
      const resolved = await traverseChild(
        child,
        context,
        traversal,
        childDiagnostics,
        classNames,
        path,
        !isAutoLayout(node),
        tokens,
        depth + 1,
      );
      return { diagnostics: childDiagnostics, node: resolved };
    },
  );
  for (const resolved of resolvedChildren) {
    diagnostics.push(...resolved.diagnostics);
    if (resolved.node) {
      children.push(resolved.node);
    }
  }

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
  traversal: GenerationTraversal,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
  parentIsFreeform: boolean,
  tokens: StructuralTokenResolver,
  depth: number,
): Promise<CompositionNode | null> {
  if (child.type === 'INSTANCE') {
    return resolveInstanceNode(
      child as unknown as InstanceLike,
      context,
      diagnostics,
      classNames,
      layerPath,
      tokens,
      parentIsFreeform,
      traversal,
      depth,
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
      traversal,
      diagnostics,
      classNames,
      layerPath,
      tokens,
      depth,
      false,
      parentIsFreeform,
    );
  }
  if (child.type === 'LINE') {
    return resolveLineNode(
      child,
      layerPath,
      diagnostics,
      classNames,
      tokens,
      parentIsFreeform,
    );
  }
  if (isExportableAsset(child)) {
    return resolveAssetNode(
      child,
      layerPath,
      diagnostics,
      tokens,
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
  traversal?: GenerationTraversal,
  depth = 0,
): Promise<CompositionNode> {
  const resolved = await resolveInstance(instance, context);
  if (resolved.kind === 'placeholder') {
    const source = instance as unknown as LayoutSourceNode;
    if (
      resolved.node.reason === 'unconnected-instance'
      && traversal
      && (source.children?.length ?? 0) > 0
    ) {
      // Preserve the component boundary as UI metadata even though its visible
      // children are expanded into the generated Frame structure.
      diagnostics.push({ ...resolved.diagnostic, layerPath });
      return resolveContainer(
        source,
        context,
        traversal,
        diagnostics,
        classNames,
        layerPath,
        tokens,
        depth,
        false,
        parentIsFreeform,
      );
    }
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
  const declarations = await readCssDeclarations(
    node,
    tokens,
    diagnostics,
    layerPath,
  );
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
    element: node.type === 'SECTION' ? 'section' : 'div',
    layout,
    declarations,
    children,
    ...(childStyle ? { childStyle } : {}),
  };
}

async function resolveLineNode(
  node: LayoutSourceNode,
  layerPath: string[],
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  tokens: StructuralTokenResolver,
  parentIsFreeform: boolean,
): Promise<CompositionNode> {
  const declarations = await readCssDeclarations(
    node,
    tokens,
    diagnostics,
    layerPath,
  );
  if (declarations.length === 0) {
    return resolveAssetNode(
      node,
      layerPath,
      diagnostics,
      tokens,
      parentIsFreeform,
    );
  }
  const childStyle = await getChildStyle(node, tokens, parentIsFreeform);
  return {
    kind: 'shape',
    nodeId: node.id,
    layerPath,
    className: classNames.assign(node.id, node.name),
    declarations,
    ...(childStyle ? { childStyle } : {}),
  };
}

async function resolveAssetNode(
  node: LayoutSourceNode,
  layerPath: string[],
  diagnostics: LayoutDiagnostic[],
  tokens: StructuralTokenResolver,
  parentIsFreeform: boolean,
): Promise<CompositionNode> {
  if (typeof node.exportAsync !== 'function') {
    diagnostics.push({
      severity: 'warning',
      reason: 'unsupported-paint',
      message: `"${node.name}" could not be exported as an SVG asset.`,
      nodeId: node.id,
      layerPath,
    });
    return placeholder(node, layerPath, 'unsupported-node');
  }
  try {
    const svg = await node.exportAsync({ format: 'SVG_STRING' });
    if (typeof svg !== 'string' || svg.trim() === '') {
      throw new TypeError('SVG export returned no text.');
    }
    const declarations = await readCssDeclarations(
      node,
      tokens,
      diagnostics,
      layerPath,
    );
    const maskColor = resolveSvgMaskColor(svg, declarations);
    const renderedDeclarations = declarations.filter(({ property }) =>
      !isSvgPaintProperty(property));
    const childStyle = await getChildStyle(node, tokens, parentIsFreeform);
    return {
      kind: 'asset',
      nodeId: node.id,
      layerPath,
      alt: node.name,
      src: `data:image/svg+xml,${encodeURIComponent(svg)}`,
      declarations: renderedDeclarations,
      ...(childStyle ? { childStyle } : {}),
      ...(maskColor ? { mask: { color: maskColor } } : {}),
    };
  } catch (_error) {
    diagnostics.push({
      severity: 'warning',
      reason: 'unsupported-paint',
      message: `"${node.name}" could not be exported safely; a JSX marker was emitted.`,
      nodeId: node.id,
      layerPath,
    });
    return placeholder(node, layerPath, 'unsupported-node');
  }
}

function resolveSvgMaskColor(
  svg: string,
  declarations: ContainerCompositionNode['declarations'],
): ContainerCompositionNode['declarations'][number] | undefined {
  const tokenPaints = declarations.filter(({ property, value }) =>
    isSvgPaintProperty(property) && isCssVariable(value));
  const values = new Set(tokenPaints.map(({ value }) => value.trim()));
  if (values.size !== 1 || !isMonochromeSvg(svg)) {
    return undefined;
  }
  const [paint] = tokenPaints;
  return {
    property: 'background-color',
    value: paint.value,
    source: paint.source,
  };
}

function isSvgPaintProperty(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  return normalized === 'fill' || normalized === 'stroke';
}

function isCssVariable(value: string): boolean {
  return /^var\(\s*--[a-zA-Z0-9_./-]+(?:\s*,[\s\S]*)?\)$/.test(value.trim());
}

function isMonochromeSvg(svg: string): boolean {
  if (/<(?:linearGradient|radialGradient|pattern|image)\b/i.test(svg)) {
    return false;
  }
  const paints = Array.from(
    svg.matchAll(/\b(?:fill|stroke)=["']([^"']+)["']/gi),
    (match) => match[1].trim().toLowerCase(),
  ).filter((paint) =>
    paint !== '' && paint !== 'none' && paint !== 'transparent');
  return new Set(paints).size <= 1;
}

async function readCssDeclarations(
  node: LayoutSourceNode,
  tokens: StructuralTokenResolver,
  diagnostics: LayoutDiagnostic[],
  layerPath: string[],
): Promise<ContainerCompositionNode['declarations']> {
  if (typeof node.getCSSAsync !== 'function') {
    return [];
  }

  try {
    const css = await tokens.getNodeCss(node.id, () => node.getCSSAsync!());
    return Object.entries(css)
      .filter(([property, value]) => property.trim() !== '' && value.trim() !== '')
      .map(([property, value]) => ({
        property,
        value: normalizeCssValue(value),
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
  if (node.type === 'FRAME' && node.layoutMode === 'GRID') {
    diagnostics.push({
      severity: 'warning',
      reason: 'grid-layout',
      message: `"${node.name}" uses GRID layout; children were emitted in document order and may need manual positioning.`,
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
  return [
    'COMPONENT',
    'COMPONENT_SET',
    'FRAME',
    'GROUP',
    'INSTANCE',
    'SECTION',
  ].includes(node.type);
}

function isExportableAsset(node: LayoutSourceNode): boolean {
  return [
    'BOOLEAN_OPERATION',
    'ELLIPSE',
    'POLYGON',
    'RECTANGLE',
    'STAR',
    'VECTOR',
  ].includes(node.type);
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
