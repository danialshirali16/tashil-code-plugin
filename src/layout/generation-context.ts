/**
 * Per-generation context for the Figma layout extractor (Phase 2).
 *
 * Holds the caches and limits a single `extractLayout` call uses. Created fresh
 * per generation (never global) so invalidation is trivial — when the call
 * ends, the context is discarded. Spec: roadmap §"Phase 2" caches + limits.
 *
 * The context is the one place the extractor touches async Figma lookups, so
 * caching here guarantees no duplicate `getMainComponentAsync` or metadata read
 * happens for the same instance during one generation.
 */

import type { ConnectionMetadata } from '../types';

/** A connection read outcome, mirroring `main.ts`'s private `ConnectionReadResult`. */
export type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { ok: false; message: string };

export type GenerationLimits = {
  /** Max traversal depth below the root (root is depth 0). Default 64. */
  maxDepth?: number;
  /** Max nodes visited before a partial result is returned. Default 500. */
  maxNodes?: number;
  /** Maximum sibling tasks evaluated concurrently. Default 8. */
  maxConcurrency?: number;
};

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 500;

/**
 * Shared caches and limits for one generation request.
 */
export class GenerationContext {
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxConcurrency: number;

  private readonly mainComponentCache = new Map<string, unknown | null>();
  private readonly connectionCache = new Map<string, ConnectionReadResult>();
  private readonly cssCache = new Map<string, Promise<Record<string, string>>>();
  private readonly variableCache = new Map<
    string,
    Promise<{ id: string; name: string } | null>
  >();
  constructor(limits: GenerationLimits = {}) {
    this.maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
    this.maxConcurrency = Math.max(1, limits.maxConcurrency ?? 8);
  }

  /**
   * Create an independent node budget for one traversal. React extraction and
   * selected-layer inspection share caches without consuming each other's
   * traversal allowance.
   */
  createTraversal(): GenerationTraversal {
    return new GenerationTraversal(this.maxNodes);
  }

  // ---- per-generation caches ------------------------------------------------

  getCachedMainComponent<T>(instanceId: string): T | null | undefined {
    return this.mainComponentCache.get(instanceId) as T | null | undefined;
  }

  cacheMainComponent<T>(instanceId: string, component: T | null): void {
    this.mainComponentCache.set(instanceId, component);
  }

  getCachedConnection(nodeId: string): ConnectionReadResult | undefined {
    return this.connectionCache.get(nodeId);
  }

  cacheConnection(nodeId: string, result: ConnectionReadResult): void {
    this.connectionCache.set(nodeId, result);
  }

  getNodeCss(
    nodeId: string,
    load: () => Promise<Record<string, string>>,
  ): Promise<Record<string, string>> {
    const cached = this.cssCache.get(nodeId);
    if (cached) {
      return cached;
    }
    const pending = load();
    this.cssCache.set(nodeId, pending);
    return pending;
  }

  getVariable(
    variableId: string,
    load: () => Promise<{ id: string; name: string } | null>,
  ): Promise<{ id: string; name: string } | null> {
    const cached = this.variableCache.get(variableId);
    if (cached) {
      return cached;
    }
    const pending = load();
    this.variableCache.set(variableId, pending);
    return pending;
  }
}

export class GenerationTraversal {
  private nodesVisited = 0;
  private limitReached = false;

  constructor(private readonly maxNodes: number) {}

  get isLimitReached(): boolean {
    return this.limitReached;
  }

  visit(): boolean {
    this.nodesVisited += 1;
    if (this.nodesVisited > this.maxNodes) {
      this.limitReached = true;
      return false;
    }
    return true;
  }
}

export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  task: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await task(values[index], index);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, limit), values.length) },
      () => worker(),
    ),
  );
  return results;
}

/**
 * Read the connection target for a main component, mirroring `main.ts`'s
 * private `getConnectionTarget`: a component inside a COMPONENT_SET resolves to
 * the set; otherwise the component is its own target.
 */
export function getConnectionTarget<
  T extends { parent?: { type?: string } | null },
>(component: T): T {
  if (component.parent?.type === 'COMPONENT_SET') {
    return component.parent as unknown as T;
  }
  return component;
}

/** Narrowing helper for instance doubles. */
export function isInstanceNode<T extends { type: string }>(
  node: T,
): node is T & { type: 'INSTANCE' } {
  return node.type === 'INSTANCE';
}
