/**
 * Resolve a Figma INSTANCE into a layout IR component node or a placeholder.
 *
 * This is the only place that bridges a connected instance to its production
 * `ComponentUsage`. It reuses the exported validation/migration helpers from
 * `codegen.ts` and `createComponentUsage` so a layout's component output is
 * byte-identical to selecting that instance alone in Dev Mode / Inspect Code.
 *
 * The instance's internal Figma children are never visited — the roadmap's
 * atomic-boundary invariant.
 */

import {
  createComponentUsage,
  migratePersistedConnectionMetadata,
  validatePersistedConnectionMetadata,
  type MappingDiagnostic,
} from '../codegen';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  type ConnectionIssue,
} from '../types';
import {
  type ConnectionReadResult,
  type GenerationContext,
  getConnectionTarget,
} from './generation-context';
import type {
  ComponentCompositionNode,
  ComponentUsage,
  LayoutDiagnostic,
  PlaceholderCompositionNode,
} from './types';

/** The resolved outcome for an instance: either a usable component node or a placeholder. */
export type ResolvedInstance =
  | { kind: 'component'; node: ComponentCompositionNode }
  | { kind: 'placeholder'; node: PlaceholderCompositionNode; diagnostic: LayoutDiagnostic };

/** A minimal view of a Figma INSTANCE double the resolver consumes. */
export type InstanceLike = {
  id: string;
  name: string;
  type: 'INSTANCE';
  componentProperties: Record<string, { type: string; value: string | boolean }>;
  getMainComponentAsync: () => Promise<ComponentNode | null>;
  getSharedPluginData?: never;
};

/** Result of reading component properties + instance swaps, like `ResolvedSelection`. */
type ResolvedSelectionLike = {
  componentProperties: Record<string, string | boolean>;
  displayText: string;
  instanceSwaps: Record<string, { componentId: string; componentName: string }>;
};

/**
 * Resolve one instance against the context's caches. Never throws — a broken
 * instance becomes a placeholder with a diagnostic, so a single failure never
 * discards the rest of the layout.
 */
export async function resolveInstance(
  instance: InstanceLike,
  context: GenerationContext,
): Promise<ResolvedInstance> {
  const layerPath = [instance.name];
  const mainComponent = await resolveMainComponent(instance, context);

  if (!mainComponent) {
    return placeholder(instance.id, layerPath, 'missing-main-component', {
      severity: 'warning',
      reason: 'missing-main-component',
      message: `"${instance.name}" has no main component; it was emitted as a placeholder.`,
      nodeId: instance.id,
      layerPath,
    });
  }

  const connectionTarget = getConnectionTarget(mainComponent);
  const rawConnection = readSharedPluginData(connectionTarget);

  // No persisted data → unconnected (info), distinct from a broken connection.
  if (!rawConnection) {
    return placeholder(instance.id, layerPath, 'unconnected-instance', {
      severity: 'info',
      reason: 'unconnected-instance',
      message: `"${instance.name}" is not connected to a production component.`,
      nodeId: instance.id,
      layerPath,
    });
  }

  const connection = readConnection(connectionTarget, context, rawConnection);

  if (!connection.ok) {
    return placeholder(instance.id, layerPath, 'invalid-connection', {
      severity: 'warning',
      reason: 'invalid-connection',
      message: `"${instance.name}" has a stored connection that could not be read.`,
      nodeId: instance.id,
      layerPath,
    });
  }

  const selection = buildSelectionLike(instance, mainComponent, connectionTarget);
  let usage: ComponentUsage;
  try {
    usage = createComponentUsage(connection.metadata, selection);
  } catch (_error) {
    return placeholder(instance.id, layerPath, 'invalid-connection', {
      severity: 'error',
      reason: 'invalid-connection',
      message: `"${instance.name}" could not be turned into a component usage.`,
      nodeId: instance.id,
      layerPath,
    });
  }

  return {
    kind: 'component',
    node: {
      kind: 'component',
      nodeId: instance.id,
      layerPath,
      usage,
    },
  };
}

