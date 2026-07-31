# Sync Tokens — How It Works (Developer Guide)

Status: Active
Last updated: 2026-07-31
Companion user guide: [`sync-tokens.md`](sync-tokens.md)
Depth doc: [`sync-tokens-architecture.md`](sync-tokens-architecture.md) — the
canonical, detailed reference. This guide is the fast onboarding path; read the
architecture doc when you need the message-protocol byte shapes or the
extension table.

> **On-disk state note.** The working tree currently exports **CSS only**.
> JSON output (`serialize-json.ts`, the `outputFormat` dispatch in
> `generateTokenFiles`, W3C DTCG and flat-JSON serializers, duplicate-name
> warnings, and a unit test) exists on the `GLM/Token-syncs` branch and is
> documented in the **In progress** section below. Do not write code that
> assumes JSON output is on `main`.

## At a glance

Sync Tokens exports Figma Variable collections as CSS files (one file per
collection × selected mode). The work splits into three layers, matching the
rest of the plugin:

```text
UI (src/ui.tsx · SyncTokensView)   user picks collections + options
   │  emit PREVIEW_TOKENS / EXPORT_TOKENS
   ▼
Backend (src/main.ts)               reads Figma Variables API → pure model
   │  emit *_TOKENS_RESULT (CSS + preflight per file)
   ▼
UI (src/ui-controller.ts)           zips files, triggers download
```

**The key rule: the Figma API is only touched in `src/main.ts`.** Everything
that transforms variable data into CSS lives in a pure, Figma-runtime-free
module (`src/sync-tokens/`) that the unit tests exercise directly. This mirrors
the `semantic/` and `inspect/` layering.

## Module map

| File | Role |
| --- | --- |
| `src/sync-tokens/types.ts` | Pure domain model. Zero `@figma/plugin-typings` imports. Defines `Token`, `TokenCollection`, `ExportOptions`, `LENGTH_SCOPES`, `ExportFile`. |
| `src/sync-tokens/serialize.ts` | Pure transforms: `formatTokenName` / `formatCssTokenName` (name → CSS ident), `formatColor`, `formatNumber`, `serializeCollection` (`:root {}` block). |
| `src/sync-tokens/serialize.test.ts` | Unit tests for the serializers. |
| `src/main.ts` | The **only** place that calls `figma.variables.*`. `generateTokenFiles`, `collectTokens`, `normalizeValue`, `loadTokenCollections`, `previewTokens`, `exportTokens`. |
| `src/ui-controller.ts` | Holds tab state, owns the message round-trips, packages/downloads results via `deliverTokenFiles`. |
| `src/ui-download.ts` | `downloadBlob()` — the plugin's only file-download mechanism. |
| `src/ui.tsx` | The `SyncTokensView` component + third-tab wiring. |
| `src/types.ts` | The three message-handler pairs (`LOAD_TOKEN_COLLECTIONS`, `PREVIEW_TOKENS`, `EXPORT_TOKENS`) and their `*_RESULT` partners. |

## The pure core (`src/sync-tokens/`)

This is the part that matters. Four families of functions, each tiny and tested:

- **`formatTokenName(raw, style)` / `formatCssTokenName(raw, style)`** — split
  the Figma name on `/` and rejoin per `style` (`kebab` | `slash` | `dot` |
  `snake` | `pascal`). Each segment is normalized independently. `formatCssTokenName`
  then escapes `.` and `/` separators at the CSS-identifier boundary.
  **Shared with Layout:** `src/layout/figma-layout-extractor.ts` imports
  `formatTokenName` and calls it with `'kebab'` to build `--<name>` CSS variable
  names. Keep the two in agreement so generated CSS variable names match.
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
3. Builds a `TokenCollection` and calls `serializeCollection`.
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

## Gotchas

- **Two hardcoded arrays of the tab union.** `workflowTab`'s type literal
  (`src/ui.tsx`) and the `tabs` array in `handleTabKeyDown` must stay in sync.
  Adding a fourth tab means updating the union, `tabs`, `tabIds`, **and** the
  rendered button markup.
- **Export options are not persisted.** Selections and advanced settings reset
  when the plugin reopens. Add a `setSharedPluginData` round-trip if
  repeat-export workflows demand it.
- **One file per (collection × mode).** A multi-mode collection produces
  `colors-light.css`, `colors-dark.css`, each a flat `:root {}`. Scoped
  `[data-theme]` blocks would be a backend change in `exportTokens` +
  `serializeCollection`, not a UI change.

## In progress (`GLM/Token-syncs` branch — not on `main`)

The following exists **only on the `GLM/Token-syncs` branch** and is not in the
working tree on `main`. If you are working on that branch, these are real; if
you are on `main`, they are upcoming:

- **`src/sync-tokens/serialize-json.ts`** — `serializeCollectionFlat` (mirrors
  the CSS keys/values, always hex colors) and `serializeCollectionDtcg` (W3C
  DTCG `$value`/`$type`, nested by `/` path). JSON output intentionally ignores
  `colorFormat` (always hex) to avoid an 8-way behavior matrix.
- **`outputFormat` dispatch** in `generateTokenFiles` — `css | json-flat |
  json-dtcg`, picking the file extension accordingly.
- **Duplicate-name warnings** — `duplicateNameWarning` in `serialize.ts`; the
  duplicate-name count is subtracted from `declarationCount`.

When this work merges to `main`, move these bullets into the main body above
and delete this section.

## Where to make common changes

| Want | Change |
| --- | --- |
| `.scss` / `.json` output | Add an output-format option; new serializer alongside `serializeCollection`. (JSON is in progress on `GLM/Token-syncs`.) |
| Scoped `[data-theme]` blocks instead of per-mode files | `exportTokens` (one file) + `serializeCollection` (scoped blocks). |
| Persist export settings | `setSharedPluginData` on save; load on tab mount. |
| Type badges in the UI list | Add `types: VariableResolvedType[]` to `TokenCollectionSummary`. |

## Related docs

- [Sync Tokens — How It Works (full architecture)](sync-tokens-architecture.md)
- [Sync Tokens user guide](sync-tokens.md)
- [Section guide index](sections-index.md) · [Development guide](development.md)
