# Layout Composer — How It Works (Developer Guide)

Status: Active
Last updated: 2026-07-31
Companion: [decisions](layout-composer-decisions.md) (supported-node matrix) · [archived roadmap](archive/layout-composer-roadmap.md) · [user guide](inspect-frame.md)

The Layout Composer generates one complete styled-components `.tsx` module for
a selected frame, group, section, or text layer — including its visible inner
layout layers and connected Tashil components. It is the **Tashil UI** language
in Dev Mode and the **Inspect Code** screen in the plugin.

## At a glance

```text
generateReactLayout(node)                          (react-layout.ts)
   │
   ├──► extractLayout(root, options)  ── Phase 2: walk Figma tree → LayoutDocument IR
   │        fresh GenerationContext per request (4 caches + traversal/concurrency limits)
   │        connected instances resolved via figma-component-resolver → atomic ComponentUsage
   │
   └──► generateLayout(document)      ── Phase 1 (pure): LayoutDocument IR → GeneratedLayout
            renderTsx(document) → { componentName, tsx }
            styled-components CSS, imports, variant logic, runtime requirements, fidelity
```

Two phases, kept separate on purpose: **Phase 1** (the IR + emitters) is
Figma-free and unit-testable; **Phase 2** (the extractor + resolver) is the
only place that touches Figma types.

## Module map

| File | Role |
| --- | --- |
| `src/layout/react-layout.ts` | Thin public entry: `generateReactLayout(node)` = `extractLayout` then `generateLayout`. `supportsReactLayout(node)` gates root types. |
| `src/layout/figma-layout-extractor.ts` | **Phase 2.** `extractLayout` walks the Figma tree → `LayoutDocument` IR. Hidden layers skipped; `SECTION` → `<section>`; `GRID` → warning + document order; structural tokens via `formatTokenName` (kebab). |
| `src/layout/figma-component-resolver.ts` | The only bridge between a connected INSTANCE and its production `ComponentUsage`. `resolveInstance` never throws, never visits internals. Routes to `createConnectedUsage` (semantic) or `createComponentUsage` (legacy). |
| `src/layout/generate-layout.ts` | **Phase 1 orchestrator.** `generateLayout` → `GeneratedLayout`; counts nodes, collects runtime requirements, summarizes fidelity. |
| `src/layout/tsx-emitter.ts` | `renderTsx(document)` — emits the full module: imports header, styled block, `export function componentName()`. Import-alias collision rules. |
| `src/layout/styled-components-emitter.ts` | `createStyledRegistry`, `renderStyledDefinitions`. Detects color tokens and rewrites `var(--…)` on color properties to `colors.namespace.name`. |
| `src/layout/variant-logic.ts` | `generateVariantLogic` for a `COMPONENT_SET`: emits `VariantProps` type, `VariantDefaults`, `VariantMatrix`, and a `resolve…Variant(input)` resolver. |
| `src/layout/generation-context.ts` | `GenerationContext` (per-request caches) + `GenerationTraversal` (node budget) + `mapWithConcurrency` (worker-pool limiter). |
| `src/layout/naming.ts` | `toComponentName` (PascalCase), `toClassName` (kebab), `resolveClassNames` (collision-free). Pure and total. |
| `src/layout/imports.ts` | `renderImportLines` / `collectByPath` — pure import dedup + aliasing. (Note: `tsx-emitter.ts` has its own importer; this one serves other call sites.) |
| `src/layout/types.ts` | Figma-free layout IR: `CompositionNode` union (`asset \| component \| container \| shape \| text \| placeholder`), `LayoutDiagnosticReason`. |
| `src/layout/fixtures.ts` | Test fixtures (Figma-like node shapes) for the snapshot tests. |

## Rules an editor must keep

1. **Connected instances are atomic.** `figma-component-resolver.ts` never
   visits a connected instance's internal layers — it returns one
   `ComponentCompositionNode`. This is roadmap M4's invariant. The **one
   exception**: an *unconnected* instance with visible children is expanded
   into a container **with** an `unconnected-instance` diagnostic
   (`figma-layout-extractor.ts` `resolveInstanceNode`). Read the comment there
   before touching it.
2. **One `GenerationContext` per request, never global.** It caches four
   things: `mainComponentCache` (`getMainComponentAsync` by instance id),
   `connectionCache` (parsed `ConnectionReadResult` by connection-target id),
   `cssCache` (`getCSSAsync` per node id, promise-cached),
   `variableCache` (`getVariableByIdAsync` per variable id). Invalidation is
   discard-on-return — do not hoist a context across requests.
