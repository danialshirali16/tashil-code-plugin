import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOKEN_EXPORT_PREFERENCES,
  readTokenExportPreferences,
  type TokenExportPreferences,
} from './preferences';

describe('token export preferences', () => {
  it('returns default preferences when given non-object or null/undefined', () => {
    expect(readTokenExportPreferences(undefined)).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
    expect(readTokenExportPreferences(null)).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
    expect(readTokenExportPreferences('invalid')).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
    expect(readTokenExportPreferences(123)).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
    expect(readTokenExportPreferences([])).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
  });

  it('preserves valid custom preferences', () => {
    const custom: TokenExportPreferences = {
      colorFormat: 'rgba',
      convertPxToRem: false,
      nameStyle: 'title-underscore',
      outputFormat: 'json-dtcg',
      rootFontSize: 14,
    };
    expect(readTokenExportPreferences(custom)).toEqual(custom);
  });

  it('falls back to defaults for invalid or missing individual properties', () => {
    const malformed = {
      colorFormat: 'unsupported-color',
      convertPxToRem: 'yes', // non-boolean
      nameStyle: 'snake_case_invalid',
      outputFormat: 'yaml', // unsupported format
      rootFontSize: -4, // invalid size
    };
    expect(readTokenExportPreferences(malformed)).toEqual(DEFAULT_TOKEN_EXPORT_PREFERENCES);
  });

  it('handles partial objects gracefully', () => {
    const partial = {
      outputFormat: 'scss',
      rootFontSize: 10,
    };
    expect(readTokenExportPreferences(partial)).toEqual({
      ...DEFAULT_TOKEN_EXPORT_PREFERENCES,
      outputFormat: 'scss',
      rootFontSize: 10,
    });
  });
});
