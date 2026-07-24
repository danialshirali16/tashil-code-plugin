# Sync Tokens — How It Works (Developer Guide)

Status: Active
Last updated: 2026-07-24
Companion user guide: [`sync-tokens.md`](./sync-tokens.md)

This document is for engineers working on the **Sync Tokens** tab. It covers
the data flow, the module boundaries, the message protocol, and the non-obvious
decisions. Read this before changing anything in the export pipeline.

## At a glance

Sync Tokens exports Figma Variable collections as CSS files. The work splits
cleanly into three layers, matching the rest of the plugin:

```text
UI (src/ui.tsx)               user picks collections + options
   │  emit EXPORT_TOKENS
   ▼
Backend (src/main.ts)         reads Figma Variables API → pure domain model
   │  emit EXPORT_TOKENS_RESULT (CSS strings per file)
   ▼
UI (src/ui-controller.ts)     zips the files, triggers a download
```

The key rule: **the Figma API is only touched in `src/main.ts`**. Everything
that transforms variable data into CSS lives in a pure, Figma-runtime-free
module (`src/sync-tokens/`) that the unit tests exercise directly. This mirrors
the `semantic/` and `inspect/` layering.

## Module map

| File | Role |
| --- | --- |
| `src/sync-tokens/types.ts` | Pure domain model. Zero `@figma/plugin-typings` imports. |
| `src/sync-tokens/serialize.ts` | Pure transforms: name → CSS ident, color → css, number → rem, collection → `:root {}` block. |
| `src/sync-tokens/serialize.test.ts` | Unit tests for the above (22 cases). |
| `src/main.ts` | The only place that calls `figma.variables.*`. Maps live Variable objects into the pure domain model, then serializes. |
| `src/ui-controller.ts` | Holds tab state, owns the message round-trips, and **packages/downloads** the result. |
| `src/ui-download.ts` | `downloadBlob()` — `URL.createObjectURL` + synthetic `<a download>`. The plugin's only file-download mechanism. |
| `src/ui.tsx` | The `SyncTokensView` component + third tab wiring. |
| `src/types.ts` | The four message handler types. |

tsconfig note: new backend files must be added to `tsconfig.json`'s `include`;
UI/view files to `tsconfig.ui.json`; tests to `tsconfig.tests.json`. The pure
core compiles under the test project too (no Figma typings there).

## The message protocol

Sync Tokens uses two request/response pairs, following the same
`@create-figma-plugin/utilities` `emit`/`on` pattern as the rest of the plugin
(see `SCAFFOLD_PROP_MAPPINGS`/`SCAFFOLD_RESULT`). Defined in `src/types.ts`.

### 1. Load the collection list

```text
LOAD_TOKEN_COLLECTIONS  (UI → main, no payload)
LOAD_TOKEN_COLLECTIONS_RESULT  (main → UI)
   { ok, collections?: TokenCollectionSummary[], message? }
```

`TokenCollectionSummary` carries `id`, `name`, `modes[]`, `defaultModeId`, and
`tokenCount` (the length of `collection.variableIds`) — enough to render the
list without shipping token values to the UI.

### 2. Export

```text
EXPORT_TOKENS  (UI → main)
   { operationId, collectionIds: string[], options: ExportOptions }

EXPORT_TOKENS_RESULT  (main → UI)
   { ok, operationId, files?: ExportFile[], message? }
```

`ExportFile` is `{ name: string; css: string }` — **CSS text, not bytes**. The
UI owns packaging (zip) and download; the backend knows nothing about jszip.

### Correlation / stale guards

Both round-trips use an `operationId` the UI generates, and the backend tracks
the latest id (`latestTokensExportId` in `main.ts`). If a newer export request
supersedes an in-flight one, the late resolve is ignored. This is the same
pattern as `scanComponents`/`latestComponentScanId`.

## The pure core (`src/sync-tokens/`)

This is the part that matters. Four functions, each tiny and tested:

### `formatTokenName(raw, style)`

Splits the Figma name on `/` (Figma groups variables with slashes) and rejoins
per the chosen style. Each segment is normalized independently — never the raw
string — so internal camelCase and spaces are handled. Styles: `kebab`, `slash`,
`snake`, `pascal`.

### `formatColor(value, format, alias?)`

`RGB`/`RGBA` from the Figma API are 0–1 floats; this converts to `hex`/`rgb`/
`rgba`. The `variable` format emits `var(--target-name)` using the alias's
resolved name. When no alias is available and `variable` is requested, it falls
back to `rgb()` so the export never produces an empty/broken value.

### `formatNumber(value, token, options)`

The subtle one. Figma's `FLOAT` resolved type carries **no unit** — the same
type holds spacing (px), opacity (0–1), and font-weight (600). So px→rem is
gated on `token.scopes` intersecting `LENGTH_SCOPES` (defined in `types.ts`):
`WIDTH_HEIGHT`, `CORNER_RADIUS`, `GAP`, `STROKE_FLOAT`, `FONT_SIZE`,
`LINE_HEIGHT`, `LETTER_SPACING`, `PARAGRAPH_SPACING`, `PARAGRAPH_INDENT`.

A blanket px→rem on every FLOAT would corrupt opacity and font-weight. Don't
remove the scope check.

### `serializeCollection(collection, options)`

