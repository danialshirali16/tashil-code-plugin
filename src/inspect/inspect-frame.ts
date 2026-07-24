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

import { GenerationContext, type GenerationLimits } from '../layout/generation-context';
import { resolveInstance, type InstanceLike } from '../layout/figma-component-resolver';
import { getNodeCss, type CssSourceNode } from './node-css';
import type {
  ConnectedComponentEntry,
  FrameInspection,
  InspectionDiagnostic,
  InspectionDiagnosticReason,
} from './types';

/** Minimal structural view of a node the inspection traversal reads. */
export type InspectableNode = CssSourceNode & {
  type: string;
  visible?: boolean | null;
  children?: readonly InspectableNode[];
};

export type InspectFrameOptions = GenerationLimits;

/**
 * Inspect one selected node: its Layout/Style CSS plus the connected component
 * instances in its subtree. Never throws.
 */
export async function inspectFrame(
  root: InspectableNode,
  options: InspectFrameOptions = {},
): Promise<FrameInspection> {
  const context = new GenerationContext(options);
  const diagnostics: InspectionDiagnostic[] = [];
  const connectedComponents: ConnectedComponentEntry[] = [];

  const cssResult = await getNodeCss(root);
  diagnostics.push(...cssResult.diagnostics);

  context.visit();
  if (root.type === 'INSTANCE') {
    // An instance root is itself the one candidate entry (the connected case
    // is normally routed to the component branch before inspection).
    await collectInstance(root, [root.name], context, connectedComponents, diagnostics);
  } else {
    await collectChildren(root, [root.name], context, connectedComponents, diagnostics);
  }

  if (context.isLimitReached) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: 'The selection is large; the connected-components list was truncated at the node limit.',
    });
  }

  return {
    nodeName: root.name,
    nodeType: root.type,
    css: cssResult.css,
    connectedComponents,
    diagnostics,
  };
}

async function collectChildren(
  node: InspectableNode,
  layerPath: string[],
  context: GenerationContext,
  entries: ConnectedComponentEntry[],
  diagnostics: InspectionDiagnostic[],
): Promise<void> {
  if (!context.enter()) {
    diagnostics.push({
      severity: 'warning',
      reason: 'node-limit',
      message: `Reached maximum depth at "${node.name}"; deeper descendants were not enumerated.`,
      nodeId: node.id,
      layerPath,
    });
    return;
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

    if (child.type === 'INSTANCE') {
      await collectInstance(child, childPath, context, entries, diagnostics);
      continue; // Atomic boundary — internals are never visited.
    }
    if (child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') {
      continue; // Main-component boundary — not a usage; never traversed.
    }
    await collectChildren(child, childPath, context, entries, diagnostics);
  }

  context.exit();
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
