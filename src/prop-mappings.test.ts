import { describe, expect, it } from 'vitest';
import { mergePropMappingsJson } from './prop-mappings';
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
});
