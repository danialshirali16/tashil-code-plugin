import { describe, expect, it } from 'vitest';
import { evaluateConnectionHealth } from './connection-health';
import type { MappingDocument } from './types';

function createDocument(): MappingDocument {
  return {
    figmaSnapshot: {
      componentId: 'button',
      componentName: 'Button',
      properties: [{ id: 'style', name: 'Style', options: ['Solid', 'Ghost'], rawKey: 'Style#style', type: 'VARIANT' }],
    },
    mappings: [{
      figmaPropertyId: 'style',
      figmaPropertyName: 'Style',
      sourceProp: 'variant',
      values: [
        { figmaValue: 'Solid', sourceValue: 'solid' },
        { figmaValue: 'Ghost', sourceValue: 'ghost' },
      ],
    }],
    revision: 1,
    sourceSnapshot: {
      componentName: 'Button',
      contentHash: 'old',
      fileName: 'types.ts',
      props: [{ name: 'variant', required: false, role: 'standard', typeName: 'Variant', values: ['solid', 'ghost'] }],
    },
  };
}

describe('connection health', () => {
  it('requires a source refresh when saved schemas otherwise match', () => {
    const document = createDocument();
    expect(evaluateConnectionHealth(document, document.figmaSnapshot, document, false))
      .toEqual({ changes: [], status: 'source-refresh-required' });
  });

  it('classifies mapped Figma removals and source removals as broken', () => {
    const saved = createDocument();
    const working = {
      ...saved,
      sourceSnapshot: { ...saved.sourceSnapshot!, contentHash: 'new', props: [] },
    };
    const health = evaluateConnectionHealth(saved, {
      ...saved.figmaSnapshot,
      properties: [],
    }, working, true);

    expect(health?.status).toBe('broken');
    expect(health?.changes.map((change) => change.kind)).toEqual(expect.arrayContaining([
      'figma-property-removed',
      'source-prop-removed',
      'mapping-conflict',
    ]));
  });

  it('classifies additions, renames, and incomplete values for review', () => {
    const saved = createDocument();
    const currentFigma = {
      ...saved.figmaSnapshot,
      properties: [{
        ...saved.figmaSnapshot.properties[0],
        name: 'Appearance',
        options: ['Solid', 'Ghost', 'Outline'],
      }],
    };
    const working = {
      ...saved,
      mappings: [{ ...saved.mappings[0], values: [saved.mappings[0].values[0]] }],
    };
    const health = evaluateConnectionHealth(saved, currentFigma, working, true);

    expect(health?.status).toBe('needs-review');
    expect(health?.changes.map((change) => change.kind)).toEqual(expect.arrayContaining([
      'figma-property-renamed',
      'figma-option-added',
      'incomplete-mapping',
    ]));
  });

  it('allows an explicitly removed stale mapping to move from broken to review', () => {
    const saved = createDocument();
    const working = { ...saved, mappings: [] };
    const health = evaluateConnectionHealth(saved, {
      ...saved.figmaSnapshot,
      properties: [],
    }, working, true);

    expect(health?.status).toBe('needs-review');
    expect(health?.changes).toContainEqual(expect.objectContaining({
      kind: 'figma-property-removed',
      severity: 'review',
    }));
  });
});
