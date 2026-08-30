import { afterEach, describe, expect, it, vi } from 'vitest';
import { updateTierLabels, updateTokenDocFrameInPlace } from './figma-canvas-updater';
import type { TokenDocDocument } from './types';

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

  it('preserves existing custom frame width and does not resize during in-place update', async () => {
    const resizeFn = vi.fn();
    const loadFontAsync = vi.fn().mockResolvedValue(undefined);
    const setPluginData = vi.fn();

    Object.assign(globalThis, {
      figma: {
        loadFontAsync,
        mixed: Symbol('mixed'),
      },
    });

    const frame = {
      children: [],
      clipsContent: true,
      cornerRadius: 24,
      height: 1200,
      name: 'Colors',
      resize: resizeFn,
      setPluginData,
      width: 1750,
    } as unknown as FrameNode;

    const doc: TokenDocDocument = {
      collectionId: 'colors',
      collectionName: 'Colors',
      contentHash: 'hash-123',
      description: 'Colors palette',
      groupingDepth: '3',
      modes: [{ modeId: 'm1', name: 'Light' }],
      sections: [],
      title: 'Colors',
      totalTokens: 0,
    };

    const result = await updateTokenDocFrameInPlace(frame, doc);

    expect(result.ok).toBe(true);
    expect(resizeFn).not.toHaveBeenCalled();
    expect(setPluginData).toHaveBeenCalled();
  });
});