async function resolveMainComponent(
  instance: InstanceLike,
  context: GenerationContext,
): Promise<ComponentNode | null> {
  const cached = context.getCachedMainComponent(instance.id);
  if (cached !== undefined) {
    return cached;
  }
  let main: ComponentNode | null;
  try {
    main = await instance.getMainComponentAsync();
  } catch (_error) {
    main = null;
  }
  context.cacheMainComponent(instance.id, main);
  return main;
}

/**
 * Read + validate persisted connection metadata, cached per node id. Mirrors
 * `main.ts`'s private `readConnectionMetadata` / `parsePersistedConnectionMetadata`.
 * `raw` is the non-empty string already read from shared plugin data.
 */
function readConnection(
  component: ComponentNode,
  context: GenerationContext,
  raw: string,
): ConnectionReadResult {
  const cached = context.getCachedConnection(component.id);
  if (cached) {
    return cached;
  }

  const result: ConnectionReadResult = parseConnectionMetadata(raw);
  context.cacheConnection(component.id, result);
  return result;
}

function readSharedPluginData(component: ComponentNode): string {
  try {
    return component.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);
  } catch (_error) {
    return '';
  }
}

function parseConnectionMetadata(raw: string): ConnectionReadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    return { ok: false, message: 'Stored connection data is malformed JSON.' };
  }

  const validation = validatePersistedConnectionMetadata(parsed);
  if (!validation.ok) {
    return { ok: false, message: validation.issue.message };
  }

  return { ok: true, metadata: migratePersistedConnectionMetadata(validation.metadata) };
}

/**
 * Build the selection-like object `createComponentUsage` expects. Mirrors
 * `main.ts`'s `collectComponentProperties` + `collectInstanceSwaps`, scoped to
 * a single instance (no parent-property merge across the connection target,
 * which keeps the layout path simple — the instance's own properties drive the
 * usage).
 */
function buildSelectionLike(
  instance: InstanceLike,
  mainComponent: ComponentNode,
  connectionTarget: ComponentNode,
): ResolvedSelectionLike {
  const componentProperties = collectProperties(instance, mainComponent, connectionTarget);
  return {
    componentProperties,
    displayText: getDisplayText(instance),
    instanceSwaps: collectInstanceSwaps(instance),
  };
}

function collectProperties(
  instance: InstanceLike,
  ..._sources: ComponentNode[]
): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = {};
  for (const [rawName, property] of Object.entries(instance.componentProperties)) {
    properties[normalizePropertyName(rawName)] = property.value;
  }
  // ponytail: the standalone-selection path in main.ts also merges variant
  // properties from the main component and connection target. The layout path
  // intentionally uses only the instance's own resolved properties, since an
  // instance inside a layout already carries its effective values. Upgrade if a
  // connected instance inside a layout needs the same parent-property fallback.
  return properties;
}

function collectInstanceSwaps(
  _instance: InstanceLike,
): Record<string, { componentId: string; componentName: string }> {
  // ponytail: instance-swap resolution requires figma.getNodeByIdAsync, which is
  // wired in Phase 2's main-integration. The resolver accepts pre-resolved swaps
  // via the context in a later step; for now connected instances without icon
  // swaps are the common case in version-1 layouts.
  return {};
}

function normalizePropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}

function getDisplayText(node: { name: string; characters?: string }): string {
  if (typeof node.characters === 'string' && node.characters.length > 0) {
    return node.characters;
  }
  return node.name;
}

function placeholder(
  nodeId: string,
  layerPath: string[],
  reason: PlaceholderCompositionNode['reason'],
  diagnostic: LayoutDiagnostic,
): ResolvedInstance {
  return {
    kind: 'placeholder',
    node: { kind: 'placeholder', nodeId, layerPath, reason },
    diagnostic,
  };
}

/** Re-export for callers that want the diagnostic + any mapping diagnostics together. */
export type { MappingDiagnostic, ConnectionIssue };
