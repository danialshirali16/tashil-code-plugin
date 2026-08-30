# Figma Editor Modes — Design vs Dev Mode (Developer Guide)

Status: Active
Last updated: 2026-07-31
See also: [Section guide index](sections-index.md)

Tashil Code is one plugin registered for **both** Figma editor surfaces.
`manifest.json` (generated from the `figma-plugin` field in `package.json`)
declares:

```json
"editorType": ["figma", "dev"],
"capabilities": ["codegen"],
"codegenLanguages": [{ "label": "Tashil UI", "value": "tashil-ui" }]
```

- **`figma`** — the **Design mode** editor (the regular Figma canvas).
- **`dev`** — **Dev Mode** (the inspect/code panel on the right).

The two surfaces run **different code paths inside `src/main.ts`**, gated by
`figma.mode`. Knowing which surface a change affects is the difference between
"works in Dev Mode, invisible in Design mode" and vice versa.

## The hard boundary in `src/main.ts`

```text
src/main.ts
│
├── figma.codegen.on('generate', …)          ← top level, runs in BOTH modes
│       (registered at module load; Dev Mode is what actually triggers it)
│
└── export default function () {             ← the UI/message layer
        if (figma.mode !== 'default') return;   ← HARD GATE (main.ts:117)
        showUI({ width: 560, height: 680 });
        on<SaveConnectionHandler>(…)
        on<ClearConnectionHandler>(…)
        on<RefreshSelectionHandler>(…)
        on<ScanComponentsHandler>(…)
        on<ScaffoldPropMappingsHandler>(…)
        on<LoadTokenCollectionsHandler>(…)
        on<ExportTokensHandler>(…)
        on<PreviewTokensHandler>(…)
        on<OpenExternalHandler>(…)
        on<ResizeWindowHandler>(…)
        on<CloseHandler>(…)
        figma.on('selectionchange', …)
    }
```

- In **Dev Mode**, `figma.mode !== 'default'`, so the default export returns
  early. **No UI window opens, no message handlers register.** Only the
  `figma.codegen.on('generate')` handler is live — Dev Mode calls it when the
  user selects a node and picks the **Tashil UI** language.
- In **Design mode**, `figma.mode === 'default'`, so the UI layer boots: the
  "Connect component" menu opens the plugin window, all the `on<…Handler>`
  message pairs register, and `selectionchange` drives the live selection
  state. The window opens at a compact default size of 560×680px and may still
  be resized later through the existing `RESIZE_WINDOW` message contract.

**This gate is load-bearing.** An agent that adds a message handler *outside*
the default export, or moves codegen logic *inside* it, will silently break one
surface. The `if (figma.mode !== 'default') return;` at `main.ts:117` is the
single source of truth for "which surface am I in."

## What each surface does

### Design mode (`figma`) — authoring
Opened via the **Connect component** menu (`figma-plugin.menu`). The plugin
window (`src/ui.tsx`) is where design-system owners:

- upload source `.ts`/`.tsx`, scaffold and visually edit prop mappings
  ([core-connect section](section-core-connect.md)),
- author semantic recipes ([semantic section](section-semantic.md)),
- run **Inspect Code** — the in-plugin preview of what Dev Mode would generate,
  for teammates without a Dev Mode seat ([inspect section](section-inspect.md)),
- export Figma Variables to CSS via **Sync Tokens** ([sync-tokens section](section-sync-tokens.md)).

All connection persistence (`setSharedPluginData` under `tashil_storybook`) and
all mutation messages (`SAVE_CONNECTION`, `CLEAR_CONNECTION`,
`SCAFFOLD_PROP_MAPPINGS`, `EXPORT_TOKENS`, …) happen here.

### Dev Mode (`dev`) — consumption
No plugin window. The user selects a node and chooses **Tashil UI** in the Code
section; Figma invokes `figma.codegen.on('generate', …)` →
`generateCodegenBlocks(node)` → `CodegenBlock[]`.

Dev Mode reads connections and emits clean, non-redundant blocks based on the exact selection category:

```text
FRAME / CONTAINER
├── Generated Code
├── Layout
└── Style

CONNECTED COMPONENT
├── Generated Code
├── References
├── Layout
├── Style
└── Notes

NOT CONNECTED COMPONENT
├── ⚠️ This component isn't connected to code.
├── Variant logic
├── Layout
└── Style

PRIMITIVE / VECTOR
├── Layout
└── Style

TEXT
├── Content
├── Layout
└── Style
```

