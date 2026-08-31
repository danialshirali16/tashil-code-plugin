import { describe, expect, it } from 'vitest';
import { serializeTokenCollection } from './serialize-formats';
import type { ExportOptions, TokenCollection } from './types';

const collection: TokenCollection = {
  defaultModeId: 'light', id: 'core', modes: [{ modeId: 'light', name: 'Light' }], name: 'Core',
  tokens: [
    { id: 'color', name: 'Color/Primary', resolvedType: 'COLOR', scopes: [], value: { kind: 'color', value: { r: 1, g: 0, b: 0 } } },
    { id: 'space', name: 'Space/Small', resolvedType: 'FLOAT', scopes: ['GAP'], value: { kind: 'number', value: 8 } },
  ],
};
const base: ExportOptions = { colorFormat: 'hex', convertPxToRem: true, modesByCollection: {}, nameStyle: 'lower-hyphen', rootFontSize: 16 };

describe('extended token serializers', () => {
  it.each([
    ['markdown', 'md', '--color-primary: #ff0000;', '--space-small: 0.5rem;'],
    ['scss', 'scss', '$color-primary: #ff0000;', '$tokens: ('],
    ['tailwind-theme', 'ts', 'export default {', '"space-small": "0.5rem"'],
    ['json-flat', 'json', '"color-primary": "#ff0000"', '"space-small": "0.5rem"'],
    ['json-dtcg', 'json', '"$type": "color"', '"$value": "0.5rem"'],
    ['typescript-nested', 'ts', 'export const core: Core = {', 'primary: \'#ff0000\''],
  ] as const)('generates %s output', (outputFormat, extension, first, second) => {
    const result = serializeTokenCollection(collection, { ...base, outputFormat });
    expect(result.extension).toBe(extension);
    expect(result.content).toContain(first);
    expect(result.content).toContain(second);
    expect(result.content).toMatchSnapshot();
  });

  it('keeps omitted outputFormat byte-identical to CSS', () => {
    expect(serializeTokenCollection(collection, base).content).toMatchSnapshot();
  });

  it('serializes complex nested hierarchy and alias references in typescript-nested', () => {
    const themeCollection: TokenCollection = {
      defaultModeId: 'default',
      id: 'theme',
      modes: [{ modeId: 'default', name: 'Default' }],
      name: '2. Product Tokens',
      tokens: [
        {
          id: 't1',
          name: 'text/default',
          resolvedType: 'COLOR',
          scopes: [],
          value: { kind: 'alias', value: { targetName: 'raw-color/gray/900' } },
        },
        {
          id: 't2',
          name: 'text/accent/blue/bold',
          resolvedType: 'COLOR',
          scopes: [],
          value: { kind: 'alias', value: { targetName: 'shades/blue/800' } },
        },
        {
          id: 't3',
          name: 'alpha/white/8',
          resolvedType: 'COLOR',
          scopes: [],
          value: { kind: 'color', value: { r: 1, g: 1, b: 1, a: 0.08 } },
        },
        {
          id: 't4',
          name: 'shades/pink/25',
          resolvedType: 'COLOR',
          scopes: [],
          value: { kind: 'color', value: { r: 0.98, g: 0.93, b: 0.95 } },
        },
      ],
    };

    const resultVariable = serializeTokenCollection(themeCollection, {
      ...base,
      colorFormat: 'variable',
      outputFormat: 'typescript-nested',
    });

    expect(resultVariable.extension).toBe('ts');
    expect(resultVariable.content).toContain('import type { ProductTokens } from \'./types\';');
    expect(resultVariable.content).toContain('export const productTokens: ProductTokens = {');
    expect(resultVariable.content).toContain('default: rawColor.gray[900],');
    expect(resultVariable.content).toContain('bold: shades.blue[800],');
    expect(resultVariable.content).toContain('8: \'#ffffff14\',');
    expect(resultVariable.content).toContain('25: \'#faedf2\',');

    const resultHex = serializeTokenCollection({
      ...themeCollection,
      tokens: [
        {
          id: 't1',
          name: 'text/default',
          resolvedType: 'COLOR',
          scopes: [],
          value: {
            kind: 'alias',
            value: {
              resolvedValue: { kind: 'color', value: { r: 0.06, g: 0.09, b: 0.16 } },
              targetName: 'raw-color/gray/900',
            },
          },
        },
      ],
    }, {
      ...base,
      colorFormat: 'hex',
      outputFormat: 'typescript-nested',
    });
    expect(resultHex.content).toContain('default: \'#0f1729\',');

    const resultRgba = serializeTokenCollection(themeCollection, {
      ...base,
      colorFormat: 'rgba',
      outputFormat: 'typescript-nested',
    });
    expect(resultRgba.content).toContain('8: \'rgba(255, 255, 255, 0.08)\',');
    expect(resultRgba.content).toContain('25: \'rgba(250, 237, 242, 1)\',');

    const resultRgb = serializeTokenCollection(themeCollection, {
      ...base,
      colorFormat: 'rgb',
      outputFormat: 'typescript-nested',
    });
    expect(resultRgb.content).toContain('8: \'rgb(255, 255, 255)\',');
    expect(resultRgb.content).toContain('25: \'rgb(250, 237, 242)\',');
  });

  it.each([
    ['lower-dot', '--color.primary: #ff0000;'],
    ['title-dot', '--Color.Primary: #ff0000;'],
  ] as const)('preserves raw %s paths in Markdown', (nameStyle, declaration) => {
    const result = serializeTokenCollection(collection, {
      ...base,
      nameStyle,
      outputFormat: 'markdown',
    });
    expect(result.content).toContain(declaration);
    expect(result.content).not.toContain('\\.');
  });
});
