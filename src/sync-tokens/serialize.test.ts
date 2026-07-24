import { describe, expect, it } from 'vitest';
import {
  formatColor,
  formatNumber,
  formatTokenName,
  formatTokenValue,
  serializeCollection,
} from './serialize';
import {
  type ExportOptions,
  type Token,
  type TokenCollection,
} from './types';

const baseOptions: ExportOptions = {
  modeByCollection: { c1: 'm1' },
  convertPxToRem: false,
  rootFontSize: 16,
  colorFormat: 'hex',
  nameStyle: 'kebab',
};

function token(partial: Partial<Token> & Pick<Token, 'name' | 'value'>): Token {
  return {
    id: partial.id ?? 'v1',
    name: partial.name,
    resolvedType: partial.resolvedType ?? 'FLOAT',
    scopes: partial.scopes ?? [],
    value: partial.value,
  };
}

describe('formatTokenName', () => {
  it('kebab: collapses slash groups to hyphens and lowercases', () => {
    expect(formatTokenName('Color/Text/Primary/Default', 'kebab')).toBe('color-text-primary-default');
  });

  it('slash: preserves slash nesting as scoped CSS', () => {
    expect(formatTokenName('Color/Text/Primary', 'slash')).toBe('color/text/primary');
  });

  it('snake: underscores between segments', () => {
    expect(formatTokenName('Color/Text/Primary', 'snake')).toBe('color_text_primary');
  });

  it('pascal: concatenates capitalized segments', () => {
    expect(formatTokenName('Color/Text/Primary', 'pascal')).toBe('ColorTextPrimary');
  });

  it('handles camelCase and spaces within a segment', () => {
    expect(formatTokenName('spacing/ sm_md ', 'kebab')).toBe('spacing-sm-md');
  });

  it('falls back to a placeholder for an empty name', () => {
    expect(formatTokenName('   ', 'kebab')).toBe('unnamed');
  });
});

describe('formatColor', () => {
  const red = { r: 1, g: 0, b: 0 };

  it('hex: formats opaque colors as six digits', () => {
    expect(formatColor(red, 'hex')).toBe('#ff0000');
  });

  it('hex: appends alpha when below 1', () => {
    expect(formatColor({ ...red, a: 0.5 }, 'hex')).toBe('#ff000080');
  });

  it('rgb: drops alpha intentionally', () => {
    expect(formatColor({ ...red, a: 0.5 }, 'rgb')).toBe('rgb(255, 0, 0)');
  });

  it('rgba: keeps alpha, trimmed', () => {
    expect(formatColor({ ...red, a: 0.5 }, 'rgba')).toBe('rgba(255, 0, 0, 0.5)');
  });

  it('variable: emits a var() pointing at the alias target', () => {
    expect(formatColor(red, 'variable', { targetName: 'Color/Brand/Primary' })).toBe('var(--color-brand-primary)');
  });

  it('variable without an alias falls back to rgb so export never breaks', () => {
    expect(formatColor(red, 'variable')).toBe('rgb(255, 0, 0)');
  });
});

describe('formatNumber', () => {
  it('does not convert when convertPxToRem is off', () => {
    const t = token({ name: 'size/4', value: { kind: 'number', value: 16 }, scopes: ['WIDTH_HEIGHT'] });
    expect(formatNumber(16, t, baseOptions)).toBe('16');
  });

  it('converts length-scoped FLOAT values to rem', () => {
    const t = token({ name: 'size/4', value: { kind: 'number', value: 16 }, scopes: ['WIDTH_HEIGHT'] });
    expect(formatNumber(16, t, { ...baseOptions, convertPxToRem: true })).toBe('1rem');
  });

  it('leaves unitless FLOAT values (opacity) untouched even with rem on', () => {
    const t = token({ name: 'opacity/50', value: { kind: 'number', value: 0.5 }, scopes: ['OPACITY'] });
    expect(formatNumber(0.5, t, { ...baseOptions, convertPxToRem: true })).toBe('0.5');
  });

  it('honors a custom root font size', () => {
    const t = token({ name: 'size/4', value: { kind: 'number', value: 32 }, scopes: ['GAP'] });
    expect(formatNumber(32, t, { ...baseOptions, convertPxToRem: true, rootFontSize: 10 })).toBe('3.2rem');
  });

  it('guards against a zero root size', () => {
    const t = token({ name: 'size/4', value: { kind: 'number', value: 16 }, scopes: ['GAP'] });
    expect(formatNumber(16, t, { ...baseOptions, convertPxToRem: true, rootFontSize: 0 })).toBe('1rem');
  });
});

describe('formatTokenValue', () => {
  it('serializes a string token as a bare ident when safe', () => {
    const t = token({ name: 'font/sans', resolvedType: 'STRING', value: { kind: 'string', value: 'Inter' } });
    expect(formatTokenValue(t, baseOptions)).toBe('Inter');
  });

  it('quotes a string with spaces', () => {
    const t = token({ name: 'font/sans', resolvedType: 'STRING', value: { kind: 'string', value: 'Inter Bold' } });
    expect(formatTokenValue(t, baseOptions)).toBe('"Inter Bold"');
  });

  it('serializes a boolean token', () => {
    const t = token({ name: 'flag', resolvedType: 'BOOLEAN', value: { kind: 'boolean', value: true } });
    expect(formatTokenValue(t, baseOptions)).toBe('true');
  });
});

describe('serializeCollection', () => {
  it('emits a :root block with a header comment and one declaration per token', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Brand/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.2, g: 0.3, b: 0.8 } } }),
        token({ name: 'Spacing/4', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 16 } }),
      ],
    };
    const css = serializeCollection(collection, baseOptions);
    expect(css).toContain('/* Primitive — exported from Figma variables */');
    expect(css).toContain(':root {');
    expect(css).toContain('--color-brand-primary: #334dcc;');
    expect(css).toContain('--spacing-4: 16;');
  });

  it('skips aliases that resolve to nothing usable', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Radius/Sm', resolvedType: 'FLOAT', value: { kind: 'alias', value: { targetName: 'Other/Radius' } } }),
      ],
    };
    // Non-color alias with no concrete value → no declaration line.
    expect(serializeCollection(collection, baseOptions)).not.toContain('--radius-sm:');
  });
});
