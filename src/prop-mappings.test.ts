import { describe, expect, it } from 'vitest';
import { createReactPropIdentifier, mergePropMappingsJson } from './prop-mappings';
import type { PropMappings } from './types';

function parseMergedValue(currentValue: string, incoming: PropMappings): PropMappings {
  const result = mergePropMappingsJson(currentValue, incoming);
  expect(result.ok).toBe(true);
  return JSON.parse(result.value) as PropMappings;
}

describe('mergePropMappingsJson', () => {
  it('preserves a mapping entered manually after the UI mounted', () => {
    const currentValue = JSON.stringify({
      state: {
        loading: { prop: 'loading', value: true },
      },
    });

    expect(parseMergedValue(currentValue, {
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
    })).toEqual({
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
      state: {
        loading: { prop: 'loading', value: true },
      },
    });
  });

  it('preserves loaded mappings while adding new options to their group', () => {
    const currentValue = JSON.stringify({
      intent: {
        primary: { prop: 'tone', value: 'brand' },
      },
    });

    expect(parseMergedValue(currentValue, {
      intent: {
        secondary: { prop: 'intent', value: 'secondary' },
      },
    })).toEqual({
      intent: {
        secondary: { prop: 'intent', value: 'secondary' },
        primary: { prop: 'tone', value: 'brand' },
      },
    });
  });

  it('keeps the existing value when a scaffolded option has the same key', () => {
    const currentValue = JSON.stringify({
      intent: {
        primary: { prop: 'tone', value: 'brand' },
      },
    });

    expect(parseMergedValue(currentValue, {
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
    })).toEqual({
      intent: {
        primary: { prop: 'tone', value: 'brand' },
      },
    });
  });

  it('preserves magic group and option keys while keeping existing entries', () => {
    const currentValue = [
      '{',
      '  "__proto__": {',
      '    "__proto__": { "prop": "tone", "value": "existing-proto" },',
      '    "constructor": { "prop": "tone", "value": "existing-constructor" }',
      '  },',
      '  "toString": {',
      '    "constructor": { "prop": "label", "value": "existing-group" }',
      '  }',
      '}',
    ].join('\n');
    const incoming = JSON.parse([
      '{',
      '  "__proto__": {',
      '    "__proto__": { "prop": "tone", "value": "scaffolded-proto" },',
      '    "toString": { "prop": "tone", "value": "scaffolded-to-string" }',
      '  },',
      '  "constructor": {',
      '    "__proto__": { "prop": "kind", "value": "scaffolded-group" }',
      '  }',
      '}',
    ].join('\n')) as PropMappings;

    const merged = parseMergedValue(currentValue, incoming);

    expect(Object.keys(merged)).toEqual(['__proto__', 'constructor', 'toString']);
    expect(Object.prototype.hasOwnProperty.call(merged, '__proto__')).toBe(true);
    expect(merged).toEqual(JSON.parse([
      '{',
      '  "__proto__": {',
      '    "__proto__": { "prop": "tone", "value": "existing-proto" },',
      '    "toString": { "prop": "tone", "value": "scaffolded-to-string" },',
      '    "constructor": { "prop": "tone", "value": "existing-constructor" }',
      '  },',
      '  "constructor": {',
      '    "__proto__": { "prop": "kind", "value": "scaffolded-group" }',
      '  },',
      '  "toString": {',
      '    "constructor": { "prop": "label", "value": "existing-group" }',
      '  }',
      '}',
    ].join('\n')) as unknown);
  });

  it('preserves malformed JSON and reports an actionable error', () => {
    const currentValue = '{ "intent": }';
    const result = mergePropMappingsJson(currentValue, {
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
    });

    expect(result).toEqual({
      message: 'Fix the existing prop mappings JSON before scaffolding.',
      ok: false,
      value: currentValue,
    });
  });

  it.each(['null', '[]'])('preserves non-object JSON (%s) and reports the same error', (currentValue) => {
    const result = mergePropMappingsJson(currentValue, {
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
    });

    expect(result).toEqual({
      message: 'Fix the existing prop mappings JSON before scaffolding.',
      ok: false,
      value: currentValue,
    });
  });

  it('rejects invalid nested entries in the existing JSON', () => {
    const currentValue = JSON.stringify({
      intent: {
        primary: { prop: 'intent' },
      },
    });
    const result = mergePropMappingsJson(currentValue, {
      size: {
        small: { prop: 'size', value: 'sm' },
      },
    });

    expect(result).toEqual({
      message: 'Fix the existing prop mappings JSON before scaffolding.',
      ok: false,
      value: currentValue,
    });
  });

  it('rejects invalid nested entries in incoming scaffold data', () => {
    const currentValue = JSON.stringify({
      intent: {
        primary: { prop: 'intent', value: 'primary' },
      },
    });
    const incoming = {
      size: {
        small: { prop: 'size' },
      },
    } as unknown as PropMappings;
    const result = mergePropMappingsJson(currentValue, incoming);

    expect(result).toEqual({
      message: 'Generated prop mappings are invalid. Rename the Figma variant properties or enter mappings manually.',
      ok: false,
      value: currentValue,
    });
  });
});

describe('createReactPropIdentifier', () => {
  it.each([
    ['Icon Position', 'iconPosition'],
    ['Icon / Position', 'iconPosition'],
    ['visual-style', 'visualStyle'],
    ['URL Mode', 'urlMode'],
    ['2XL Size', '_2XlSize'],
  ])('normalizes %s to %s', (figmaProperty, reactProp) => {
    expect(createReactPropIdentifier(figmaProperty)).toBe(reactProp);
  });

  it('returns null when punctuation contains no usable identifier characters', () => {
    expect(createReactPropIdentifier('***')).toBeNull();
  });
});
