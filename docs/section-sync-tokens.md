# Sync Tokens — How It Works (Developer Guide)

Status: Active
Last updated: 2026-08-01
Companion user guide: [`sync-tokens.md`](sync-tokens.md)
Depth doc: [`sync-tokens-architecture.md`](sync-tokens-architecture.md) — the
canonical, detailed reference. This guide is the fast onboarding path; read the
architecture doc when you need the message-protocol byte shapes or the
extension table.

The working tree exports CSS, raw Markdown token lists, flat JSON, W3C DTCG
JSON, SCSS variables/maps, Tailwind theme-extension snippets, and Nested TypeScript objects through one
format dispatcher.

## At a glance

Sync Tokens exports Figma Variable collections in CSS, Markdown, JSON, SCSS,
Tailwind, or Nested TypeScript formats (one file per collection × selected mode). The work splits
into three layers, matching the rest of the plugin:

```text
UI (src/ui.tsx · SyncTokensView)   user picks collections + options
   │  emit PREVIEW_TOKENS / EXPORT_TOKENS
   ▼
Backend (src/main.ts)               reads Figma Variables API → pure model
   │  emit *_TOKENS_RESULT (content + preflight per file)
   ▼
UI (src/ui-controller.ts)           zips files, triggers download
```

**The key rule: the Figma API is only touched in `src/main.ts`.** Everything
that transforms variable data into output files lives in a pure, Figma-runtime-free
module (`src/sync-tokens/`) that the unit tests exercise directly. This mirrors
the `semantic/` and `inspect/` layering.

## Module map

| File | Role |
| --- | --- |
| `src/sync-tokens/types.ts` | Pure domain model. Zero `@figma/plugin-typings` imports. Defines `Token`, `TokenCollection`, `ExportOptions`, `LENGTH_SCOPES`, `ExportFile`. |
| `src/sync-tokens/serialize.ts` | Pure CSS transforms and value formatting. |
| `src/sync-tokens/serialize-formats.ts` | Format dispatcher plus Markdown, JSON, SCSS, Tailwind, and Nested TypeScript serializers; also creates per-token content hashes. |
| `src/sync-tokens/export-diff.ts` | Pure added/changed/removed/unchanged comparison for export snapshots. |
| `src/sync-tokens/serialize.test.ts` | Unit tests for the serializers. |
| `src/main/token-adapter.ts` | The **only** place that calls `figma.variables.*`. `generateTokenFiles`, `collectTokens`, `normalizeValue`, `loadTokenCollections`, `previewTokens`, `exportTokens`. |
| `src/ui-controller.ts` | Holds tab state, owns the message round-trips, packages/downloads results via `deliverTokenFiles`. |
| `src/ui-download.ts` | `downloadBlob()` — the plugin's only file-download mechanism. |
| `src/views/SyncTokensView.tsx` | The `SyncTokensView` component + third-tab wiring. |
| `src/types.ts` | The three message-handler pairs (`LOAD_TOKEN_COLLECTIONS`, `PREVIEW_TOKENS`, `EXPORT_TOKENS`) and their `*_RESULT` partners. |

## The pure core (`src/sync-tokens/`)

This is the part that matters. Four families of functions, each tiny and tested:

- **`formatTokenName(raw, style)` / `formatCssTokenName(raw, style)`** — split
  the Figma name on `/` and rejoin per `style`. `style` is one of:
  - `default` — raw Figma name passed through verbatim.
  - a `{case}` × `{separator}` preset — `lower-`/`title-` × `hyphen`/`underscore`/`slash`/`dot`
    (e.g. `lower-hyphen` = `color-text-primary`, `title-dot` = `Color.Text.Primary`).
    The case names how each segment is normalized; the separator joins them.
  Each segment is normalized independently. `formatCssTokenName` then escapes `.`
  and `/` separators at the CSS-identifier boundary. Markdown token lists
  intentionally use `formatTokenName` directly so dot and slash paths remain raw.
  **Shared with Layout:** `src/layout/figma-layout-extractor.ts` imports
  `formatTokenName` and calls it with `'lower-hyphen'` to build `--<name>` CSS
  variable names. Keep the two in agreement so generated CSS variable names match.
- **`formatColor(value, format, alias?)`** — Figma `RGB`/`RGBA` are 0–1 floats;
  converts to `hex`/`rgb`/`rgba`. The `variable` format emits
  `var(--target-name)` using the alias's resolved name; falls back to `rgb()`
  when no alias is available so the export never produces an empty value.
