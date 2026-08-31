# Section Guide for Engineers and Agents

Status: Active
Last updated: 2026-07-31

Tashil Code is a single Figma Dev Mode plugin (`@create-figma-plugin/build`,
TypeScript + Preact). The source under `src/` splits into **five bounded
sections**. Each section has its own developer guide below; read the one for the
area you are changing before you edit it. The guides are scoped so two people
(or two agents) working in different sections read different files and will not
step on each other.

If you only read one thing, read **Global rules** below — those apply across
every section. If you are unsure which Figma surface (Design mode vs Dev Mode)
your change affects, read [Figma Editor Modes](section-editor-modes.md) first —
the `figma.mode` gate in `src/main.ts` decides which code path runs.

## The six sections

| Section | Responsibility | Entry points | Read first | One rule you will break |
| --- | --- | --- | --- | --- |
| **Core connect / codegen** | The connect-component pipeline: modular plugin backend (`src/main/`), tabbed UI views (`src/views/`), source parsing, visual mapping authoring, legacy codegen, drift detection, shared types. | `src/main.ts`, `src/main/*.ts`, `src/ui.tsx`, `src/views/*.tsx`, `src/codegen.ts`, `src/types.ts` | [section-core-connect.md](section-core-connect.md) | `CURRENT_SCHEMA_VERSION` lives in `src/types.ts`, but the migration `switch` and the "supports versions…" message live in `src/codegen.ts`. Bump all three together. |
| **Inspect** (`src/inspect/`) | Dev-Mode-parity selected-layer CSS inspection: partition `getCSSAsync()` into Layout/Style buckets and enumerate connected components. | `src/inspect/inspect-frame.ts` | [section-inspect.md](section-inspect.md) | This consumes CSS Figma **already emitted**. Do not confuse it with Sync Tokens, which **authors** CSS from variables. Different code paths. |
| **Layout** (`src/layout/`) | Full-tree styled-components React codegen: traverse a selected frame/group/section/text, emit one `.tsx` module with connected components as atomic usages. | `src/layout/react-layout.ts`, `src/layout/figma-layout-extractor.ts` | [section-layout.md](section-layout.md) | Connected instances are **never** expanded into internals. The one exception is an *unconnected* instance with visible children — expanded with a diagnostic. |
| **Semantic** (`src/semantic/`) | Recipe-based connect for components whose Figma structure does not match source: schema, resolver, authoring, reconcile, source contract, figma extraction. | `src/semantic/resolver.ts`, `src/semantic/types.ts` | [section-semantic.md](section-semantic.md) | Every module here is pure and Figma-free **except** `figma-adapter.ts`. Don't import `@figma/plugin-typings` anywhere else in this folder. |
| **Sync Tokens** (`src/sync-tokens/`) | Serialize Figma Variable collections to CSS, JSON, Tailwind, Markdown, and Nested TypeScript: pure core; `src/main/token-adapter.ts` is the Figma adapter. | `src/sync-tokens/serialize.ts`, `src/main/token-adapter.ts` | [section-sync-tokens.md](section-sync-tokens.md) | The Figma Variables API is touched **only** in `src/main/token-adapter.ts`. The pure core in `src/sync-tokens/` must stay free of `@figma/plugin-typings` so the test project compiles it. |
| **Documentation** (`src/documentation/`) | Automated documentation generation and in-place reconciler for tokens, component specifications, and design system frames. | `src/documentation/token-doc-model.ts`, `src/documentation/figma-canvas-writer.ts` | [section-documentation.md](section-documentation.md) | Generated frames are stamped with `tashil_doc_meta` and reconciled in-place rather than recreated from scratch. |

## Global rules (apply everywhere)

These are the project-wide invariants. Violating any of them breaks the build,
CI, or another section.

### 1. `manifest.json` is generated, never hand-edited

`npm run build` regenerates `manifest.json` from the `figma-plugin` field in
`package.json`. To change the plugin name, menu, or capabilities, edit that
field and rebuild. CI runs `git diff --exit-code` after building, so a rebuilt
`manifest.json` that isn't committed fails CI. Always commit the regenerated
`manifest.json` alongside the `package.json` change.

### 2. Four tsconfig contexts — put new files in the right one

`npm run typecheck` runs four configs: `tsconfig.json` (main thread, has
`@figma/plugin-typings`), `tsconfig.ui.json` (UI/views), `tsconfig.tests.json`
(unit tests, **no** Figma typings), `tsconfig.plugin-tests.json`. The pure
feature cores (`src/sync-tokens/`, `src/semantic/` except `figma-adapter.ts`,
`src/layout/` IR, `src/inspect/`) compile under the test project, which has no
Figma typings — that is exactly why they must stay pure.

- New backend file → add to `tsconfig.json` `include`.
- New UI/view file → `tsconfig.ui.json`.
- New test → `tsconfig.tests.json`.

### 3. The deprecated sync Figma APIs throw under `dynamic-page`

`manifest.json` sets `documentAccess: "dynamic-page"`. The deprecated **sync**
Variables API (`getLocalVariableCollections()`, `getVariableById()`,
`getMainComponent()`, etc.) **throws** at runtime. Always use the `*Async`
variants: `getLocalVariableCollectionsAsync()`, `getVariableByIdAsync()`,
`getMainComponentAsync()`, `getCSSAsync()`.

