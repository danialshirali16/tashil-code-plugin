/**
 * Pure JSON serialization for Sync Tokens. No Figma runtime, no DOM.
 *
 * Two flavors share this file:
 *  - `serializeCollectionFlat`: a flat object mirroring the CSS keys/values
 *    (keys are formatted token names; values are the same strings the CSS
 *    serializer emits, but colors are always hex so JSON consumers don't have
 *    to parse `rgb()` or `var()`).
 *  - `serializeCollectionDtcg`: the W3C Design Tokens Format — nested by the
 *    Figma `/` path with `{ $value, $type }` leaves, aliases as `{reference}`.
 *
 * Both reuse the duplicate-name guard from the CSS serializer.
 *
 * ponytail: the JSON path intentionally ignores `colorFormat` — colors are
 * always hex here. Letting the 4 color formats × 2 JSON flavors cross-product
 * would be an 8-way behavior matrix nobody can keep straight; CSS keeps the
 * color-format knob, JSON keeps it predictable.
 */
import {
  formatTokenName,
  duplicateNameWarning,
  tokenNameSegments,
} from './serialize';
import {
  LENGTH_SCOPES,
  type ExportOptions,
  type ResolvedTokenValue,
  type Token,
  type TokenCollection,
  type TokenExportWarning,
} from './types';

/**
 * Resolve a token to its JSON-leaf value and DTCG `$type`.
 * Returns `null` for a value that should be skipped (unresolved alias with no
 * concrete value is emitted as a `{reference}` string by the caller, not here).
 */
function jsonValueAndType(
  token: Token,
  options: ExportOptions,
): { value: string | number | boolean; type: string } | null {
  const resolved = resolveForJson(token.value, token, options);
  if (resolved === null) {
    return null;
  }
  return { value: resolved.value, type: resolved.type };
}

function resolveForJson(
  value: Token['value'],
  token: Token,
  options: ExportOptions,
): { value: string | number | boolean; type: string } | null {
  switch (value.kind) {
    case 'color':
      return { value: colorToHex(value.value), type: 'color' };
    case 'number':
      return { value: numberForJson(value.value, token, options), type: numberType(token) };
    case 'string':
      return { value: value.value, type: 'string' };
    case 'boolean':
      return { value: value.value, type: 'boolean' };
    case 'alias': {
      // Aliases reference another token. In flat output we can only emit a
      // string; emit the `{path}` reference form (DTCG-style) so it round-trips.
      const ref = `{${formatTokenName(value.value.targetName, 'kebab')}}`;
      const resolved = value.value.resolvedValue;
      if (resolved === undefined) {
        return { value: ref, type: 'string' };
      }
      const typed = resolvedToValue(resolved, token, options);
      return typed === null
        ? { value: ref, type: 'string' }
        : { value: ref, type: typed.type };
    }
  }
}

function resolvedToValue(
  resolved: ResolvedTokenValue,
  token: Token,
  options: ExportOptions,
): { value: string | number | boolean; type: string } | null {
  switch (resolved.kind) {
    case 'color':
      return { value: colorToHex(resolved.value), type: 'color' };
    case 'number':
      return { value: numberForJson(resolved.value, token, options), type: numberType(token) };
    case 'string':
      return { value: resolved.value, type: 'string' };
    case 'boolean':
      return { value: resolved.value, type: 'boolean' };
  }
}

/** FLOAT carries no unit; length-scoped → `dimension` (value converted to rem), else `number`. */
function numberType(token: Token): string {
  const isLength = token.scopes.some((scope) => LENGTH_SCOPES.has(scope));
  return isLength ? 'dimension' : 'number';
}

function numberForJson(value: number, token: Token, options: ExportOptions): string | number {
  if (options.convertPxToRem && token.scopes.some((scope) => LENGTH_SCOPES.has(scope))) {
    const divisor = options.rootFontSize > 0 ? options.rootFontSize : 16;
    return `${trimNumber(value / divisor)}rem`;
  }
  return value;
}

/** Convert a 0–1 float channel to a two-digit hex pair. Mirrors serialize.ts. */
function toHexChannel(value: number): string {
  const clamped = Math.max(0, Math.min(1, value));
  return Math.round(clamped * 255).toString(16).padStart(2, '0');
}

function colorToHex(color: { r: number; g: number; b: number; a?: number }): string {
  const alpha = color.a === undefined || color.a >= 1 ? '' : toHexChannel(color.a);
  return `#${toHexChannel(color.r)}${toHexChannel(color.g)}${toHexChannel(color.b)}${alpha}`;
}

function trimNumber(value: number, digits = 4): string {
  return Number(value.toFixed(digits)).toString();
}

/** Flat JSON: `{ "token-name": "value", ... }`. Mirrors CSS keys/values. */
export function serializeCollectionFlat(
  collection: TokenCollection,
  options: ExportOptions,
  warnings?: TokenExportWarning[],
): string {
  const out: Record<string, string | number | boolean> = {};
  const seen = new Set<string>();
  for (const token of collection.tokens) {
    const name = formatTokenName(token.name, options.nameStyle);
    const typed = jsonValueAndType(token, options);
    if (typed === null) {
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      out[name] = typed.value;
    } else if (warnings !== undefined) {
      warnings.push(duplicateNameWarning(token.name, name));
    }
  }
  return JSON.stringify(out, null, 2);
}

/**
 * W3C Design Tokens Format: nested by the Figma `/` path (using the chosen
 * name style's segments), each leaf `{ $value, $type }`.
 */
export function serializeCollectionDtcg(
  collection: TokenCollection,
  options: ExportOptions,
  warnings?: TokenExportWarning[],
): string {
  const root: Record<string, unknown> = {};
  const seen = new Set<string>();
  for (const token of collection.tokens) {
    const segments = tokenNameSegments(token.name, options.nameStyle);
    const flatName = segments.join('.');
    if (seen.has(flatName)) {
      if (warnings !== undefined) {
        warnings.push(duplicateNameWarning(token.name, flatName));
      }
      continue;
    }
    seen.add(flatName);
    const typed = jsonValueAndType(token, options);
    if (typed === null) {
      continue;
    }
    insertLeaf(root, segments, { $value: typed.value, $type: typed.type });
  }
  return JSON.stringify(root, null, 2);
}

/** Walk/create nested objects and set the leaf at the final segment. */
function insertLeaf(
  root: Record<string, unknown>,
  segments: string[],
  leaf: { $value: unknown; $type: string },
): void {
  let node: Record<string, unknown> = root;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = node[key];
    if (typeof next !== 'object' || next === null) {
      const fresh: Record<string, unknown> = {};
      node[key] = fresh;
      node = fresh;
    } else {
      node = next as Record<string, unknown>;
    }
  }
  node[segments[segments.length - 1]] = leaf;
}
