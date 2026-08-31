/**
 * Frame inspection assembly (Phase C).
 *
 * Combines the selected node's CSS (Phase B) with an enumeration of the
 * connected component instances inside it, producing the {@link FrameInspection}
 * both the Dev Mode adapter and Inspect Code consume.
 *
 * Traversal rules (roadmap §"Phase C"):
 * - Visible document order; hidden nodes are skipped.
 * - The traversal stops at every INSTANCE boundary — internals are never
 *   visited. COMPONENT / COMPONENT_SET children are boundaries too.
 * - Unconnected or broken instances become diagnostics with layer paths,
 *   never silent omissions.
 * - The node budget returns a controlled partial result with a `node-limit`
 *   diagnostic. One failed descendant never discards the CSS sections or the
 *   other entries.
 */

import {
  GenerationContext,
  mapWithConcurrency,
  type GenerationLimits,
  type GenerationTraversal,
} from '../layout/generation-context';
import { resolveInstance, type InstanceLike } from '../layout/figma-component-resolver';
import { formatTokenName } from '../sync-tokens/serialize';
import { getNodeCss, type CssSourceNode } from './node-css';
import { analyzeAccessibility } from './accessibility';
import type {
  ConnectedComponentEntry,
  FrameInspection,
  InspectionDiagnostic,
  InspectionDiagnosticReason,
} from './types';

export type TextStyleLike = { name: string };
export type TextStyleLoader = (id: string) => Promise<TextStyleLike | null>;
export type EffectStyleLike = { name: string };
export type EffectStyleLoader = (id: string) => Promise<EffectStyleLike | null>;

/** Minimal structural view of a node the inspection traversal reads. */
export type InspectableNode = CssSourceNode & {
  type: string;
  visible?: boolean | null;
  children?: readonly InspectableNode[];
  /** string = single text style; the `figma.mixed` symbol = multiple runs. */
  textStyleId?: unknown;
  /** string = single effect style id. */
  effectStyleId?: unknown;
  /** Resolves mixed-style runs to their per-segment `textStyleId`s. */
  getStyledTextSegmentsAsync?: (fields: readonly string[]) =>
    Promise<readonly { textStyleId?: unknown }[]>;
};

export type InspectFrameOptions = GenerationLimits & {
  context?: GenerationContext;
  /** Resolves a Figma text-style id to its name; falls back to `getStyleByIdAsync`. */
  loadTextStyle?: TextStyleLoader;
  /** Resolves a Figma effect-style id to its name; falls back to `getStyleByIdAsync`. */
  loadEffectStyle?: EffectStyleLoader;
};

/**
 * Inspect one selected node: its Layout/Style CSS plus the connected component
 * instances in its subtree. Never throws.
 */
export async function inspectFrame(
  root: InspectableNode,
  options: InspectFrameOptions = {},
): Promise<FrameInspection> {
  const context = options.context ?? new GenerationContext(options);
  const traversal = context.createTraversal();
  const diagnostics: InspectionDiagnostic[] = [];
  const connectedComponents: ConnectedComponentEntry[] = [];

  const cssResult = await getNodeCss(root, context);
  diagnostics.push(...cssResult.diagnostics);

  traversal.visit();
  if (root.type === 'INSTANCE') {
    // An instance root is itself the one candidate entry (the connected case
    // is normally routed to the component branch before inspection).
    await collectInstance(root, [root.name], context, connectedComponents, diagnostics);
  } else {
    await collectChildren(
      root,
      [root.name],
      context,
      traversal,
      connectedComponents,
      diagnostics,
      0,
    );
  }

  if (traversal.isLimitReached) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: 'The selection is large; the connected-components list was truncated at the node limit.',
    });
  }

  const [textStyleName, effectStyleName] = await Promise.all([
    root.type === 'TEXT'
      ? resolveTextStyleName(root, options.loadTextStyle ?? loadFigmaTextStyle)
      : Promise.resolve(undefined),
    resolveEffectStyleName(root, options.loadEffectStyle ?? loadFigmaEffectStyle),
  ]);

  return {
    accessibility: analyzeAccessibility(cssResult.css, root.type),
    nodeName: root.name,
    nodeType: root.type,
    css: cssResult.css,
    connectedComponents,
    diagnostics,
    ...(textStyleName ? { textStyleName } : {}),
    ...(effectStyleName ? { effectStyleName } : {}),
  };
}

