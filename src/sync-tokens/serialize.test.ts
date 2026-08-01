import { describe, expect, it } from 'vitest';
import {
  formatColor,
  formatCssTokenName,
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
  modesByCollection: { c1: ['m1'] },
  convertPxToRem: false,
  rootFontSize: 16,
  colorFormat: 'hex',
  nameStyle: 'lower-hyphen',
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
  it('default: returns the raw Figma name verbatim', () => {
    expect(formatTokenName('Color/Text/Primary', 'default')).toBe('Color/Text/Primary');
    expect(formatTokenName('Brand Primary', 'default')).toBe('Brand Primary');
  });

  it('lower-hyphen: collapses slash groups to hyphens and lowercases', () => {
    expect(formatTokenName('Color/Text/Primary/Default', 'lower-hyphen')).toBe('color-text-primary-default');
  });

  it('lower-slash: preserves slash nesting lowercased', () => {
    expect(formatTokenName('Color/Text/Primary', 'lower-slash')).toBe('color/text/primary');
  });

  it('lower-dot: separates normalized groups with periods', () => {
    expect(formatTokenName('Color/Primary/Hover', 'lower-dot')).toBe('color.primary.hover');
  });

  it('lower-underscore: underscores between segments', () => {
    expect(formatTokenName('Color/Text/Primary', 'lower-underscore')).toBe('color_text_primary');
  });

  it('title-hyphen: capitalized segments joined by hyphens', () => {
    expect(formatTokenName('Color/Text/Primary', 'title-hyphen')).toBe('Color-Text-Primary');
  });

  it('title-slash: capitalized segments joined by slashes', () => {
    expect(formatTokenName('Color/Text/Primary', 'title-slash')).toBe('Color/Text/Primary');
  });

  it('title-dot: preserves dotted nesting with capitalized segments', () => {
    expect(formatTokenName('Color/Text/Primary', 'title-dot')).toBe('Color.Text.Primary');
  });

  it('title-underscore: capitalized segments joined by underscores', () => {
    expect(formatTokenName('Color/Text/Primary', 'title-underscore')).toBe('Color_Text_Primary');
  });

  it('escapes slash and dot separators at the CSS identifier boundary', () => {
    expect(formatCssTokenName('Color/Text/Primary', 'lower-slash'))
      .toBe('color\\/text\\/primary');
    expect(formatCssTokenName('Color/Primary/Hover', 'lower-dot'))
      .toBe('color\\.primary\\.hover');
    expect(formatCssTokenName('Color/Primary/Hover', 'title-dot'))
      .toBe('Color\\.Primary\\.Hover');
  });

  it('handles camelCase and spaces within a segment', () => {
    expect(formatTokenName('spacing/ sm_md ', 'lower-hyphen')).toBe('spacing-sm-md');
  });

  it('falls back to a placeholder for an empty name', () => {
    expect(formatTokenName('   ', 'lower-hyphen')).toBe('unnamed');
    expect(formatTokenName('   ', 'default')).toBe('unnamed');
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

  it('uses the concrete value retained on a resolved color alias', () => {
    const t = token({
      name: 'Color/Primary',
      resolvedType: 'COLOR',
      value: {
        kind: 'alias',
        value: {
          targetName: 'Reference/Blue/500',
          resolvedValue: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } },
        },
      },
    });
    expect(formatTokenValue(t, baseOptions)).toBe('#0d99ff');
  });

  it('formats alias references with the selected token naming style', () => {
    const t = token({
      name: 'Color/Primary',
      resolvedType: 'COLOR',
      value: {
        kind: 'alias',
        value: {
          targetName: 'Reference/Blue/500',
          resolvedValue: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } },
        },
      },
    });
    expect(formatTokenValue(t, {
      ...baseOptions,
      colorFormat: 'variable',
      nameStyle: 'lower-dot',
    })).toBe('var(--reference\\.blue\\.500)');
  });

  it('applies px-to-rem conversion to resolved numeric aliases', () => {
    const t = token({
      name: 'Spacing/4',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      value: {
        kind: 'alias',
        value: {
          targetName: 'Reference/Spacing/16',
          resolvedValue: { kind: 'number', value: 16 },
        },
      },
    });
    expect(formatTokenValue(t, {
      ...baseOptions,
      convertPxToRem: true,
    })).toBe('1rem');
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

  it('preserves unresolved aliases as references instead of dropping them', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Radius/Sm', resolvedType: 'FLOAT', value: { kind: 'alias', value: { targetName: 'Other/Radius' } } }),
      ],
    };
    expect(serializeCollection(collection, baseOptions))
      .toContain('--radius-sm: var(--other-radius);');
  });

  it('escapes dot token names and matching var references in generated CSS', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Product',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({
          name: 'Color/Primary/Hover',
          resolvedType: 'COLOR',
          value: {
            kind: 'alias',
            value: { targetName: 'Reference/Blue/500' },
          },
        }),
      ],
    };
    expect(serializeCollection(collection, {
      ...baseOptions,
      colorFormat: 'variable',
      nameStyle: 'lower-dot',
    })).toContain(
      '--color\\.primary\\.hover: var(--reference\\.blue\\.500);',
    );
  });
});
