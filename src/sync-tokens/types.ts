/**
 * Sync Tokens — serializable domain model for exporting Figma Variable
 * collections as CSS.
 *
 * Figma-plugin-typings-free on purpose: this is the pure core that the unit
 * tests exercise without a Figma runtime. The live `Variable` /
 * `VariableCollection` objects are mapped into these shapes by the adapter
 * in `src/main.ts`.
 */

/** Output format for color (COLOR-resolved) variables. */
export type ColorFormat = 'rgb' | 'rgba' | 'hex' | 'variable';

/**
 * How a variable's slash-delimited Figma name (`Color/Text/Primary/Default`)
 * becomes a CSS custom-property name.
 *
 * - `kebab`  → `--color-text-primary-default` (default; valid bare ident)
 * - `slash`  → `--color/text/primary/default` (scoped via nesting; valid CSS)
 * - `snake`  → `--color_text_primary_default`
 * - `pascal` → `--ColorTextPrimaryDefault`
 */
export type NameStyle = 'kebab' | 'slash' | 'snake' | 'pascal';

/** Figma variable resolved type, mirrored here to stay runtime-free. */
export type VariableResolvedType = 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';

/**
 * Figma variable scopes that hold a CSS length (px). Only these are eligible
 * for px→rem conversion; opacity, font-weight, etc. share the FLOAT type but
 * are unitless. Mirrors `VariableScope` from the plugin typings.
 */
export const LENGTH_SCOPES = new Set<string>([
  'WIDTH_HEIGHT',
  'CORNER_RADIUS',
  'GAP',
  'STROKE_FLOAT',
  'FONT_SIZE',
  'LINE_HEIGHT',
  'LETTER_SPACING',
  'PARAGRAPH_SPACING',
  'PARAGRAPH_INDENT',
]);

/** Options applied while serializing a collection to CSS. */
export type ExportOptions = {
  /** Per-collection chosen mode ids (collections define their own modes). */
  modesByCollection: Readonly<Record<string, readonly string[]>>;
  /** Divide length-scoped FLOAT values by `rootFontSize`. */
  convertPxToRem: boolean;
  /** Divisor for px→rem. Default 16. */
  rootFontSize: number;
  /** Output format for color variables. */
  colorFormat: ColorFormat;
  /** Custom-property naming convention. */
  nameStyle: NameStyle;
};

/** A resolved color value (Figma RGB/RGBA use 0–1 floats). */
export type ColorValue = { r: number; g: number; b: number; a?: number };

/** Reference to another token; the adapter resolves it to a usable name. */
export type AliasValue = { targetName: string };

/** A single variable's value for the selected mode, normalized. */
export type TokenValue =
  | { kind: 'color'; value: ColorValue }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'alias'; value: AliasValue };

/** A normalized variable. */
export type Token = {
  id: string;
  name: string;
  resolvedType: VariableResolvedType;
  /** Scopes, used to decide px→rem eligibility for FLOAT tokens. */
  scopes: readonly string[];
  value: TokenValue;
};

/** A normalized collection's mode descriptor. */
export type TokenMode = { modeId: string; name: string };

/** A normalized collection ready for serialization. */
export type TokenCollection = {
  id: string;
  name: string;
  modes: readonly TokenMode[];
  defaultModeId: string;
  tokens: readonly Token[];
};

/** A collection's public shape for UI listing (no token values). */
export type TokenCollectionSummary = {
  id: string;
  name: string;
  modes: readonly TokenMode[];
  defaultModeId: string;
  /** Number of variables in the collection, for the UI list. */
  tokenCount: number;
};

/** One generated CSS file. */
export type ExportFile = { name: string; css: string };
