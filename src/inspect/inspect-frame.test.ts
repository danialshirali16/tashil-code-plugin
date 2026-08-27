import { describe, expect, it } from 'vitest';

import {
  brokenInstance,
  component,
  connectedMultiplePackages,
  connection,
  frame,
  instance,
  nestedAutoLayout,
  text,
  unconnectedInstance,
  verticalForm,
  wrappingActionRow,
} from '../layout/fixtures';
import { inspectFrame, type InspectableNode } from './inspect-frame';

/**
 * Phase C — frame inspection assembly.
 *
 * Drives `inspectFrame` against the Phase 0 fixtures: connected instances are
 * enumerated with layer paths and usages, broken/unconnected instances become
 * diagnostics, boundaries stay atomic, and CSS degrades gracefully when
 * `getCSSAsync` is absent (the fixture doubles don't implement it).
 */

/** Attach a `getCSSAsync` double to a fixture root. */
function withCss(
  node: unknown,
  css: { [key: string]: string },
): InspectableNode {
  return {
    ...(node as InspectableNode),
    getCSSAsync: () => Promise.resolve(css),
  };
}

const PANEL_CSS = {
  display: 'flex',
  padding: 'var(--spacer-3, 1rem)',
  'flex-direction': 'column',
  gap: 'var(--spacer-3, 1rem)',
  'border-bottom': '1px solid var(--color-border)',
};

describe('inspectFrame — CSS sections', () => {
  it('partitions the root CSS into Layout and Style', async () => {
    const inspection = await inspectFrame(withCss(verticalForm(), PANEL_CSS));

    expect(inspection.nodeName).toBe('Payment form');
    expect(inspection.nodeType).toBe('FRAME');
    expect(inspection.css.layout.map((d) => d.property)).toEqual([
      'display',
      'padding',
      'flex-direction',
      'gap',
    ]);
    expect(inspection.css.style).toEqual([
      { property: 'border-bottom', value: '1px solid var(--color-border)' },
    ]);
  });

  it('degrades to css-unavailable when the runtime lacks getCSSAsync, keeping the component list', async () => {
    const inspection = await inspectFrame(verticalForm() as unknown as InspectableNode);

    expect(inspection.css).toEqual({ layout: [], style: [] });
    expect(inspection.diagnostics.some((d) => d.reason === 'css-unavailable')).toBe(true);
    expect(inspection.connectedComponents).toHaveLength(2);
  });
});

describe('inspectFrame — text style', () => {
  it('resolves the Figma text-style name for a TEXT node', async () => {
    const label = text('t:label', 'Label', 'Hello', {
      textStyleId: 'S:body-md',
      css: {
        color: 'var(--color-text-default, #111)',
        'font-family': 'var(--font-family)',
        'font-size': 'var(--font-size-body)',
        'font-weight': 'var(--font-weight-400)',
      },
    }) as unknown as InspectableNode;
    const inspection = await inspectFrame(label, {
      loadTextStyle: async (id) =>
        id === 'S:body-md' ? { name: 'Body/MD Normal' } : null,
    });

    expect(inspection.textStyleName).toBe('body_md_normal');
    expect(inspection.css.style).toHaveLength(4);
  });

  it('leaves textStyleName unset when the node has no text style', async () => {
    const label = text('t:plain', 'Label', 'Hello', {
      css: { color: '#111' },
    }) as unknown as InspectableNode;
    const inspection = await inspectFrame(label);

    expect(inspection.textStyleName).toBeUndefined();
  });
});

describe('inspectFrame — connected components', () => {
  it('enumerates connected instances in document order with layer paths', async () => {
    const inspection = await inspectFrame(withCss(verticalForm(), {}));

    expect(inspection.connectedComponents.map((entry) => entry.componentName)).toEqual([
      'TextField',
      'Button',
    ]);
    expect(inspection.connectedComponents[0].layerPath).toEqual([
      'Payment form',
      'TextField / Email',
    ]);
    expect(inspection.connectedComponents[1].usage.jsx).toContain('<Button');
    expect(inspection.connectedComponents[1].usage.imports).toEqual([
      { importedName: 'Button', localName: 'Button', modulePath: '@tashilcar/ui' },
    ]);
  });

  it('recurses nested frames and never enters an instance', async () => {
    const inspection = await inspectFrame(withCss(nestedAutoLayout(), {}));

    expect(inspection.connectedComponents).toHaveLength(1);
    expect(inspection.connectedComponents[0].layerPath).toEqual([
      'Payment section',
      'Card fields',
      'TextField / Card number',
    ]);
  });

  it('collects entries across packages', async () => {
    const inspection = await inspectFrame(withCss(connectedMultiplePackages(), {}));
    expect(inspection.connectedComponents.map((entry) => entry.usage.imports[0].modulePath)).toEqual([
      '@tashilcar/ui',
      '@tashilcar/forms',
    ]);
  });

  it('reports an unconnected instance as an info diagnostic, not an entry', async () => {
    const inspection = await inspectFrame(withCss(unconnectedInstance(), {}));

    expect(inspection.connectedComponents).toEqual([]);
    const diagnostic = inspection.diagnostics.find((d) => d.reason === 'unconnected-instance');
    expect(diagnostic).toMatchObject({
      severity: 'info',
      layerPath: ['Frame with unconnected instance', 'Button / Ghost'],
    });
  });

  it('reports a broken instance without discarding sibling results', async () => {
    const inspection = await inspectFrame(withCss(brokenInstance(), {}));
    expect(inspection.diagnostics.some((d) => d.reason === 'missing-main-component')).toBe(true);
    expect(inspection.css).toEqual({ layout: [], style: [] });
  });
});

describe('inspectFrame — limits and determinism', () => {
  it('truncates at the node limit with a node-limit diagnostic', async () => {
    const inspection = await inspectFrame(withCss(wrappingActionRow(), {}), { maxNodes: 3 });

    expect(inspection.connectedComponents.length).toBeLessThan(4);
    expect(inspection.diagnostics.some((d) => d.reason === 'node-limit')).toBe(true);
  });

  it('is deterministic across repeated calls', async () => {
    const first = await inspectFrame(withCss(verticalForm(), PANEL_CSS));
    const second = await inspectFrame(withCss(verticalForm(), PANEL_CSS));
    expect(second).toEqual(first);
  });

  it('handles a 500-instance frame with one metadata read per connection target', async () => {
    // Phase F benchmark shape: many instances sharing one main component. The
    // per-generation cache must read + parse the connection metadata once.
    let metadataReads = 0;
    const shared = component('c:shared', 'Button');
    (shared as { getSharedPluginData: (namespace: string, key: string) => string })
      .getSharedPluginData = () => {
        metadataReads += 1;
        return JSON.stringify(connection());
      };
    const children = Array.from({ length: 500 }, (_, index) =>
      instance(`i:${index}`, `Button ${index}`, shared));
    const root = withCss(frame('f:big', 'Big frame', children), {});

    const started = Date.now();
    const inspection = await inspectFrame(root);
    const elapsed = Date.now() - started;

    // Root + 500 children exceeds the default 500-node budget by one; the
    // result is a controlled truncation, not a failure.
    expect(inspection.connectedComponents.length).toBe(499);
    expect(inspection.diagnostics.some((d) => d.reason === 'node-limit')).toBe(true);
    expect(metadataReads).toBe(1);
    expect(elapsed).toBeLessThan(2000);
  });
});