- **Frame / Container**: Generates the complete React layout module (`Generated Code`), followed by the container's `Layout` and `Style` CSS. For large frames (> 150 layers), Dev Mode fast pre-flight skips full React TSX layout generation to prevent UI thread freezing, emitting a tip in `Generated Code` while instantly displaying the container's root `Layout` and `Style` CSS.
- **Connected Component**: Generates the production usage snippet (`Generated Code`), `References` (Storybook / source repository links), instance `Layout` & `Style` CSS, and a consolidated `Notes` block (deprecations, runtime requirements, diagnostics).
- **Not Connected Component**: Emits an actionable guidance block (`⚠️ This component isn't connected to code.`), typed `Variant logic` (if a component set has variants), and layer `Layout` & `Style` CSS.
- **Primitive / Vector**: Emits pure `Layout` and `Style` CSS without clutter.
- **Text**: Emits raw `Content` followed by `Layout` and `Style` CSS.

The codegen handler loads per-user output preferences from `clientStorage` and
formats TypeScript blocks only. The same formatter is applied to Design-mode
Inspect output; CSS inspection remains verbatim.

## Inspect Code is the parity bridge

Inspect Code exists *because* of this split: it runs the **same**
`createConnectedOutput` pipeline in Design mode so non-Dev-Mode teammates see
what Dev Mode would emit. Output parity between the Dev Mode codegen handler
and the in-plugin Inspect Code is a **test invariant** — they share one
pipeline (`createConnectedOutput` at `main.ts:347`). If you change generation,
both surfaces must follow. (See [global rule 5](sections-index.md#5-one-generation-pipeline-three-surfaces).)

## Dev Mode-only runtime APIs

Some Figma APIs exist **only** in the Dev Mode runtime and must be guarded when
the code path can also be reached from Design mode:

- **`figma.codegen.preferences`** — holds the "Layer path comments"
  (`pathComments`) codegen preference. Read at `main.ts:428` with an explicit
  guard comment: it "only exists in the Dev Mode runtime." The read is gated so
  it does not throw in Design mode. `pathComments` controls whether the
  `//./ <layer path>` source comments are emitted.
- **`figma.codegen` itself** — only meaningful in Dev Mode; the `generate`
  event fires there.

If you add a codegen-preference read, mirror the existing guard — never assume
`figma.codegen.preferences` is present.

## Quick reference: which surface does this file serve?

| File / symbol | Design mode | Dev Mode |
| --- | :---: | :---: |
| `src/main.ts` default export (`showUI`, `on<…Handler>`, `selectionchange`) | ✅ | ❌ (returns early) |
| `src/main.ts` `figma.codegen.on('generate')` + `generateCodegenBlocks` | ❌ | ✅ |
| `createConnectedOutput` (`main.ts:347`) | ✅ (Inspect Code) | ✅ |
| `src/ui.tsx`, `src/ui-controller.ts`, `src/ui-state.ts` | ✅ | ❌ |
| `src/codegen.ts`, `src/semantic/`, `src/layout/`, `src/inspect/`, `src/sync-tokens/` (pure cores) | ✅ | ✅ (via codegen) |
| `figma.codegen.preferences` (`pathComments`) | ❌ (guarded) | ✅ |

## Rules an editor must keep

1. **Respect the `figma.mode` gate.** Message handlers and UI wiring belong
   inside the default export; codegen logic belongs at module top level. Don't
   cross them.
2. **`createConnectedOutput` is shared.** Changing it changes both Dev Mode
   output and Inspect Code output — keep them in parity.
3. **Guard Dev Mode-only APIs.** `figma.codegen.preferences` (and anything on
   `figma.codegen` beyond the `generate` registration) must be read
   defensively; they are absent in Design mode.
4. **Dev Mode never mutates.** Connection authoring/persistence is a
   Design-mode concern. Dev Mode only reads and generates.
5. **Keep the Design-mode opening size compact.** The default plugin window is
   560×680px. User-initiated resizing continues through `RESIZE_WINDOW`; do not
   use the opening dimensions as a fixed size constraint.

## Related docs

- [Section guide index](sections-index.md) — the global rules and the five-section map
- [Development guide](development.md) — build, manifest regeneration, persisted data
