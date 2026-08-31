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
 * becomes an exported token name.
 *
 * - `kebab`  → `--color-text-primary-default` (default; valid bare ident)
 * - `slash`  → `--color/text/primary/default`
 * - `dot`    → `--color.text.primary.default`
 * - `snake`  → `--color_text_primary_default`
 * - `pascal` → `--Color.Text.Primary.Default`
 *
 * CSS output escapes slash and dot separators. Raw Markdown output preserves
 * them exactly for token-reference tooling that is not parsed as CSS.
 */
/**
 * Token name style. `default` passes the raw Figma name through verbatim; the
 * other eight are a {case} × {separator} matrix:
 *   `lower-`/`title-` × `hyphen`/`underscore`/`slash`/`dot`.
 */
export type NameStyle =
  | 'default'
  | 'lower-hyphen'
  | 'lower-underscore'
  | 'lower-slash'
  | 'lower-dot'
  | 'title-hyphen'
  | 'title-underscore'
  | 'title-slash'
  | 'title-dot';
export type OutputFormat =
  | 'css'
  | 'json-flat'
  | 'json-dtcg'
  | 'markdown'
  | 'scss'
  | 'tailwind-theme'
  | 'typescript-nested';

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
  /** File syntax. Omitted payloads retain the historical CSS default. */
  outputFormat?: OutputFormat;
  /** Per-collection chosen mode ids (collections define their own modes). */
  modesByCollection: Readonly<Record<string, readonly string[]>>;
  /**
   * Optional explicit mode mapping for aliases that cross collection
   * boundaries: source collection → source mode → target collection → mode.
   */
  aliasModeOverridesByCollectionMode?: Readonly<
    Record<
      string,
      Readonly<Record<string, Readonly<Record<string, string>>>>
    >
  >;
  /** Divide length-scoped FLOAT values by `rootFontSize`. */
  convertPxToRem: boolean;
  /** Divisor for px→rem. Default 16. */
  rootFontSize: number;
  /** Output format for color variables. */
  colorFormat: ColorFormat;
  /** Exported token naming convention. */
  nameStyle: NameStyle;
};

/** A resolved color value (Figma RGB/RGBA use 0–1 floats). */
export type ColorValue = { r: number; g: number; b: number; a?: number };

/** A concrete value reached after following any variable aliases. */
export type ResolvedTokenValue =
  | { kind: 'color'; value: ColorValue }
  | { kind: 'number'; value: number }
  | { kind: 'string'; value: string }
  | { kind: 'boolean'; value: boolean };

/** Reference to another token, with its concrete value when resolution succeeds. */
export type AliasValue = {
  targetName: string;
  resolvedValue?: ResolvedTokenValue;
};

/** A single variable's value for the selected mode, normalized. */
export type TokenValue =
  | ResolvedTokenValue
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

export type TokenExportWarningCode =
  | 'missing-mode-value'
  | 'missing-variable'
  | 'mode-fallback'
  | 'unknown-number-scope'
  | 'unresolved-alias'
  | 'unsupported-value';

/** A non-fatal condition discovered while resolving an output file. */
export type TokenExportWarning = {
  code: TokenExportWarningCode;
  message: string;
  tokenName?: string;
  /** Present for mode-fallback warnings so the UI can offer a correction. */
  sourceCollectionId?: string;
  sourceModeId?: string;
  targetCollectionId?: string;
  fallbackModeId?: string;
};

/** One generated token file plus the preflight data used by preview and export. */
export type ExportFile = {
  name: string;
  css: string;
  declarationCount: number;
  sourceVariableCount: number;
  warnings: readonly TokenExportWarning[];
  diff?: TokenExportDiff;
  tokenSnapshot?: Readonly<Record<string, string>>;
};

export type TokenExportDiff = {
  added: number;
  changed: number;
  removed: number;
  unchanged: number;
};
