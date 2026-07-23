/**
 * Figma scene extraction for the layout composer (Phase 2).
 *
 * Traverses a selected root and produces a {@link LayoutDocument} IR. This is
 * the ONLY place the layout pipeline touches Figma node types — everything
 * downstream consumes the serializable IR.
 *
 * Traversal rules (roadmap §"Phase 2"):
 * - Only FRAME, GROUP, INSTANCE, and TEXT nodes are considered at the root.
 * - Supported auto-layout FRAME → container; GROUP → transparent container;
 *   visible TEXT → text node; connected INSTANCE → component node (atomic).
 * - The traversal stops at every INSTANCE boundary; internals are never visited.
 * - Unsupported nodes, hidden layers, absolute children, and grids become
 *   placeholders + diagnostics — never silently omitted.
 * - Depth and node-count limits return a controlled partial result.
 * - A failure in one descendant never rejects the whole layout.
 */

import {
  GenerationContext,
  type GenerationLimits,
} from './generation-context';
import { resolveInstance, type InstanceLike } from './figma-component-resolver';
import { resolveClassNames, toClassName } from './naming';
import type {
  CompositionNode,
  ContainerCompositionNode,
  LayoutDiagnostic,
  LayoutDocument,
  LayoutStyle,
} from './types';

/** Minimal view of a Figma node the extractor reads. */
type AnyNode = {
  id: string;
  name: string;
  type: string;
  visible?: boolean | null;
  children?: readonly AnyNode[];
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
};

/**
 * Tracks original layer names alongside assigned class names so collisions can
 * be resolved incrementally as containers are discovered in document order.
 */
class ClassNameRegistry {
  private readonly assigned = new Map<string, string>();
  private readonly originals = new Map<string, string>();

  assign(nodeId: string, name: string): string {
    if (this.assigned.has(nodeId)) {
      return this.assigned.get(nodeId)!;
    }
    this.originals.set(nodeId, name);
    const resolved = resolveClassNames(
      Array.from(this.originals.entries()).map(([id, original]) => ({ nodeId: id, name: original })),
    );
    resolved.forEach((assignedName, id) => this.assigned.set(id, assignedName));
    return this.assigned.get(nodeId) ?? toClassName(name);
  }
}

export type ExtractLayoutOptions = GenerationLimits;

/**
 * Extract a layout document from a selected root node. Returns the IR plus any
 * diagnostics gathered during traversal. Never throws — a broken root yields a
 * placeholder root + diagnostic.
 */
export async function extractLayout(
  root: AnyNode,
  options: ExtractLayoutOptions = {},
): Promise<LayoutDocument> {
  const context = new GenerationContext(options);
  const diagnostics: LayoutDiagnostic[] = [];
  const classNames = new ClassNameRegistry();

  const composition = await traverseRoot(root, context, diagnostics, classNames);

  if (context.isLimitReached) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: 'Layout is large; generation was truncated at the node limit. Some descendants were omitted.',
    });
  }

  return {
    root: composition,
    name: root.name,
    diagnostics,
  };
}

async function traverseRoot(
  root: AnyNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
): Promise<CompositionNode> {
  context.visit();

  if (root.type === 'INSTANCE') {
    return resolveInstanceNode(root as unknown as InstanceLike, context, diagnostics, [root.name]);
  }

  if (root.type === 'TEXT') {
    return resolveTextNode(root, [root.name], diagnostics);
  }

  if (root.type === 'FRAME' || root.type === 'GROUP') {
    return resolveContainer(root, context, diagnostics, classNames, [root.name]);
  }

  // Unsupported root: emit a placeholder root rather than failing.
  diagnostics.push({
    severity: 'warning',
    reason: 'unsupported-root',
    message: `"${root.name}" (${root.type}) is not a supported layout root.`,
    nodeId: root.id,
    layerPath: [root.name],
  });
  return {
    kind: 'placeholder',
    nodeId: root.id,
    layerPath: [root.name],
    reason: 'unsupported-root',
    label: `${root.type}: ${root.name}`,
  };
}

async function resolveContainer(
  node: AnyNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
): Promise<CompositionNode> {
  // GROUP is a transparent container; only auto-layout FRAME is a real layout.
  if (node.type === 'FRAME' && node.layoutMode !== 'HORIZONTAL' && node.layoutMode !== 'VERTICAL') {
    const reason = node.layoutMode === 'GRID'
      ? 'grid-layout'
      : 'unsupported-layout-mode';
    diagnostics.push({
      severity: 'warning',
      reason,
      message: `"${node.name}" uses ${node.layoutMode ?? 'NONE'} layout, which is not supported.`,
      nodeId: node.id,
      layerPath,
    });
    return {
      kind: 'placeholder',
      nodeId: node.id,
      layerPath,
      reason,
      label: node.name,
    };
  }

  const className = classNames.assign(node.id, node.name);
  const layout = node.type === 'FRAME'
    ? frameLayoutStyle(node)
    : groupPassthroughLayout();

  const children: CompositionNode[] = [];
  if (!context.enter()) {
    diagnostics.push({
      severity: 'warning',
      reason: 'depth-limit',
      message: `Reached maximum depth at "${node.name}"; deeper descendants were omitted.`,
      nodeId: node.id,
      layerPath,
    });
    return containerNode(node, className, layout, children, layerPath);
  }

  for (const child of node.children ?? []) {
    if (context.isLimitReached) {
      break;
    }
    if (!isVisible(child)) {
      // Hidden nodes are excluded; an info diagnostic only when materially useful.
      continue;
    }
    const childPath = [...layerPath, child.name];
    const childNode = await traverseChild(child, context, diagnostics, classNames, childPath);
    if (childNode) {
      children.push(childNode);
    }
  }

  context.exit();
  return containerNode(node, className, layout, children, layerPath);
}