Emits the `:root { … }` block. Skips tokens whose value serializes to empty
(e.g. unresolved non-color aliases).

## The Figma adapter (`src/main.ts`)

`exportTokens(operationId, collectionIds, options)` is the orchestrator. Per
selected collection, per selected mode:

1. `collectTokens(collection, modeId)` — iterates `collection.variableIds`,
   calls `figma.variables.getVariableByIdAsync(id)`, reads
   `variable.valuesByMode[modeId]`.
2. `normalizeValue(raw, resolvedType, modeId)` — turns the `VariableValue`
   union into the pure `TokenValue`. Handles the three object shapes:
   `VariableAlias` (resolves via `getVariableByIdAsync`, and if the target is a
   color, resolves the color too), `RGB`, `RGBA`.
3. Builds a `TokenCollection` and calls `serializeCollection`.
4. Pushes an `ExportFile` named `{collection}-{mode}.css` (single mode → no
   suffix).

**Critical:** `manifest.json` has `documentAccess: "dynamic-page"`, so the
deprecated sync Variables API (`getLocalVariableCollections()`,
`getVariableById()`) **throws**. Always use the `*Async` variants:
`getLocalVariableCollectionsAsync()`, `getVariableByIdAsync()`.

Alias resolution is recursive for colors (`resolveColorValue` follows the alias
chain). It is **not** recursive for non-colors — a non-color alias with no
concrete value is skipped. Extending this is a known gap.

## Packaging & download (`src/ui-controller.ts`)

`deliverTokenFiles(files)` runs on the UI thread (the main thread has no DOM,
so it cannot trigger downloads):

- **One file** → `new Blob([css], {type: 'text/css'})` + `downloadBlob`.
- **Multiple files** → `JSZip`, `generateAsync({type:'blob'})`, downloaded as
  `sync-tokens.zip`.

`downloadBlob` (in `src/ui-download.ts`) creates a synthetic `<a download>`,
clicks it, and revokes the object URL on the next tick. Modeled on
`src/ui-clipboard.ts` — before this feature, the plugin had **no** file-download
mechanism at all.

`jszip` is the one dependency this feature adds. It's pure JS (no network),
compatible with `@create-figma-plugin/build`'s esbuild bundling, and works
under the plugin's `networkAccess.allowedDomains: ["none"]`.

## The UI (`src/ui.tsx`)

`SyncTokensView` is a function component, consistent with `InspectCodeView`.
Local state holds:

- `selected: Set<string>` — checked collection ids
- `modesByCollection: Record<string, Set<string>>` — per-collection selected
  mode ids (multi-select). Empty = use the collection's default mode.
- the advanced-option fields (`convertPxToRem`, `rootFontSize`, `colorFormat`,
  `nameStyle`)

The view is mounted as the third tab. Adding it required generalizing the
`workflowTab` union from `'connect' | 'generate'` to include `'sync-tokens'`,
plus the tab-bar and keyboard-nav (`handleTabKeyDown`) arrays — see the
"two hardcoded arrays" note below.

## Decisions worth knowing

### One file per (collection × mode)

When a collection exports multiple modes, each mode becomes its own CSS file
(`colors-light.css`, `colors-dark.css`), each a flat `:root {}`. The
alternative — one file with `[data-theme="dark"]` scoped blocks — was rejected
in favor of simpler per-file output. If you want scoped output, that's a
backend change in `exportTokens` + `serializeCollection`, not a UI change.

### Export options are not persisted

Selections and advanced settings reset when the plugin reopens. There is no
`setSharedPluginData` round-trip for them. Add one if repeat-export workflows
demand it — the persistence pattern already exists for connections.

### Why CSS only

`.scss` and `.json` outputs are not supported. The serializer is pure and could
emit other formats by adding a format selector + a sibling to
`serializeCollection`; the domain model is format-agnostic.

## Gotchas

- **Two hardcoded arrays of the tab union.** `workflowTab`'s type literal
  (`ui.tsx:61`) and the `tabs` array in `handleTabKeyDown` must stay in sync.
  Adding a fourth tab means updating both, plus the `tabIds` lookup.
- **Figma typings are only in the backend project.** Don't import
  `@figma/plugin-typings` types into `src/sync-tokens/` — it must stay pure so
  the test project (which has no Figma typings) can compile it.
- **The deprecated sync Variables API throws under dynamic-page.** Always
  `*Async`.
- **FLOAT has no unit.** Never px→rem without the `LENGTH_SCOPES` check.
- **`getCSSAsync` is unrelated.** The `inspect/` CSS pipeline consumes CSS that
  Figma *already emitted* for a node. Sync Tokens *authors* CSS from variable
  values. Different code paths, don't conflate.

## Extending it

Common requests and where they land:

| Want | Change |
| --- | --- |
| `.scss` / `.json` output | Add an output-format option; new serializer alongside `serializeCollection`. |
| Scoped `[data-theme]` blocks instead of per-mode files | `exportTokens` (one file) + `serializeCollection` (scoped blocks). |
| Persist export settings | `setSharedPluginData` on save; load on tab mount. |
| Recursive non-color alias resolution | Generalize `resolveColorValue` to `resolveValue` across types. |
| Type badges in the UI | Backend already sends `tokenCount`; add a `types: VariableResolvedType[]` to `TokenCollectionSummary` from `collection.variableIds`. |
