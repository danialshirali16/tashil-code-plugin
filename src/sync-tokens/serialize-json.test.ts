import { describe, expect, it } from 'vitest';
import { serializeCollectionDtcg, serializeCollectionFlat } from './serialize-json';
import {
  type ExportOptions,
  type Token,
  type TokenCollection,
  type TokenExportWarning,
} from './types';

const baseOptions: ExportOptions = {
  modesByCollection: { c1: ['m1'] },
  convertPxToRem: false,
  rootFontSize: 16,
  colorFormat: 'hex',
  nameStyle: 'kebab',
  outputFormat: 'json-flat',
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

describe('serializeCollectionFlat', () => {
  it('emits a flat object whose keys mirror the CSS names', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Brand/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } } }),
        token({ name: 'Spacing/4', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 16 } }),
      ],
    };
    const json = JSON.parse(serializeCollectionFlat(collection, baseOptions));
    expect(json['color-brand-primary']).toBe('#0d99ff');
    expect(json['spacing-4']).toBe(16);
  });

  it('serializes colors as hex regardless of the colorFormat option', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Brand/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 1, g: 0, b: 0, a: 0.5 } } }),
      ],
    };
    const json = JSON.parse(serializeCollectionFlat(collection, { ...baseOptions, colorFormat: 'rgb' }));
    // colorFormat is CSS-only; JSON always hex.
    expect(json['color-brand-primary']).toBe('#ff000080');
  });

  it('converts length-scoped numbers to rem when convertPxToRem is on', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Spacing/4', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 32 } }),
      ],
    };
    const json = JSON.parse(serializeCollectionFlat(collection, { ...baseOptions, convertPxToRem: true }));
    expect(json['spacing-4']).toBe('2rem');
  });

  it('resolves an alias to a {reference} string', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({
          name: 'Color/Primary',
          resolvedType: 'COLOR',
          value: {
            kind: 'alias',
            value: {
              targetName: 'Reference/Blue/500',
              resolvedValue: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } },
            },
          },
        }),
      ],
    };
    const json = JSON.parse(serializeCollectionFlat(collection, baseOptions));
    expect(json['color-primary']).toBe('{reference-blue-500}');
  });

  it('dedupes colliding names and reports a warning', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.2, g: 0.3, b: 0.8 } } }),
        token({ name: 'Color.Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.9, g: 0.1, b: 0.1 } } }),
      ],
    };
    const warnings: TokenExportWarning[] = [];
    const json = JSON.parse(serializeCollectionFlat(collection, baseOptions, warnings));
    expect(Object.keys(json)).toEqual(['color-primary']);
    expect(json['color-primary']).toBe('#334dcc');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'duplicate-name' });
  });
});

describe('serializeCollectionDtcg', () => {
  it('nests by the Figma path and tags each leaf with $value/$type', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Brand/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } } }),
        token({ name: 'Spacing/4', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 16 } }),
      ],
    };
    const json = JSON.parse(serializeCollectionDtcg(collection, { ...baseOptions, outputFormat: 'json-dtcg' }));
    expect(json.color.brand.primary).toEqual({ $value: '#0d99ff', $type: 'color' });
    expect(json.spacing['4']).toEqual({ $value: 16, $type: 'dimension' });
  });

  it('infers number $type from scope: dimension for length, number otherwise', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Spacing/4', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 16 } }),
        token({ name: 'Opacity/50', resolvedType: 'FLOAT', scopes: ['OPACITY'], value: { kind: 'number', value: 0.5 } }),
      ],
    };
    const json = JSON.parse(serializeCollectionDtcg(collection, { ...baseOptions, outputFormat: 'json-dtcg' }));
    expect(json.spacing['4'].$type).toBe('dimension');
    expect(json.opacity['50'].$type).toBe('number');
  });

  it('tags aliases with a $type copied from the resolved value', () => {
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({
          name: 'Color/Primary',
          resolvedType: 'COLOR',
          value: {
            kind: 'alias',
            value: {
              targetName: 'Reference/Blue/500',
              resolvedValue: { kind: 'color', value: { r: 0.05, g: 0.6, b: 1 } },
            },
          },
        }),
      ],
    };
    const json = JSON.parse(serializeCollectionDtcg(collection, { ...baseOptions, outputFormat: 'json-dtcg' }));
    expect(json.color.primary).toEqual({ $value: '{reference-blue-500}', $type: 'color' });
  });

  it('dedupes colliding paths and reports a warning', () => {
    // In DTCG a collision requires identical segment arrays. `Color/Primary`
    // and `color/primary` both kebab to ['color','primary']; `Color.Primary`
    // would NOT collide (it nests as a single 'color-primary' key).
    const collection: TokenCollection = {
      id: 'c1',
      name: 'Primitive',
      modes: [{ modeId: 'm1', name: 'Mode 1' }],
      defaultModeId: 'm1',
      tokens: [
        token({ name: 'Color/Primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.2, g: 0.3, b: 0.8 } } }),
        token({ name: 'color/primary', resolvedType: 'COLOR', value: { kind: 'color', value: { r: 0.9, g: 0.1, b: 0.1 } } }),
      ],
    };
    const warnings: TokenExportWarning[] = [];
    const json = JSON.parse(serializeCollectionDtcg(collection, { ...baseOptions, outputFormat: 'json-dtcg' }, warnings));
    expect(json.color.primary).toEqual({ $value: '#334dcc', $type: 'color' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ code: 'duplicate-name' });
  });
});