async function traverseChild(
  child: AnyNode,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  classNames: ClassNameRegistry,
  layerPath: string[],
): Promise<CompositionNode | null> {
  if (!context.visit()) {
    return null;
  }

  // Absolute-positioned children are not supported in version 1.
  if (child.layoutPositioning === 'ABSOLUTE') {
    diagnostics.push({
      severity: 'info',
      reason: 'absolute-positioning',
      message: `"${child.name}" is absolutely positioned and was emitted as a placeholder.`,
      nodeId: child.id,
      layerPath,
    });
    return {
      kind: 'placeholder',
      nodeId: child.id,
      layerPath,
      reason: 'absolute-positioning',
      label: child.name,
    };
  }

  if (child.type === 'INSTANCE') {
    return resolveInstanceNode(child as unknown as InstanceLike, context, diagnostics, layerPath);
  }

  if (child.type === 'TEXT') {
    return resolveTextNode(child, layerPath, diagnostics);
  }

  if (child.type === 'FRAME' || child.type === 'GROUP') {
    return resolveContainer(child, context, diagnostics, classNames, layerPath);
  }

  // Unsupported node type (VECTOR, RECTANGLE, STAR, LINE, VIDEO, EMBED, …).
  diagnostics.push({
    severity: 'info',
    reason: 'unsupported-node',
    message: `"${child.name}" (${child.type}) is not supported and was emitted as a placeholder.`,
    nodeId: child.id,
    layerPath,
  });
  return {
    kind: 'placeholder',
    nodeId: child.id,
    layerPath,
    reason: 'unsupported-node',
    label: `${child.type}: ${child.name}`,
  };
}

async function resolveInstanceNode(
  instance: InstanceLike,
  context: GenerationContext,
  diagnostics: LayoutDiagnostic[],
  layerPath: string[],
): Promise<CompositionNode> {
  const resolved = await resolveInstance(instance, context);
  if (resolved.kind === 'component') {
    // Rewrite the layer path so the component node reports its real position.
    return { ...resolved.node, layerPath };
  }
  diagnostics.push({ ...resolved.diagnostic, layerPath });
  return { ...resolved.node, layerPath };
}

function resolveTextNode(
  node: AnyNode,
  layerPath: string[],
  _diagnostics: LayoutDiagnostic[],
): CompositionNode {
  const text = typeof node.characters === 'string' ? node.characters : node.name;
  return {
    kind: 'text',
    nodeId: node.id,
    layerPath,
    text,
  };
}

function containerNode(
  node: AnyNode,
  className: string,
  layout: LayoutStyle,
  children: CompositionNode[],
  layerPath: string[],
): ContainerCompositionNode {
  return {
    kind: 'container',
    nodeId: node.id,
    layerPath,
    className,
    element: 'div',
    layout,
    children,
  };
}

/** Map a FRAME's auto-layout properties to the IR layout style. */
function frameLayoutStyle(node: AnyNode): LayoutStyle {
  const axis = node.layoutMode === 'HORIZONTAL' ? 'horizontal' : 'vertical';
  return {
    axis,
    wrap: node.layoutWrap === 'WRAP',
    gap: num(node.itemSpacing),
    counterGap: node.layoutWrap === 'WRAP' ? num(node.counterAxisSpacing) : undefined,
    justifyContent: mapJustify(node.primaryAxisAlignItems),
    alignItems: mapAlign(node.counterAxisAlignItems),
    paddingTop: num(node.paddingTop),
    paddingRight: num(node.paddingRight),
    paddingBottom: num(node.paddingBottom),
    paddingLeft: num(node.paddingLeft),
  };
}

/**
 * A GROUP contributes no flex properties of its own — its children flow as if
 * the group were absent. We model it as a transparent vertical container with
 * no gap; Phase 3 may refine this when group-positioning semantics matter.
 */
function groupPassthroughLayout(): LayoutStyle {
  return {
    axis: 'vertical',
    wrap: false,
    gap: 0,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
  };
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

function isVisible(node: AnyNode): boolean {
  return node.visible !== false;
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
