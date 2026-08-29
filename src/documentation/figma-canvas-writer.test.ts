import { describe, expect, it, vi } from 'vitest';
import {
  alignTierTopRight,
  applyTokenDocFullWidthLayout,
  formatComponentDocFrameName,
  formatTokenDocFrameName,
  getTokenDocFrameWidth,
  setTokenSectionTitleVisibility,
} from './figma-canvas-writer';

describe('documentation frame names', () => {
  it('uses the collection name without a numeric prefix for token documents', () => {
    expect(formatTokenDocFrameName('References Color')).toBe('References Color');
  });

  it('uses the component guideline convention for component documents', () => {
    expect(formatComponentDocFrameName('Button')).toBe('Button Guideline');
  });
});

describe('setTokenSectionTitleVisibility', () => {
  it('sets the Section component Title boolean and its fallback layer visibility', () => {
    const setProperties = vi.fn();
    const titleLayer = { name: 'Title', type: 'FRAME', visible: true };
    const instance = {
      children: [titleLayer],
      componentProperties: {
        'Title#1422:18185': { type: 'BOOLEAN', value: true },
      },
      name: '.[Documentation] Section',
      setProperties,
      type: 'INSTANCE',
    };

    setTokenSectionTitleVisibility(instance as unknown as InstanceNode, false);

    expect(setProperties).toHaveBeenCalledWith({ 'Title#1422:18185': false });
    expect(titleLayer.visible).toBe(false);
  });

  it('can restore the Title for a section reused during an in-place update', () => {
    const titleLayer = { name: 'Title', type: 'FRAME', visible: false };
    const section = {
      children: [titleLayer],
      name: '.[Documentation] Section',
      type: 'FRAME',
    };

    setTokenSectionTitleVisibility(section as unknown as FrameNode, true);

    expect(titleLayer.visible).toBe(true);
  });
});

describe('getTokenDocFrameWidth', () => {
  it.each([
    [0, 1100],
    [1, 1100],
    [2, 1500],
    [3, 1900],
    [4, 2300],
    [5, 3000],
    [8, 3000],
  ])('maps %i modes to a %ipx document frame', (modeCount, expectedWidth) => {
    expect(getTokenDocFrameWidth(modeCount)).toBe(expectedWidth);
  });
});

describe('applyTokenDocFullWidthLayout', () => {
  it('sets the document structure, table columns, and rows to fill their containers', () => {
    const tokenRow = { name: 'Token Item', type: 'FRAME' };
    const valueRow = { name: 'Value Item', type: 'FRAME' };
    const tokenColumn = { children: [tokenRow], name: 'Token', type: 'FRAME' };
    const valueColumn = { children: [valueRow], name: 'Value', type: 'FRAME' };
    const table = {
      children: [tokenColumn, valueColumn],
      name: 'Table',
      primaryAxisSizingMode: 'AUTO',
      type: 'FRAME',
    };
    const title = { name: 'Title', type: 'FRAME' };
    const slot = { children: [table], name: 'Slot', type: 'FRAME' };
    const section = {
      children: [title, slot],
      name: '.[Documentation] Section',
      type: 'FRAME',
    };
    const header = { name: '.[Documentation] Header & Footer', type: 'FRAME' };
    const root = { children: [header, section], name: '1. Colors', type: 'FRAME' };

    applyTokenDocFullWidthLayout(root as unknown as FrameNode);

    expect(header).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(section).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(title).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(slot).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(table).toMatchObject({
      layoutSizingHorizontal: 'FILL',
      primaryAxisSizingMode: 'FIXED',
    });
    expect(tokenColumn).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(valueColumn).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(tokenRow).toMatchObject({ layoutSizingHorizontal: 'FILL' });
    expect(valueRow).toMatchObject({ layoutSizingHorizontal: 'FILL' });
  });
});

describe('alignTierTopRight', () => {
  it.each([
    ['HORIZONTAL', 'MAX', 'MIN'],
    ['VERTICAL', 'MIN', 'MAX'],
  ] as const)(
    'maps %s auto layout to Top-Right alignment',
    (layoutMode, expectedPrimary, expectedCounter) => {
      const tier = {
        counterAxisAlignItems: 'MIN',
        layoutMode,
        primaryAxisAlignItems: 'MIN',
      } as unknown as Parameters<typeof alignTierTopRight>[0];

      alignTierTopRight(tier);

      expect(tier.primaryAxisAlignItems).toBe(expectedPrimary);
      expect(tier.counterAxisAlignItems).toBe(expectedCounter);
    },
  );
});
