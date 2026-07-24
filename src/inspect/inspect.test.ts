import { describe, expect, it } from 'vitest';

import { formatCssBlock, isLayoutProperty, partitionCss } from './css-partition';
import { getNodeCss, type CssSourceNode } from './node-css';
import { formatConnectedComponentsSnippet, formatUsageSnippet } from './usage-snippet';
import type { ConnectedComponentEntry, CssDeclaration } from './types';

function decl(property: string, value: string): CssDeclaration {
  return { property, value };
}

describe('isLayoutProperty', () => {
  const layoutProperties = [
    'display',
    'flex-direction',
    'flex-wrap',
    'flex-flow',
    'flex',
    'flex-grow',
    'flex-shrink',
    'flex-basis',
    'gap',
    'row-gap',
    'column-gap',
    'justify-content',
    'align-items',
    'align-self',
    'align-content',
    'padding',
    'padding-top',
    'padding-right',
    'padding-bottom',
    'padding-left',
    'width',
    'height',
    'min-width',
    'min-height',
    'max-width',
    'max-height',
    'position',
    'top',
    'right',
    'bottom',
    'left',
    'overflow',
    'overflow-x',
    'overflow-y',
    'box-sizing',
    'grid',
    'grid-template-columns',
    'grid-auto-rows',
  ];

  it.each(layoutProperties)('classifies %s as Layout', (property) => {
    expect(isLayoutProperty(property)).toBe(true);
  });

  const styleProperties = [
    'background',
    'background-color',
    'border',
    'border-bottom',
    'border-radius',
    'box-shadow',
    'opacity',
    'color',
    'fill',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'letter-spacing',
    'text-align',
    'backdrop-filter',
    'mix-blend-mode',
  ];

  it.each(styleProperties)('classifies %s as Style', (property) => {
    expect(isLayoutProperty(property)).toBe(false);
  });

  it('defaults unknown and future properties to Style', () => {
    expect(isLayoutProperty('view-transition-name')).toBe(false);
    expect(isLayoutProperty('corner-shape')).toBe(false);
    expect(isLayoutProperty('')).toBe(false);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(isLayoutProperty(' Display ')).toBe(true);
    expect(isLayoutProperty('PADDING-LEFT')).toBe(true);
  });
});

describe('partitionCss', () => {
  it('splits the Dev Mode panel example into Layout and Style, preserving order', () => {
    // Mirrors Figma's native panel for an auto-layout frame with a bottom
    // border (the Phase A reference screenshot).
    const declarations = [
      decl('display', 'flex'),
      decl('padding', 'var(--spacer-3, 1rem)'),
      decl('flex-direction', 'column'),
      decl('align-items', 'flex-start'),
      decl('gap', 'var(--spacer-3, 1rem)'),
      decl('flex', '1 0 0'),
      decl('align-self', 'stretch'),
      decl('border-bottom', '1px solid var(--color-border)'),
    ];

    const result = partitionCss(declarations);

    expect(result.layout.map((d) => d.property)).toEqual([
      'display',
      'padding',
      'flex-direction',
      'align-items',
      'gap',
      'flex',
      'align-self',
    ]);
    expect(result.style).toEqual([
      decl('border-bottom', '1px solid var(--color-border)'),
    ]);
  });

  it('passes variable-backed values through unmodified', () => {
    const result = partitionCss([decl('gap', 'var(--spacer-2, 0.5rem)')]);
    expect(result.layout).toEqual([decl('gap', 'var(--spacer-2, 0.5rem)')]);
  });

  it('returns empty buckets for no declarations', () => {
    expect(partitionCss([])).toEqual({ layout: [], style: [] });
  });

  it('is deterministic across repeated calls', () => {
    const declarations = [
      decl('display', 'flex'),
      decl('background', '#fff'),
      decl('gap', '8px'),
    ];
    expect(partitionCss(declarations)).toEqual(partitionCss(declarations));
  });
});

describe('formatCssBlock', () => {
  it('renders one declaration per line, panel-style', () => {
    const text = formatCssBlock([
      decl('display', 'flex'),
      decl('gap', 'var(--spacer-3, 1rem)'),
    ]);
    expect(text).toBe('display: flex;\ngap: var(--spacer-3, 1rem);');
  });

  it('returns an empty string for an empty bucket so callers can omit the section', () => {
    expect(formatCssBlock([])).toBe('');
  });
});

