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
  type SelectionLike,
} from '../codegen';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  type ConnectionIssue,
  type ConnectionMetadata,
} from '../types';
import { resolveSemanticUsage } from '../semantic/resolver';
import { createSemanticNodeTree } from '../semantic/figma-adapter';
import type { ComponentUsage } from './types';
import {
  type ConnectionReadResult,
  type GenerationContext,
  getConnectionTarget,
} from './generation-context';
import type {
  ComponentCompositionNode,
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

  // Read raw connection data once, cached per connection target so a shared main
  // component is read and parsed at most once per generation (the performance
  // invariant Phase 6 verifies). Only successful parses are cached; the
  // unconnected/invalid reason is always determinable from the raw read below.
  const cachedConnection = context.getCachedConnection(connectionTarget.id);
  if (cachedConnection?.ok) {
    return buildComponentNode(
      instance,
      mainComponent,
      connectionTarget,
      cachedConnection,
      layerPath,
    );
  }

  const rawConnection = readSharedPluginData(connectionTarget);

  // No persisted data → unconnected (info), distinct from a broken connection.
  if (!rawConnection) {
    return placeholder(
      instance.id,
      layerPath,
      'unconnected-instance',
      {
        severity: 'info',
        reason: 'unconnected-instance',
        message: `"${instance.name}" is not connected to a production component.`,
        nodeId: instance.id,
        layerPath,
      },
      `FRAME: ${instance.name}`,
    );
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

  return buildComponentNode(
    instance,
    mainComponent,
    connectionTarget,
    connection,
    layerPath,
  );
}

/** Build the success-case component node, isolating the createComponentUsage call. */
async function buildComponentNode(
  instance: InstanceLike,
  mainComponent: ComponentNode,
  connectionTarget: ComponentNode,
  connection: Extract<ConnectionReadResult, { ok: true }>,
  layerPath: string[],
): Promise<ResolvedInstance> {
  try {
    const selection = await buildSelectionLike(
      instance,
      mainComponent,
      connectionTarget,
    );
    const usage = await createConnectedUsage(
      connection.metadata,
      selection,
      instance,
    );
    return {
      kind: 'component',
      node: { kind: 'component', nodeId: instance.id, layerPath, usage },
    };
  } catch (_error) {
    return placeholder(instance.id, layerPath, 'invalid-connection', {
      severity: 'error',
      reason: 'invalid-connection',
      message: `"${instance.name}" could not be turned into a component usage.`,
      nodeId: instance.id,
      layerPath,
    });
  }
}

/**
 * Turn a connected instance into its production `ComponentUsage`. A semantic
 * recipe resolves through the shared semantic pipeline; the instance's live
 * top-level component properties drive variant/enum values, while nested design
 * values come from the recipe's captured snapshot — Layout Composer never
 * traverses the connected component's internal design layers (roadmap M4
 * "Do not expose internal semantic Figma locators to layout traversal").
 * Legacy connections keep `createComponentUsage` byte-for-byte.
 */
async function createConnectedUsage(
  metadata: ConnectionMetadata,
  selection: SelectionLike,
  instance: InstanceLike,
): Promise<ComponentUsage> {
  if (metadata.semanticRecipe) {
    const root = await createSemanticNodeTree(instance as unknown as SceneNode);
    const result = resolveSemanticUsage(
      metadata.componentName,
      metadata.importPath,
      metadata.semanticRecipe,
      {
        componentProperties: selection.componentProperties,
        root,
      },
    );
    return result.usage;
  }

  return createComponentUsage(metadata, selection);
}

async function resolveMainComponent(
  instance: InstanceLike,
  context: GenerationContext,
): Promise<ComponentNode | null> {
  const cached = context.getCachedMainComponent<ComponentNode>(instance.id);
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
 * Parse + cache persisted connection metadata. `raw` is the non-empty string
 * already read from shared plugin data. The cache check happens in the caller
 * (`resolveInstance`); this function always parses and stores the result.
 */
function readConnection(
  component: ComponentNode,
  context: GenerationContext,
  raw: string,
): ConnectionReadResult {
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
async function buildSelectionLike(
  instance: InstanceLike,
  mainComponent: ComponentNode,
  connectionTarget: ComponentNode,
): Promise<ResolvedSelectionLike> {
  return {
    componentProperties: collectProperties([
      connectionTarget,
      mainComponent,
      instance,
    ]),
    displayText: getDisplayText(instance),
    instanceSwaps: await collectInstanceSwaps([
      connectionTarget,
      mainComponent,
      instance,
    ]),
  };
}

function collectProperties(
  nodes: ReadonlyArray<ComponentNode | InstanceLike>,
): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = {};
  for (const node of nodes) {
    if ('componentProperties' in node) {
      for (const [rawName, property] of Object.entries(node.componentProperties)) {
        properties[normalizePropertyName(rawName)] = property.value;
      }
    }
    if ('variantProperties' in node && node.variantProperties) {
      for (const [rawName, value] of Object.entries(node.variantProperties)) {
        if (typeof value === 'string') {
          properties[normalizePropertyName(rawName)] = value;
        }
      }
    }
  }
  return properties;
}

async function collectInstanceSwaps(
  nodes: ReadonlyArray<ComponentNode | InstanceLike>,
): Promise<Record<string, { componentId: string; componentName: string }>> {
  const swaps: Record<string, { componentId: string; componentName: string }> = {};

  for (const node of nodes) {
    if (!('componentProperties' in node)) {
      continue;
    }
    for (const [rawName, property] of Object.entries(node.componentProperties)) {
      if (property.type !== 'INSTANCE_SWAP' || typeof property.value !== 'string') {
        continue;
      }
      const resolved = await resolveSwapComponent(property.value);
      if (resolved) {
        swaps[normalizePropertyName(rawName)] = resolved;
      }
    }
  }

  return swaps;
}

async function resolveSwapComponent(
  componentId: string,
): Promise<{ componentId: string; componentName: string } | undefined> {
  try {
    const component = await figma.getNodeByIdAsync(componentId);
    if (!component || component.type !== 'COMPONENT') {
      return undefined;
    }
    return { componentId: component.id, componentName: component.name };
  } catch (_error) {
    return undefined;
  }
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
  label?: string,
): ResolvedInstance {
  return {
    kind: 'placeholder',
    node: {
      kind: 'placeholder',
      nodeId,
      layerPath,
      reason,
      ...(label ? { label } : {}),
    },
    diagnostic,
  };
}

/** Re-export for callers that want the diagnostic + any mapping diagnostics together. */
export type { MappingDiagnostic, ConnectionIssue };
