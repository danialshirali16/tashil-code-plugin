import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateTierLabels } from './figma-canvas-updater';

describe('updateTierLabels', () => {
  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'figma');
  });

  it('repairs existing tier layer names and text with the exact Figma casing', async () => {
    const loadFontAsync = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      figma: {
        loadFontAsync,
        mixed: Symbol('mixed'),
      },
    });

    const textNode = {
      characters: 'visualstyle: solidfill',
      fontName: { family: 'Inter', style: 'Medium' },
      name: 'Label',
      type: 'TEXT',
    };
    const labelNode = {
      children: [textNode],
      name: 'Label — visualstyle: solidfill',
      type: 'FRAME',
    };
    const tierNode = {
      children: [labelNode],
      counterAxisAlignItems: 'MIN',
      layoutMode: 'HORIZONTAL',
      name: 'Tier 0 — visualstyle',
      primaryAxisAlignItems: 'MIN',
      type: 'FRAME',
    };

    await updateTierLabels(
      [tierNode as unknown as FrameNode],
      [{
        groups: [{
          colStart: 0,
          label: 'VisualStyle: SolidFill',
          propertyName: 'VisualStyle',
          span: 1,
          value: 'SolidFill',
        }],
        propertyName: 'VisualStyle',
      }],
    );

    expect(tierNode.name).toBe('Tier 0 — VisualStyle');
    expect(tierNode.primaryAxisAlignItems).toBe('MAX');
    expect(tierNode.counterAxisAlignItems).toBe('MIN');
    expect(labelNode.name).toBe('Label — VisualStyle: SolidFill');
    expect(textNode.characters).toBe('VisualStyle: SolidFill');
    expect(loadFontAsync).toHaveBeenCalledWith({ family: 'Inter', style: 'Medium' });
  });
});