### 4. Pure cores are Figma-free

Every section keeps a pure, Figma-typings-free core so it is unit-testable
without the Figma runtime. The Figma API is reached only through a thin adapter
in `src/main/` (and `src/semantic/figma-adapter.ts` for the semantic tree,
`src/layout/figma-layout-extractor.ts` + `figma-component-resolver.ts` for the
layout tree). Do not import `@figma/plugin-typings` types into the pure cores.

### 5. One generation pipeline, three surfaces

Dev Mode, Inspect Code, and Layout Composer all resolve a connection through
the same code path (`createConnectedOutput` in `src/main/codegen-adapter.ts`,
`createConnectedUsage` in `src/layout/figma-component-resolver.ts`). Output
parity across the three surfaces is a **test invariant**, not a convention. If
you change resolution in one place, the others must follow.

### 6. Connected instances are atomic

No traversal — inspect or layout — ever visits the internal layers of a
**connected** instance. The instance becomes one production component usage and
the walk stops at that boundary. The only exception is an *unconnected*
instance with visible children in the layout composer, which is expanded into a
container **with** a diagnostic.

### 7. Connections are persisted shared plugin data

Connections are stored via `setSharedPluginData` under namespace
`tashil_storybook`, key `connection`, with `schemaVersion: 4`. Older schemas
(1–3) are read and migrated **in memory**; the document is rewritten only on an
explicit save. See [Persisted data and compatibility](development.md#persisted-data-and-compatibility).

### 8. Documentation changes ship with the code

When a user-facing behavior changes, update the matching guide in the same
change. The full list is in [Development guide → Documentation changes](development.md#documentation-changes).
These section guides are part of that list now — if you change a module's
public behavior, boundary, or invariants, update its `section-*.md`.

## How the sections fit together

```text
                         ┌─────────────────────────────────────────────┐
                         │  Core connect / codegen                     │
                         │  src/main/ · src/views/ · src/components/   │
                         │  ui-controller.ts · ui-state.ts             │
                         │  source-schema · mapping-* · prop-mappings  │
                         │  connection-health.ts                       │
                         └───────────────┬─────────────────────────────┘
                                         │  ConnectionMetadata (schema v4)
              ┌──────────────────────────┼──────────────────────────┬──────────────────────────┐
              ▼                          ▼                          ▼                          ▼
   ┌─────────────────────┐   ┌─────────────────────┐   ┌─────────────────────┐   ┌───────────────────────────┐
   │ Inspect (src/inspect)│   │ Layout (src/layout)  │   │Semantic(src/semantic)│   │Documentation(src/documen.)│
   │ selected-layer CSS   │   │ full-tree codegen    │   │ recipe-based connect │   │ canvas specifications &   │
   │ getCSSAsync() →      │   │ frame/group/section  │   │ schema·resolver·     │   │ in-place token & component│
   │ Layout/Style buckets │   │ → one .tsx module    │   │ authoring·reconcile  │   │ reconciliation            │
   └─────────────────────┘   └──────────┬──────────┘   └──────────┬──────────┘   └─────────────┬─────────────┘
                                        │                         │                            │
                                        └────────────┬────────────┘                            │
                                                     ▼                                         │
                                  ┌──────────────────────────────┐                             │
                                  │ Sync Tokens (src/sync-tokens) │◄────────────────────────────┘
                                  │ Figma Variables → CSS/JSON     │  reads shared collection data
                                  │ (pure core; main.ts adapts)    │
                                  └──────────────────────────────┘
```

- **Core** owns connection persistence, the UI, source parsing, visual mapping,
  legacy codegen, and the shared message types every other section uses.
- **Inspect**, **Layout**, and **Semantic** are the three generation surfaces;
  they share the connection model and (for Semantic) feed back into Layout via
  `resolveSemanticUsage`.
- **Sync Tokens** reads the Figma Variables API and serializes tokens into CSS,
  JSON, Tailwind, Markdown, and Nested TypeScript formats.
- **Documentation** turns Figma Variable Collections and connected components into
  pixel-accurate canvas specifications using the Swiss Army Knife design system,
  supporting real-time in-place reconciliation when variables or component APIs evolve.

## Related documentation

- [Figma Editor Modes — Design vs Dev Mode](section-editor-modes.md) — the
  `figma.mode` gate, which surface each code path serves, and Dev Mode-only
  runtime APIs.
- [Development guide](development.md) — setup, build, project structure, test commands.
- [Project brief](project-brief.md) — product scope and the runtime flow.
- Per-feature depth docs (cited from each section guide):
  - [Token Documentation — How It Works (Architecture & Reconciliation)](token-documentation-architecture.md) · [user guide](token-documentation.md)
  - [Sync Tokens — How It Works](sync-tokens-architecture.md)
  - [Layout Composer decisions](layout-composer-decisions.md) ·
    [archived roadmap](archive/layout-composer-roadmap.md)
  - [Semantic Connect decisions](semantic-connect-decisions.md) ·
    [archived roadmap](archive/semantic-connect-roadmap.md) · [user guide](semantic-connect.md)
  - [Generate and inspect a frame](inspect-frame.md)
  - [Connect a component](connect-component.md) ·
    [Visual prop mappings](prop-mapping.md) ·
    [Maintain a connection](maintain-connections.md)