3. **Traversal and concurrency are bounded.** Defaults: `maxDepth = 64`,
   `maxNodes = 500`, `maxConcurrency = 8` (clamped ≥ 1). Depth is checked in
   `resolveContainer` (root is depth 0); node count by
   `GenerationTraversal.visit()` returning `false`. On limit, emit a
   `depth-limit` / `node-limit` diagnostic and stop — never throw.
4. **Detected-but-not-generated cases must emit a placeholder + diagnostic,
   never silently omit.** `PlaceholderCompositionNode` ("never silently
   omitted") carries a `reason: LayoutDiagnosticReason`. Placeholder causes
   include `unsupported-node`, `unsupported-root`, `unsupported-paint`,
   `missing-main-component`, `unconnected-instance`, `invalid-connection`,
   `node-limit`, `depth-limit`, `css-unavailable`, `root-fixed-size-omitted`.
   The emitter renders it as a sanitized JSX comment.
5. **`formatTokenName('kebab')` is the shared CSS-variable naming contract.**
   `figma-layout-extractor.ts` imports it from `../sync-tokens/serialize` to
   build `--<name>`. Keep this in sync with Sync Tokens so generated variable
   names match across the two features.
6. **Color tokens become `colors.namespace.name`.** `styled-components-emitter.ts`
   detects `var(--…)` on color properties (fixed `COLOR_PROPERTIES` set) where
   the token's first path segment is in `COLOR_TOKEN_NAMESPACES`, and rewrites
   it to member access on the `colors` import. This gates the `colors` import
   in `tsx-emitter.ts`.
7. **`COMPONENT_LIBRARY_PATH = '@tashilcar/swiss-army-knife'`** is the single
   normalized import specifier for connected components.

## Gotchas

- **Two import collectors exist.** `tsx-emitter.ts` has its own
  `collectImports`/`createImportAliases`/`renderComponentImport` for the layout
  module; `imports.ts`'s `renderImportLines`/`collectByPath` serve other call
  sites (including `inspect/usage-snippet.ts` and the semantic resolver). Don't
  assume changing one changes the other.
- **Component-name collisions are suffixed `Layout`.** If the generated base
  component name collides with an imported name, it becomes `<Name>Layout`.
  Import-name collisions become `SwissArmy${Name}`, then `SwissArmy${Name}2`, …
- **Import line order is insertion order, not sorted** — preserves legacy
  single-usage golden baselines. Names within a line dedup by `localName`.
- **`layoutMode: 'GRID'`** triggers a `grid-layout` warning and emits children
  in document order; it is not reconstructed as CSS grid.
- **Absolute children force `position: relative`** on the parent container
  (`styled-components-emitter.ts`). `width`/`height`/`flex-grow` are dropped on
  cross-axis fill to avoid conflicts (`suppressedProperties`).
- **`createConnectedUsage` returns `result.usage` only** — Layout Composer
  never sees the semantic resolver's explanations/runtimeRequirements for a
  nested connected component. Those surface only at the top level.

## Where to make common changes

| Want | Change |
| --- | --- |
| Support a new node type | Add to the supported-node matrix in [decisions](layout-composer-decisions.md), then handle it in `figma-layout-extractor.ts` (`traverseChild`/`traverseRoot`) and add a `LayoutDiagnosticReason` if it's a detected-but-not-generated case. |
| Change a traversal limit | `generation-context.ts` defaults (`DEFAULT_MAX_DEPTH`, `DEFAULT_MAX_NODES`, concurrency). |
| Add a new placeholder cause | Add to `LayoutDiagnosticReason` in `types.ts`, emit it from the extractor/resolver, and add it to the right bucket in `generate-layout.ts`'s `summarizeFidelity`. |
| Change CSS-variable naming | You're changing `formatTokenName` in `src/sync-tokens/serialize.ts` — Sync Tokens and the snapshot tests move with you. |

## Related docs

- [Layout Composer decisions](layout-composer-decisions.md) — the supported-node matrix (the canonical reference for what's generated vs. placeholdered)
- [Layout Composer archived roadmap](archive/layout-composer-roadmap.md)
- [Generate and inspect a frame](inspect-frame.md) — user guide
- [Section guide index](sections-index.md) · [Development guide](development.md)
