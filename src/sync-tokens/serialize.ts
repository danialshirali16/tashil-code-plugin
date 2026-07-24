/**
 * Pure CSS serialization for Sync Tokens. No Figma runtime, no DOM.
 *
 * Each function is tiny and independently testable. The only non-obvious
 * rule is px→rem scoping: Figma FLOAT variables carry no unit, so we only
 * divide the ones whose scopes name a CSS length (see `LENGTH_SCOPES`).
 */
import {
  LENGTH_SCOPES,
  type AliasValue,
  type ColorFormat,
  type ColorValue,
  type ExportOptions,
  type NameStyle,
  type Token,
  type TokenCollection,
  type TokenValue,
} from './types';

/** Split a Figma name on `/` and rejoin per the chosen style. */
export function formatTokenName(raw: string, style: NameStyle): string {
  // ponytail: Figma groups via `/`; segments may already contain spaces or
  // mixed case. We normalize each segment, never the raw string wholesale.
  const segments = raw.split('/').map((segment) => segment.trim()).filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return 'unnamed';
  }
  switch (style) {
    case 'kebab':
      return segments.map(toKebab).join('-');
    case 'slash':
      return segments.map(toKebab).join('/');
    case 'snake':
      return segments.map(toSnake).join('_');
    case 'pascal':
      return segments.map(toPascal).join('');
  }
}

function toKebab(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

function toSnake(segment: string): string {
  return toKebab(segment).replace(/-/g, '_');
}

function toPascal(segment: string): string {
  return toKebab(segment)
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join('');
}

/** Round to at most `digits` decimals, trimming trailing zeros. */
function trimNumber(value: number, digits = 4): string {
  return Number(value.toFixed(digits)).toString();
}

/** Convert a 0–1 float channel to a two-digit hex pair. */
function toHexChannel(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 255).toString(16).padStart(2, '0');
}

/** Format a color value per the requested output format. */
export function formatColor(value: ColorValue, format: ColorFormat, alias?: AliasValue): string {
  if (format === 'variable' && alias !== undefined) {
    return `var(--${formatTokenName(alias.targetName, 'kebab')})`;
  }
  const { r, g, b } = value;
  switch (format) {
    case 'hex': {
      const alpha = value.a === undefined ? '' : value.a >= 1 ? '' : toHexChannel(value.a);
      return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}${alpha}`;
    }
    case 'rgb':
      // ponytail: rgb() drops alpha intentionally; use 'rgba' to keep it.
      return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
    case 'rgba': {
      const a = value.a === undefined ? 1 : value.a;
      return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${trimNumber(a)})`;
    }
    case 'variable':
      // No alias available — fall back to rgb so the export never breaks.
      return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  }
}

/** Format a numeric value, applying px→rem only to length-scoped tokens. */
export function formatNumber(value: number, token: Token, options: ExportOptions): string {
  if (!options.convertPxToRem) {
    return trimNumber(value);
  }
  const isLength = token.scopes.some((scope) => LENGTH_SCOPES.has(scope));
  if (!isLength) {
    return trimNumber(value);
  }
  const divisor = options.rootFontSize > 0 ? options.rootFontSize : 16;
  return `${trimNumber(value / divisor)}rem`;
}

/** Serialize a single token's value to its CSS string. */
export function formatTokenValue(token: Token, options: ExportOptions): string {
  return formatTokenValueOf(token.value, token, options);
}

function formatTokenValueOf(value: TokenValue, token: Token, options: ExportOptions): string {
  switch (value.kind) {
    case 'color':
      return formatColor(value.value, options.colorFormat);
    case 'alias':
      return options.colorFormat === 'variable' || token.resolvedType === 'COLOR'
        ? formatColor({ r: 0, g: 0, b: 0 }, options.colorFormat, value.value)
        : '';
    case 'number':
      return formatNumber(value.value, token, options);
    case 'string':
      return quoteIfNeeded(value.value);
    case 'boolean':
      return value.value ? 'true' : 'false';
  }
}

/** CSS values that aren't bare idents or numbers should be quoted. */
function quoteIfNeeded(value: string): string {
  if (value.length === 0) {
    return '""';
  }
  // Bare ident / number / already-quoted → leave alone.
  if (/^[-+]?(?:\d+(?:\.\d+)?|\.\d+)([a-z%]*)$/i.test(value) || /^["'].*["']$/.test(value)) {
    return value;
  }
  if (/^[A-Za-z-][A-Za-z0-9-]*$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

/** Serialize a full collection to a `:root { ... }` CSS block. */
export function serializeCollection(collection: TokenCollection, options: ExportOptions): string {
  const lines: string[] = [`/* ${collection.name} — exported from Figma variables */`, ':root {'];
  for (const token of collection.tokens) {
    const name = formatTokenName(token.name, options.nameStyle);
    const value = formatTokenValue(token, options);
    if (value.length === 0) {
      continue;
    }
    lines.push(`  --${name}: ${value};`);
  }
  lines.push('}');
  return lines.join('\n');
}
