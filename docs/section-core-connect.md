# Core Connect / Codegen — How It Works (Developer Guide)

Status: Active
Last updated: 2026-07-31
Companion: [user guide](connect-component.md) · [prop mapping](prop-mapping.md) · [maintain](maintain-connections.md) · [Section guide index](sections-index.md)

This is the connect-component pipeline that lives in the **`src/` root** (not
in a feature subfolder). It owns the Figma plugin entry point, the Preact UI,
local source parsing, the visual mapping authoring flow, the legacy codegen,
drift detection, and the shared message types that every other section uses.
The other four sections (inspect, layout, semantic, sync-tokens) plug into the
connection model defined here.

## At a glance — the authoring → runtime boundary

```text
Source upload (.ts/.tsx) + Figma selection
        │  parseSourceComponent (source-schema.ts) — local, AST-only
        ▼
Visual mapping document   (mapping-document.ts / mapping-editor.ts)
        │  compileMappingDocument →
        ▼
PropMappings JSON         (the stable runtime table)
        │
        ├──► Dev Mode + Inspect:  createConnectedOutput (main.ts:347)
        │       ├─ semanticRecipe? → resolveSemanticUsage (semantic section)
        │       └─ else            → createUsageSnippet  (codegen.ts, legacy)
        │
        └──► Layout Composer:      createConnectedUsage (layout section)

Persisted as shared plugin data, namespace 'tashil_storybook', key 'connection',
schemaVersion 4. Older schemas (1–3) migrated in memory; rewritten only on save.
```

`ConnectionMetadata` is the envelope. `semanticRecipe` is an optional field on
it (see the semantic section — **not** a schema bump). `propMappings` is the
legacy runtime table; semantic recipes do not compile back into it beyond a
simple subset.

## Module map

| File | Role |
| --- | --- |
| `src/main.ts` | **Plugin main-thread entry.** Registers the Dev Mode `figma.codegen.on('generate', …)` handler, owns selection reads and connection persistence. `createConnectedOutput` (line 347) is the single generation pipeline for Dev Mode + Inspect. |
| `src/ui.tsx` | Preact UI: Connect Component, Inspect Code, and Sync Tokens tabs. `workflowTab` state + the tab arrays (see Gotchas). |
| `src/ui-controller.ts` | Wires Preact hooks to the message handlers; owns source upload, mapping edits, save/clear, reconciliation, Sync Tokens packaging/download. |
| `src/ui-state.ts` | Pure form-draft state machine: dirty-tracking, validation, pending-mutation identity. `ConnectionFormValues` (13 fields), `FormDraft`, `FormValidationResult`. |
| `src/source-schema.ts` | `parseSourceComponent` — local TS AST parser → `SourceComponentSnapshot`. Drops `UNSUPPORTED_STANDARD_PROPS` (`className, id, key, ref, style`). Pure, Figma-free. |
| `src/mapping-editor.ts` | Compiles visual authoring state into codegen `PropMappings`, preserving advanced entries. `compileMappingDocument`, `VALUE_ALIASES` synonym normalization. |
| `src/mapping-document.ts` | Pure helpers over `MappingDocument`/`PropMappings`. Uses null-prototype dictionaries (`Object.create(null)`) to avoid `__proto__` collisions on user-supplied names. |
| `src/prop-mappings.ts` | `mergePropMappingsJson` — merges scaffolded mappings into existing JSON; validates. `$instanceSwap` sentinel for dynamic instance-swap. |
| `src/codegen.ts` | **Pure, Figma-agnostic codegen + metadata validation/migration.** `createComponentUsage`, `createUsageSnippet` (byte-identical compat wrapper), `validatePersistedConnectionMetadata`, `migratePersistedConnectionMetadata`. |
| `src/connection-health.ts` | `evaluateConnectionHealth`, `findMappingConflicts`. `ConnectionHealthStatus`, `ConnectionDrift` (12 kinds). |
| `src/types.ts` | **The shared spine.** `CURRENT_SCHEMA_VERSION = 4`, `CONNECTION_NAMESPACE = 'tashil_storybook'`, `CONNECTION_KEY = 'connection'`, `ConnectionMetadata`, and every message-handler pair. |
| `src/external-url.ts` | Safe external-URL handling for reference links. |
| `src/ui-clipboard.ts` / `src/ui-download.ts` | UI-thread clipboard + file-download (`downloadBlob`). The main thread has no DOM, so these live on the UI side. |
| `src/css-values.ts` | CSS value helpers. |

