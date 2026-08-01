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
const base: ExportOptions = { colorFormat: 'hex', convertPxToRem: true, modesByCollection: {}, nameStyle: 'kebab', rootFontSize: 16 };

describe('extended token serializers', () => {
  it.each([
    ['scss', 'scss', '$color-primary: #ff0000;', '$tokens: ('],
    ['tailwind-theme', 'ts', 'export default {', '"space-small": "0.5rem"'],
    ['json-flat', 'json', '"color-primary": "#ff0000"', '"space-small": "0.5rem"'],
    ['json-dtcg', 'json', '"$type": "color"', '"$value": "0.5rem"'],
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
});
