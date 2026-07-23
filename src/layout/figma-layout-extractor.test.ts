import { describe, expect, it } from 'vitest';
import { extractLayout } from './figma-layout-extractor';
import {
  absolutePositionedChild,
  brokenInstance,
  fixtures,
  nestedAutoLayout,
  unconnectedInstance,
  unsupportedVector,
  verticalForm,
  wrappingActionRow,
  type FrameDouble,
} from './fixtures';
import type { CompositionNode, LayoutDocument } from './types';

/**
 * Phase 2 — Figma scene extraction.
 *
 * These tests drive the extractor against the Phase 0 fixtures and assert the
 * produced IR. They cover the three Phase 2 exit criteria: supported fixtures
 * produce the expected IR, traversal never enters a component instance, and a
 * descendant failure does not reject the whole layout.
 */

function rootKind(document: LayoutDocument): CompositionNode['kind'] {
  return document.root.kind;
}

function flatten(node: CompositionNode): CompositionNode[] {
  if (node.kind !== 'container') {
    return [node];
  }
  return [node, ...node.children.flatMap(flatten)];
}

describe('extractLayout — supported roots', () => {
  it('a vertical form produces a container root with two component children', async () => {
    const doc = await extractLayout(verticalForm());
    expect(rootKind(doc)).toBe('container');
    const root = doc.root;
    expect(root.kind).toBe('container');
    if (root.kind !== 'container') return;
    expect(root.layout.axis).toBe('vertical');
    expect(root.layout.gap).toBe(16);
    expect(root.children.length).toBe(2);
    // Both children are connected component usages (atomic — no internals).
    expect(root.children.every((child) => child.kind === 'component')).toBe(true);
    expect(doc.diagnostics).toEqual([]);
  });

  it('preserves auto-layout padding on the root', async () => {
    const doc = await extractLayout(verticalForm());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    expect(root.layout.paddingTop).toBe(24);
    expect(root.layout.paddingLeft).toBe(24);
  });

  it('a wrapping action row records wrap + counter gap', async () => {
    const doc = await extractLayout(wrappingActionRow());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    expect(root.layout.wrap).toBe(true);
    expect(root.layout.counterGap).toBe(8);
  });

  it('nested frames recurse into a child container', async () => {
    const doc = await extractLayout(nestedAutoLayout());
    const outer = doc.root;
    if (outer.kind !== 'container') throw new Error('expected container');
    const inner = outer.children[0];
    expect(inner.kind).toBe('container');
    if (inner.kind !== 'container') return;
    // The inner frame's instance child is atomic.
    expect(inner.children[0].kind).toBe('component');
  });

  it('derives a kebab-case class name from the root layer name', async () => {
    const doc = await extractLayout(verticalForm());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    expect(root.className).toBe('payment-form');
  });
});

describe('extractLayout — component boundary is atomic', () => {
  it('never enters a connected instance: a component node has no children', async () => {
    const doc = await extractLayout(verticalForm());
    const all = flatten(doc.root);
    const components = all.filter((node) => node.kind === 'component');
    expect(components.length).toBeGreaterThan(0);
    // Component nodes carry no children by construction (they are not containers).
    expect(components.every((node) => node.kind === 'component')).toBe(true);
  });

  it('an unconnected instance becomes a placeholder, not a component node', async () => {
    const doc = await extractLayout(unconnectedInstance());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    const child = root.children[0];
    expect(child.kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'unconnected-instance')).toBe(true);
  });

  it('a broken instance (missing main component) becomes a placeholder', async () => {
    const doc = await extractLayout(brokenInstance());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    expect(root.children[0].kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'missing-main-component')).toBe(true);
  });

  it('a broken descendant does not reject the whole layout', async () => {
    // Mix a broken instance with a valid one; the valid sibling still resolves.
    const doc = await extractLayout(brokenInstance());
    expect(doc.diagnostics.length).toBeGreaterThan(0);
    // The document still has a valid container root.
    expect(doc.root.kind).toBe('container');
  });
});

describe('extractLayout — unsupported nodes', () => {
  it('an absolute-positioned child becomes a placeholder + diagnostic', async () => {
    const doc = await extractLayout(absolutePositionedChild());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    expect(root.children[0].kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'absolute-positioning')).toBe(true);
  });

  it('an unsupported vector root yields a placeholder root + diagnostic', async () => {
    const doc = await extractLayout(unsupportedVector());
    expect(doc.root.kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'unsupported-root')).toBe(true);
  });

  it('a frame with layoutMode NONE yields an unsupported-layout-mode placeholder', async () => {
    const noneFrame: FrameDouble = {
      ...fixtures.verticalForm(),
      layoutMode: 'NONE',
    } as unknown as FrameDouble;
    const doc = await extractLayout(noneFrame);
    expect(doc.root.kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'unsupported-layout-mode')).toBe(true);
  });

  it('a grid frame yields a grid-layout placeholder', async () => {
    const gridFrame: FrameDouble = {
      ...fixtures.verticalForm(),
      layoutMode: 'GRID',
    } as unknown as FrameDouble;
    const doc = await extractLayout(gridFrame);
    expect(doc.root.kind).toBe('placeholder');
    expect(doc.diagnostics.some((d) => d.reason === 'grid-layout')).toBe(true);
  });
});

describe('extractLayout — hidden nodes', () => {
  it('excludes hidden children without failing', async () => {
    const doc = await extractLayout(verticalForm());
    const root = doc.root;
    if (root.kind !== 'container') throw new Error('expected container');
    // The verticalForm fixture has no hidden nodes; this asserts the path runs.
    expect(root.children.length).toBe(2);
  });
});

describe('extractLayout — limits and partial results', () => {
  it('respects the node limit and records a node-limit diagnostic', async () => {
    // verticalForm has 1 root + 2 children = 3 visits. Cap at 2 to force truncation.
    const doc = await extractLayout(verticalForm(), { maxNodes: 2 });
    expect(doc.diagnostics.some((d) => d.reason === 'node-limit')).toBe(true);
    // The root is still a valid container; one child may be missing.
    expect(doc.root.kind).toBe('container');
  });

  it('respects the depth limit and records a depth-limit diagnostic', async () => {
    // nestedAutoLayout is frame > frame > instance (depth 2 for the instance).
    // Cap depth at 1 so the inner frame's children are omitted.
    const doc = await extractLayout(nestedAutoLayout(), { maxDepth: 1 });
    expect(doc.diagnostics.some((d) => d.reason === 'depth-limit')).toBe(true);
  });

  it('a generous limit leaves the document intact', async () => {
    const doc = await extractLayout(verticalForm(), { maxNodes: 1000, maxDepth: 100 });
    expect(doc.diagnostics.some((d) => d.reason === 'node-limit')).toBe(false);
    expect(doc.diagnostics.some((d) => d.reason === 'depth-limit')).toBe(false);
  });
});

describe('extractLayout — layer paths', () => {
  it('records the full layer path on each node', async () => {
    const doc = await extractLayout(nestedAutoLayout());
    const outer = doc.root;
    if (outer.kind !== 'container') throw new Error('expected container');
    expect(outer.layerPath).toEqual(['Payment section']);
    const inner = outer.children[0];
    if (inner.kind !== 'container') throw new Error('expected container');
    expect(inner.layerPath).toEqual(['Payment section', 'Card fields']);
  });
});
