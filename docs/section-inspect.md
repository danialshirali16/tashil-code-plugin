# Inspect — How It Works (Developer Guide)

Status: Active
Last updated: 2026-07-31
Companion: [user guide](inspect-frame.md) · [Section guide index](sections-index.md)

Inspect Code is the Dev-Mode-parity selected-layer CSS inspection. It takes the
CSS that Figma **already emitted** for the selected node (`getCSSAsync()`),
partitions it into Layout and Style buckets, and enumerates the connected
component instances in the subtree. It is deliberately distinct from the Layout
Composer (full-tree codegen) and from Sync Tokens (which *authors* CSS from
variables).

## At a glance

```text
inspectFrame(root, options)                         (inspect-frame.ts)
   │
   ├──► getNodeCss(node, context?)  ── node.getCSSAsync() → partition
   │        partitionCss(declarations) → { layout[], style[] }
   │        never throws; missing CSS → empty sections + css-unavailable diagnostic
   │
   └──► enumerate connected components in the subtree (stop at every INSTANCE boundary)
                │
                ▼
        FrameInspection  →  Layout block, Style block, ConnectedComponentEntry[], diagnostics
```

Inspect Code is surfaced two ways: the **Tashil UI** Dev Mode language (select a
connected instance → its usage snippet; select a frame → the inspection), and
the in-plugin **Inspect Code** screen (same data for teammates without a Dev
Mode seat).

## Module map

| File | Role |
| --- | --- |
| `src/inspect/inspect-frame.ts` | `inspectFrame(root, options)` — assembles the node's CSS + enumerates connected components into a `FrameInspection`. Never throws; stops at every INSTANCE/COMPONENT/COMPONENT_SET boundary. |
| `src/inspect/node-css.ts` | `getNodeCss(node, context?)` — wraps `node.getCSSAsync()` and partitions. Never throws; failing/missing CSS → empty sections + `css-unavailable`. Uses the context cache when supplied. |
| `src/inspect/css-partition.ts` | `partitionCss`, `isLayoutProperty`, `formatCssBlock`. One explicit `LAYOUT_PROPERTIES` set + `LAYOUT_PREFIXES` (`padding-`, `overflow-`, `grid-`). Unknown properties default to **Style**. Order within each bucket is preserved. |
| `src/inspect/usage-snippet.ts` | `formatUsageSnippet(usage)` (byte-identical to `createUsageSnippet`'s single-component output) and `formatConnectedComponentsSnippet`. Falls back to per-entry snippets if cross-entry aliasing would be required. |
| `src/inspect/types.ts` | Pure, Figma-free domain model: `FrameInspection`, `NodeCss` (`{ layout, style }`), `ConnectedComponentEntry`, `InspectionDiagnostic` / `InspectionDiagnosticReason`. |

## Rules an editor must keep

1. **Inspect consumes CSS Figma already emitted; it never authors CSS.** The
   values come straight from `getCSSAsync()` and pass through `node-css.ts`
   unmodified (modulo `normalizeCssValue`). Do not transform, rename, or
   reformat them here. (Authoring CSS from variables is Sync Tokens' job.)
2. **Never throw.** `inspectFrame` and `getNodeCss` return a controlled partial
   result on failure — empty CSS sections + a diagnostic — so one bad
   descendant never discards the rest. A `node-limit` budget yields a partial
   result too.
3. **Stop at every component boundary.** Traversal never visits the internals
   of an `INSTANCE`, `COMPONENT`, or `COMPONENT_SET`. Connected instances are
   enumerated as `ConnectedComponentEntry`; unconnected ones surface as a
   diagnostic. Hidden nodes (`visible === false`) are skipped.
4. **Unknown properties default to Style.** `css-partition.ts` uses an exact
   `LAYOUT_PROPERTIES` set plus `LAYOUT_PREFIXES`; anything unrecognized lands
   in the Style bucket. Declaration order within each bucket preserves
   `getCSSAsync()` emission order — don't sort.
5. **`formatUsageSnippet` must stay byte-identical** to `createUsageSnippet`'s
   single-component output (it's `renderImportLines(imports)` + blank line +
   `jsx`). The cross-entry path falls back to per-entry snippets rather than
   aliasing JSX.

## Gotchas

- **Three things look alike; they are not.** (a) **Inspect** reads CSS Figma
  emitted (`getCSSAsync`). (b) **Layout Composer** generates styled-components
  from a tree walk. (c) **Sync Tokens** authors CSS from Figma Variables.
  Different code paths — don't conflate them.
- **The `colors` token rewriting is Layout Composer's, not Inspect's.** Inspect
  shows Figma's CSS verbatim (partitioned). Only the Layout Composer rewrites
  `var(--…)` color tokens to `colors.namespace.name`.
- **Path comments default to on.** The Dev Mode "Layer path comments" preference
  (`pathComments`) shows comments unless explicitly `'hide'`. The source comment
  format is `//./ <layer path inside selection joined by ' / '>` (the root's own
  name is dropped).

## Where to make common changes

| Want | Change |
| --- | --- |
| Move a property between Layout/Style buckets | `LAYOUT_PROPERTIES` / `LAYOUT_PREFIXES` in `css-partition.ts`. |
| Add a new inspection diagnostic reason | Add to `InspectionDiagnosticReason` in `types.ts` and emit it from `inspect-frame.ts`; bucket it in the UI. |
| Change the connected-component enumeration | `inspect-frame.ts` — but keep the INSTANCE-boundary stop. |

## Related docs

- [Generate and inspect a frame](inspect-frame.md) — user guide
- [Section guide index](sections-index.md) · [Development guide](development.md)