async function collectChildren(
  node: InspectableNode,
  layerPath: string[],
  context: GenerationContext,
  traversal: GenerationTraversal,
  entries: ConnectedComponentEntry[],
  diagnostics: InspectionDiagnostic[],
  depth: number,
): Promise<void> {
  if (depth >= context.maxDepth) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: `Reached maximum depth at "${node.name}"; deeper descendants were not enumerated.`,
      nodeId: node.id,
      layerPath,
    });
    return;
  }

  const candidates: Array<{ child: InspectableNode; path: string[] }> = [];
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
  const results = await mapWithConcurrency(
    candidates,
    context.maxConcurrency,
    async ({ child, path }) => {
      const childEntries: ConnectedComponentEntry[] = [];
      const childDiagnostics: InspectionDiagnostic[] = [];
      if (child.type === 'INSTANCE') {
        await collectInstance(
          child,
          path,
          context,
          childEntries,
          childDiagnostics,
        );
      } else if (child.type !== 'COMPONENT' && child.type !== 'COMPONENT_SET') {
        await collectChildren(
          child,
          path,
          context,
          traversal,
          childEntries,
          childDiagnostics,
          depth + 1,
        );
      }
      return { entries: childEntries, diagnostics: childDiagnostics };
    },
  );
  for (const result of results) {
    entries.push(...result.entries);
    diagnostics.push(...result.diagnostics);
  }
}

async function collectInstance(
  node: InspectableNode,
  layerPath: string[],
  context: GenerationContext,
  entries: ConnectedComponentEntry[],
  diagnostics: InspectionDiagnostic[],
): Promise<void> {
  const resolved = await resolveInstance(node as unknown as InstanceLike, context);

  if (resolved.kind === 'component') {
    const usage = resolved.node.usage;
    entries.push({
      nodeId: node.id,
      layerPath,
      componentName: componentNameFromJsx(usage.jsx),
      usage,
    });
    return;
  }

  diagnostics.push({
    severity: resolved.diagnostic.severity,
    reason: resolved.diagnostic.reason as InspectionDiagnosticReason,
    message: resolved.diagnostic.message,
    nodeId: node.id,
    layerPath,
  });
}

/**
 * The component's display name is the generated JSX opening tag, which already
 * reflects any import alias the usage resolved to.
 */
function componentNameFromJsx(jsx: string): string {
  const match = /^<([A-Za-z][A-Za-z0-9_.]*)/.exec(jsx.trimStart());
  return match ? match[1] : 'Component';
}

async function resolveTextStyleName(
  node: InspectableNode,
  loadTextStyle: TextStyleLoader | null,
): Promise<string | undefined> {
  if (!loadTextStyle) {
    return undefined;
  }
  const ids = await collectTextStyleIds(node);
  if (ids.length === 0) {
    return undefined;
  }
  const names: string[] = [];
  for (const id of ids) {
    const style = await loadTextStyle(id).catch(() => null);
    if (style) {
      names.push(formatTokenName(style.name, 'lower-underscore'));
    }
  }
  return names.length > 0 ? names.join(', ') : undefined;
}

async function collectTextStyleIds(node: InspectableNode): Promise<string[]> {
  const id = node.textStyleId;
  if (typeof id === 'string') {
    return [id];
  }
  if (typeof node.getStyledTextSegmentsAsync !== 'function') {
    return [];
  }
  try {
    const segments = await node.getStyledTextSegmentsAsync(['textStyleId']);
    const ids = new Set<string>();
    for (const segment of segments) {
      if (typeof segment.textStyleId === 'string') {
        ids.add(segment.textStyleId);
      }
    }
    return [...ids];
  } catch {
    return [];
  }
}

async function loadFigmaTextStyle(id: string): Promise<TextStyleLike | null> {
  if (typeof figma === 'undefined'
    || typeof figma.getStyleByIdAsync !== 'function') {
    return null;
  }
  const style = await figma.getStyleByIdAsync(id);
  return style ? { name: style.name } : null;
}

async function resolveEffectStyleName(
  node: InspectableNode,
  loadEffectStyle: EffectStyleLoader | null,
): Promise<string | undefined> {
  if (!loadEffectStyle) {
    return undefined;
  }
  const id = typeof node.effectStyleId === 'string' ? node.effectStyleId.trim() : undefined;
  if (!id) {
    return undefined;
  }
  const style = await loadEffectStyle(id).catch(() => null);
  return style ? formatTokenName(style.name, 'lower-underscore') : undefined;
}

async function loadFigmaEffectStyle(id: string): Promise<EffectStyleLike | null> {
  if (typeof figma === 'undefined'
    || typeof figma.getStyleByIdAsync !== 'function') {
    return null;
  }
  const style = await figma.getStyleByIdAsync(id);
  return style ? { name: style.name } : null;
}