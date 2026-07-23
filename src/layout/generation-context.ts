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

// Figma node types (ComponentNode, InstanceNode) are ambient globals provided
// by @figma/plugin-typings; no import needed.

/** A connection read outcome, mirroring `main.ts`'s private `ConnectionReadResult`. */
export type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { ok: false; message: string };

export type GenerationLimits = {
  /** Max traversal depth below the root (root is depth 0). Default 64. */
  maxDepth?: number;
  /** Max nodes visited before a partial result is returned. Default 500. */
  maxNodes?: number;
};

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 500;

/**
 * Mutable accumulator for one generation. `visit()` enforces the node-count
 * limit and reports whether traversal should stop; `enter()/exit()` track depth.
 */
export class GenerationContext {
  readonly maxDepth: number;
  readonly maxNodes: number;

  private readonly mainComponentCache = new Map<string, ComponentNode | null>();
  private readonly connectionCache = new Map<string, ConnectionReadResult>();
  private depth = 0;
  private nodesVisited = 0;
  /** Set once the node-count limit is reached; stays set for the run. */
  private limitReached = false;

  constructor(limits: GenerationLimits = {}) {
    this.maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;
    this.maxNodes = limits.maxNodes ?? DEFAULT_MAX_NODES;
  }

  /** True once the node budget is exhausted. */
  get isLimitReached(): boolean {
    return this.limitReached;
  }

  get currentDepth(): number {
    return this.depth;
  }

  /**
   * Record one visited node. Returns false when the node budget is exhausted
   * and traversal should stop.
   */
  visit(): boolean {
    this.nodesVisited += 1;
    if (this.nodesVisited > this.maxNodes) {
      this.limitReached = true;
      return false;
    }
    return true;
  }

  enter(): boolean {
    if (this.depth >= this.maxDepth) {
      return false;
    }
    this.depth += 1;
    return true;
  }

  exit(): void {
    if (this.depth > 0) {
      this.depth -= 1;
    }
  }

  // ---- per-generation caches ------------------------------------------------

  getCachedMainComponent(instanceId: string): ComponentNode | null | undefined {
    return this.mainComponentCache.get(instanceId);
  }

  cacheMainComponent(instanceId: string, component: ComponentNode | null): void {
    this.mainComponentCache.set(instanceId, component);
  }

  getCachedConnection(nodeId: string): ConnectionReadResult | undefined {
    return this.connectionCache.get(nodeId);
  }

  cacheConnection(nodeId: string, result: ConnectionReadResult): void {
    this.connectionCache.set(nodeId, result);
  }
}

/**
 * Read the connection target for a main component, mirroring `main.ts`'s
 * private `getConnectionTarget`: a component inside a COMPONENT_SET resolves to
 * the set; otherwise the component is its own target.
 */
export function getConnectionTarget(component: ComponentNode): ComponentNode {
  if (component.parent?.type === 'COMPONENT_SET') {
    return component.parent as unknown as ComponentNode;
  }
  return component;
}

/** Narrowing helper for instance doubles. */
export function isInstanceNode(node: { type: string }): node is InstanceNode {
  return node.type === 'INSTANCE';
}
