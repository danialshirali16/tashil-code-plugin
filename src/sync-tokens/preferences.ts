import type { ColorFormat, NameStyle, OutputFormat } from './types';

export type TokenExportPreferences = {
  colorFormat: ColorFormat;
  convertPxToRem: boolean;
  nameStyle: NameStyle;
  outputFormat: OutputFormat;
  rootFontSize: number;
};

export const DEFAULT_TOKEN_EXPORT_PREFERENCES: TokenExportPreferences = {
  colorFormat: 'hex',
  convertPxToRem: true,
  nameStyle: 'lower-hyphen',
  outputFormat: 'css',
  rootFontSize: 16,
};

const VALID_COLOR_FORMATS = new Set<ColorFormat>(['rgb', 'rgba', 'hex', 'variable']);

const VALID_NAME_STYLES = new Set<NameStyle>([
  'default',
  'lower-hyphen',
  'lower-underscore',
  'lower-slash',
  'lower-dot',
  'title-hyphen',
  'title-underscore',
  'title-slash',
  'title-dot',
]);

const VALID_OUTPUT_FORMATS = new Set<OutputFormat>([
  'css',
  'json-flat',
  'json-dtcg',
  'markdown',
  'scss',
  'tailwind-theme',
  'typescript-nested',
]);

export function readTokenExportPreferences(value: unknown): TokenExportPreferences {
  if (!isRecord(value)) {
    return { ...DEFAULT_TOKEN_EXPORT_PREFERENCES };
  }

  const colorFormat: ColorFormat = typeof value.colorFormat === 'string' && VALID_COLOR_FORMATS.has(value.colorFormat as ColorFormat)
    ? (value.colorFormat as ColorFormat)
    : DEFAULT_TOKEN_EXPORT_PREFERENCES.colorFormat;

  const convertPxToRem: boolean = typeof value.convertPxToRem === 'boolean'
    ? value.convertPxToRem
    : DEFAULT_TOKEN_EXPORT_PREFERENCES.convertPxToRem;

  const nameStyle: NameStyle = typeof value.nameStyle === 'string' && VALID_NAME_STYLES.has(value.nameStyle as NameStyle)
    ? (value.nameStyle as NameStyle)
    : DEFAULT_TOKEN_EXPORT_PREFERENCES.nameStyle;

  const outputFormat: OutputFormat = typeof value.outputFormat === 'string' && VALID_OUTPUT_FORMATS.has(value.outputFormat as OutputFormat)
    ? (value.outputFormat as OutputFormat)
    : DEFAULT_TOKEN_EXPORT_PREFERENCES.outputFormat;

  const rootFontSize: number = typeof value.rootFontSize === 'number'
    && Number.isFinite(value.rootFontSize)
    && value.rootFontSize > 0
    ? value.rootFontSize
    : DEFAULT_TOKEN_EXPORT_PREFERENCES.rootFontSize;

  return {
    colorFormat,
    convertPxToRem,
    nameStyle,
    outputFormat,
    rootFontSize,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