- **`formatNumber(value, token, options)`** — the subtle one. Figma's `FLOAT`
  resolved type carries **no unit**: the same type holds spacing (px), opacity
  (0–1), and font-weight (600). px→rem is therefore gated on
  `token.scopes` intersecting `LENGTH_SCOPES` (defined in `types.ts`):
  `WIDTH_HEIGHT`, `CORNER_RADIUS`, `GAP`, `STROKE_FLOAT`, `FONT_SIZE`,
  `LINE_HEIGHT`, `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`.
- **`serializeCollection(collection, options)`** — emits the `:root { … }`
  block. Skips tokens whose value serializes to empty (e.g. unresolved
  non-color aliases).

## The Figma adapter (`src/main.ts`)

`generateTokenFiles(collectionIds, options, isCurrent)` is the shared preview
and export orchestrator. Per selected collection, per selected mode:

1. Loads local variables once with `getLocalVariablesAsync` and builds an id
   map; `collectTokens` reads `collection.variableIds` in stable order.
2. `normalizeValue(raw, resolvedType, modeId)` turns the `VariableValue` union
   into the pure `TokenValue` (handles `VariableAlias`, `RGB`, `RGBA`; alias
   resolution is recursive across color/number/string/boolean).
3. Builds a `TokenCollection` and calls the format dispatcher,
   `serializeTokenCollectionByFormat`.
4. Pushes an `ExportFile` with `css`, `declarationCount`,
   `sourceVariableCount`, and non-fatal `warnings`.

## Rules an editor must keep

1. **Figma typings stay out of `src/sync-tokens/`.** It must compile under the
   test project, which has no Figma typings.
2. **Always `*Async`.** `documentAccess: "dynamic-page"` makes the deprecated
   sync Variables API throw. Use `getLocalVariableCollectionsAsync()`,
   `getVariableByIdAsync()`.
3. **Never px→rem without the `LENGTH_SCOPES` check.** A blanket px→rem on
   every FLOAT corrupts opacity and font-weight.
4. **`getCSSAsync()` is a different code path.** The `inspect/` pipeline
   consumes CSS Figma *already emitted* for a node. Sync Tokens *authors* CSS
   from variable values. Don't conflate them.
5. **Cycles and missing alias targets preserve a `var()` reference and add a
   warning** — never fabricate a fallback value.
6. **Export history is informational and user-local.** Store token hashes in
   `clientStorage`; failure to read or write history must never block export.
7. **Collection search uses the native Figma Textbox.** Keep the controlled
   Sync Tokens collection filter on `Textbox` from `@create-figma-plugin/ui`,
   with the standard search icon and accessible label; do not introduce a
   custom or `SearchTextbox` implementation.

## Gotchas

- **Two hardcoded arrays of the tab union.** `workflowTab`'s type literal
  (`src/ui.tsx`) and the `tabs` array in `handleTabKeyDown` must stay in sync.
  Adding a fourth tab means updating the union, `tabs`, `tabIds`, **and** the
  rendered button markup.
- **Export options are not persisted.** Selections and advanced settings reset
  when the plugin reopens. Add a `setSharedPluginData` round-trip if
  repeat-export workflows demand it.
- **One file per (collection × mode).** A multi-mode collection produces
  one file per mode using the selected format's extension. CSS files use a flat
  `:root {}`. Scoped `[data-theme]` blocks would be a backend change in
  `exportTokens` plus the format dispatcher, not a UI change.
- **Naming controls must fit resized plugin windows.** The five token-name
  choices share the available row width down to the supported 360 px minimum;
  keep the `sync-tokens-name-style` wrapper and its flex-shrink rules when
  changing the control.

## Where to make common changes

| Want | Change |
| --- | --- |
| Another output format | Extend `OutputFormat`, the dispatcher, extension mapping, and serializer snapshot tests. |
| Scoped `[data-theme]` blocks instead of per-mode files | `exportTokens` (one file) + `serializeCollection` (scoped blocks). |
| Persist export settings | `setSharedPluginData` on save; load on tab mount. |
| Type badges in the UI list | Add `types: VariableResolvedType[]` to `TokenCollectionSummary`. |

## Related docs

- [Sync Tokens — How It Works (full architecture)](sync-tokens-architecture.md)
- [Sync Tokens user guide](sync-tokens.md)
- [Section guide index](sections-index.md) · [Development guide](development.md)