## Rules an editor must keep

1. **`CURRENT_SCHEMA_VERSION` is in `types.ts`; the migration `switch` and the
   "supports versions…" message are in `codegen.ts`.** Bump them together.
   `migratePersistedConnectionMetadata` is an **exhaustive** `switch` over
   `persisted.schemaVersion` with exact cases `1, 2, 3, 4`. Adding a version
   requires: (a) bump `CURRENT_SCHEMA_VERSION` in `types.ts`, (b) add a case in
   `codegen.ts`, (c) update the "supports versions 1, 2, 3, and 4; the data was
   left unchanged" message in `validatePersistedConnectionMetadata`.
2. **Connections are migrated in memory, rewritten only on save.** Older
   schemas (1–3) are read and migrated; the Figma document is updated only
   after the owner explicitly saves. Don't mutate shared plugin data outside
   the save path (unless it's a migration test).
3. **Namespace + key are load-bearing constants.** `CONNECTION_NAMESPACE =
   'tashil_storybook'`, `CONNECTION_KEY = 'connection'` (both in `types.ts`).
   The semantic adapter, layout resolver, and connection-health all read
   through `getSharedPluginData` with these. Don't hardcode the strings.
4. **`createUsageSnippet` is a byte-identical compatibility wrapper** over
   `createComponentUsage`. Keep them in lockstep — golden baselines depend on it.
5. **Source parsing is local and AST-only.** `parseSourceComponent` never
   persists uploaded source text — only the derived prop schema and a content
   hash. Preserve this on every edit.
6. **Message handlers are defined as typed pairs in `types.ts`** following the
   `@create-figma-plugin/utilities` `emit`/`on` pattern. Adding a new
   request/response pair means adding the handler type here and wiring both
   ends (`main.ts` + UI controller).
7. **`Object.create(null)` dictionaries everywhere user-supplied names are
   keys** (`mapping-document.ts`) — group/option names can collide with
   `__proto__`/`hasOwnProperty`. Don't switch to plain objects.

## Gotchas

- **Two hardcoded arrays of the tab union.** `workflowTab`'s type literal
  (`src/ui.tsx`) and the `tabs` array in `handleTabKeyDown` must stay in sync
  with `tabIds` (keyed by `typeof workflowTab`) **and** the rendered button
  `id=` attributes (focused via `document.getElementById`). Changing the tab
  set means touching the union, `tabs`, `tabIds`, and the button markup
  together. The type system catches the first two; the DOM ids are on you.
- **`semanticRecipe` presence routes generation.** `createConnectedOutput`
  (and the layout `createConnectedUsage`) branch on whether
  `metadata.semanticRecipe` is set. If set → semantic pipeline; else → legacy
  `createUsageSnippet` byte-for-byte. See the semantic section.
- **`createConnectedOutput` is called from two places in `main.ts`** (Dev Mode
  generate + Inspect). Keep them in parity — it's the single pipeline.
- **`DEFAULT_CHILDREN_TEXT_PROPERTY = 'label'`** (`types.ts`) is the default
  children-text prop name used during scaffolding.

## Where to make common changes

| Want | Change |
| --- | --- |
| Add a connection-metadata field | Add to `ConnectionMetadata`; decide if it's a schema bump (does it break older reads?). If yes, follow rule 1 above. |
| Add a new message pair | Add the handler type to `types.ts`; wire `emit`/`on` in `main.ts` and the UI controller. |
| Change visual mapping compilation | `mapping-editor.ts` `compileMappingDocument`; preserve advanced entries. |
| Add a drift kind | `ConnectionDriftKind` in `connection-health.ts`; surface it in the health UI. |

## Related docs

- [Connect a component](connect-component.md) · [Visual prop mappings](prop-mapping.md) · [Maintain a connection](maintain-connections.md)
- [Development guide](development.md) — setup, build, persisted-data policy
- [Section guide index](sections-index.md)
