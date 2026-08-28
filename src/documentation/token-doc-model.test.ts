import { describe, expect, it } from 'vitest';
import * as tokenDocModel from './token-doc-model';
import { buildTokenDocDocument, computeCollectionHash, type RawCollectionData } from './token-doc-model';

describe('buildTokenDocDocument', () => {
  const sampleCollection: RawCollectionData = {
    collectionId: 'col-1',
    collectionName: 'Colors',
    modes: [
      { modeId: 'm1', name: 'Light' },
      { modeId: 'm2', name: 'Dark' },
    ],
    tokens: [
      {
        id: 'tok-1',
        name: 'color/text/default',
        valuesByMode: {
          m1: { isColor: true, value: { r: 0.06, g: 0.1, b: 0.16 } },
          m2: { isColor: true, value: { r: 1, g: 1, b: 1 } },
        },
      },
      {
        id: 'tok-2',
        name: 'color/bg/default',
        valuesByMode: {
          m1: { aliasTargetName: 'color/primary/500', isColor: true, value: { r: 0.14, g: 0.39, b: 0.92 } },
          m2: { aliasTargetName: 'color/primary/400', isColor: true, value: { r: 0.2, g: 0.5, b: 1 } },
        },
      },
      {
        id: 'tok-3',
        name: 'color/border/subtle',
        valuesByMode: {
          m1: { isColor: true, value: { r: 0.9, g: 0.91, b: 0.92 } },
          m2: { isColor: true, value: { r: 0.2, g: 0.22, b: 0.25 } },
        },
      },
    ],
  };

  it('summarizes generated groups from token names without resolving token values', () => {
    const summarize = (tokenDocModel as unknown as {
      summarizeTokenDocGroups?: (
        tokenNames: readonly string[],
        collectionName: string,
      ) => { groupCount: number; groupNames: string[] };
    }).summarizeTokenDocGroups;

    expect(summarize).toBeTypeOf('function');
    if (!summarize) return;

    expect(summarize([
      'color/text/default',
      'color/bg/default',
      'color/bg/hover',
      'Radius/Card',
    ], 'Colors')).toEqual({
      groupCount: 3,
      groupNames: ['Text', 'Bg', 'Radius'],
    });
  });

  it('groups tokens into logical semantic sections', () => {
    const doc = buildTokenDocDocument(sampleCollection);

    expect(doc.title).toBe('Colors');
    expect(doc.totalTokens).toBe(3);
    expect(doc.modes).toHaveLength(2);
    expect(doc.sections.length).toBeGreaterThanOrEqual(3);

    const sectionIds = doc.sections.map((s) => s.id);
    expect(sectionIds).toEqual(['text', 'bg', 'border']);
  });

  it('preserves exact section and row order from input collection', () => {
    const customCollection: RawCollectionData = {
      collectionId: 'col-order',
      collectionName: 'OrderTest',
      modes: [{ modeId: 'm1', name: 'Default' }],
      tokens: [
        { id: 't1', name: 'Spacing/Large', valuesByMode: { m1: { value: 24 } } },
        { id: 't2', name: 'Spacing/Small', valuesByMode: { m1: { value: 8 } } },
        { id: 't3', name: 'Spacing/Medium', valuesByMode: { m1: { value: 16 } } },
        { id: 't4', name: 'Radius/Pill', valuesByMode: { m1: { value: 999 } } },
        { id: 't5', name: 'Radius/Card', valuesByMode: { m1: { value: 12 } } },
      ],
    };

    const doc = buildTokenDocDocument(customCollection);
    expect(doc.sections.map((s) => s.id)).toEqual(['spacing', 'radius']);

    const spacingSection = doc.sections.find((s) => s.id === 'spacing');
    expect(spacingSection!.tokens.map((t) => t.name)).toEqual([
      'Spacing/Large',
      'Spacing/Small',
      'Spacing/Medium',
    ]);

    const radiusSection = doc.sections.find((s) => s.id === 'radius');
    expect(radiusSection!.tokens.map((t) => t.name)).toEqual([
      'Radius/Pill',
      'Radius/Card',
    ]);
  });

  it('computes deterministic content hash', () => {
    const hash1 = computeCollectionHash(sampleCollection);
    const hash2 = computeCollectionHash(sampleCollection);
    expect(hash1).toBe(hash2);
    expect(typeof hash1).toBe('string');
    expect(hash1.length).toBeGreaterThan(0);
  });

  it('resolves color hex values and aliases per mode', () => {
    const doc = buildTokenDocDocument(sampleCollection);
    const bgSection = doc.sections.find((s) => s.id === 'bg');
    expect(bgSection).toBeDefined();

    const bgToken = bgSection!.tokens.find((t) => t.name === 'color/bg/default');
    expect(bgToken).toBeDefined();
    expect(bgToken!.valuesByMode.m1.aliasTargetName).toBe('color/primary/500');
    expect(bgToken!.valuesByMode.m1.resolvedType).toBe('COLOR');
    expect(bgToken!.valuesByMode.m1.hexColor).toBe('#2463eb');
  });

  it('generates dynamic headlines and descriptions for arbitrary groups and token types', () => {
    const arbitraryCollection: RawCollectionData = {
      collectionId: 'col-dyn',
      collectionName: 'CustomDesignTokens',
      modes: [{ modeId: 'm1', name: 'Default' }],
      tokens: [
        { id: 't1', name: 'custom-surface/container_fill', valuesByMode: { m1: { isColor: true, value: { r: 0.1, g: 0.1, b: 0.1 } } } },
        { id: 't2', name: 'Button/Primary/height', valuesByMode: { m1: { isFloat: true, value: 40 } } },
        { id: 't3', name: 'Alert/Toast/background', valuesByMode: { m1: { isColor: true, value: { r: 0.9, g: 0.2, b: 0.2 } } } },
        { id: 't4', name: 'CustomComponent/isActive', valuesByMode: { m1: { value: true } } },
      ],
    };

    const doc = buildTokenDocDocument(arbitraryCollection);

    const surfaceSec = doc.sections.find((s) => s.id === 'custom-surface');
    expect(surfaceSec).toBeDefined();
    expect(surfaceSec!.headline).toBe('Custom Surface');
    expect(surfaceSec!.description).toContain('background surfaces');

    const buttonSec = doc.sections.find((s) => s.id === 'button-primary');
    expect(buttonSec).toBeDefined();
    expect(buttonSec!.headline).toBe('Button / Primary');
    expect(buttonSec!.description).toContain('Button / Primary components');

    const alertSec = doc.sections.find((s) => s.id === 'alert-toast');
    expect(alertSec).toBeDefined();
    expect(alertSec!.headline).toBe('Alert / Toast');
    expect(alertSec!.description).toContain('Status and messaging tokens');

    const customSec = doc.sections.find((s) => s.id === 'customcomponent');
    expect(customSec).toBeDefined();
    expect(customSec!.headline).toBe('CustomComponent');
    expect(customSec!.description).toContain('CustomComponent components');
  });
});