describe('getNodeCss', () => {
  const baseNode = { id: '1:1', name: 'Card' };

  it('retrieves, partitions, and preserves emission order', async () => {
    const node: CssSourceNode = {
      ...baseNode,
      getCSSAsync: async () => ({
        display: 'flex',
        'flex-direction': 'column',
        gap: 'var(--spacer-3, 1rem)',
        'border-bottom': '1px solid var(--color-border)',
      }),
    };

    const result = await getNodeCss(node);

    expect(result.diagnostics).toEqual([]);
    expect(result.css.layout).toEqual([
      decl('display', 'flex'),
      decl('flex-direction', 'column'),
      decl('gap', 'var(--spacer-3, 1rem)'),
    ]);
    expect(result.css.style).toEqual([
      decl('border-bottom', '1px solid var(--color-border)'),
    ]);
  });

  it('degrades to a css-unavailable diagnostic when getCSSAsync is missing', async () => {
    const result = await getNodeCss({ ...baseNode });

    expect(result.css).toEqual({ layout: [], style: [] });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]).toMatchObject({
      severity: 'warning',
      reason: 'css-unavailable',
      nodeId: '1:1',
      layerPath: ['Card'],
    });
  });

  it('degrades to a css-unavailable diagnostic when getCSSAsync rejects', async () => {
    const node: CssSourceNode = {
      ...baseNode,
      getCSSAsync: async () => {
        throw new Error('internal');
      },
    };

    const result = await getNodeCss(node);

    expect(result.css).toEqual({ layout: [], style: [] });
    expect(result.diagnostics[0]?.reason).toBe('css-unavailable');
    expect(result.diagnostics[0]?.message).toContain('Card');
  });

  it('handles an empty CSS result without diagnostics', async () => {
    const node: CssSourceNode = { ...baseNode, getCSSAsync: async () => ({}) };
    const result = await getNodeCss(node);
    expect(result.css).toEqual({ layout: [], style: [] });
    expect(result.diagnostics).toEqual([]);
  });
});

describe('usage snippets', () => {
  function entry(
    nodeId: string,
    layerPath: string[],
    componentName: string,
    modulePath: string,
    jsx: string,
  ): ConnectedComponentEntry {
    return {
      nodeId,
      layerPath,
      componentName,
      usage: {
        imports: [{ importedName: componentName, localName: componentName, modulePath }],
        jsx,
        diagnostics: [],
      },
    };
  }

  it('formatUsageSnippet matches the single-component snippet shape', () => {
    const snippet = formatUsageSnippet(
      entry('1', ['Form', 'Button'], 'Button', '@tashilcar/ui', '<Button variant={"primary"} />').usage,
    );
    expect(snippet).toBe([
      'import { Button } from "@tashilcar/ui";',
      '',
      '<Button variant={"primary"} />',
    ].join('\n'));
  });

  it('deduplicates imports and labels each usage with a root-relative source comment', () => {
    const snippet = formatConnectedComponentsSnippet([
      entry('1', ['Bar', 'Row', 'Cancel'], 'Button', '@tashilcar/ui', '<Button />'),
      entry('2', ['Bar', 'Submit'], 'Button', '@tashilcar/ui', '<Button variant={"primary"} />'),
    ]);
    // The inspected root ("Bar") is dropped from the comment path.
    expect(snippet).toBe([
      'import { Button } from "@tashilcar/ui";',
      '',
      '//./ Row / Cancel',
      '<Button />',
      '',
      '//./ Submit',
      '<Button variant={"primary"} />',
    ].join('\n'));
  });

  it('omits source comments when pathComments is false', () => {
    const snippet = formatConnectedComponentsSnippet(
      [
        entry('1', ['Bar', 'Cancel'], 'Button', '@tashilcar/ui', '<Button />'),
        entry('2', ['Bar', 'Submit'], 'Button', '@tashilcar/ui', '<Button variant={"primary"} />'),
      ],
      { pathComments: false },
    );
    expect(snippet).toBe([
      'import { Button } from "@tashilcar/ui";',
      '',
      '<Button />',
      '',
      '<Button variant={"primary"} />',
    ].join('\n'));
  });

  it('falls back to per-entry snippets when the same name comes from two modules', () => {
    const snippet = formatConnectedComponentsSnippet([
      entry('1', ['Mixed', 'A'], 'Card', '@tashilcar/ui', '<Card />'),
      entry('2', ['Mixed', 'B'], 'Card', '@tashilcar/forms', '<Card />'),
    ]);
    // Each section carries its own valid imports; no aliased import is emitted
    // for JSX that still uses the bare name.
    expect(snippet).toBe([
      '//./ A',
      'import { Card } from "@tashilcar/ui";',
      '',
      '<Card />',
      '',
      '//./ B',
      'import { Card } from "@tashilcar/forms";',
      '',
      '<Card />',
    ].join('\n'));
  });
});
