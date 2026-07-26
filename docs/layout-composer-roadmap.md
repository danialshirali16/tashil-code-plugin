# Frame Inspection Roadmap

> **Superseded direction (2026-07-26):** ADR E restores full selected-tree
> React/TSX and CSS Module generation alongside Dev Mode CSS inspection. This
> file retains the earlier inspection-pivot checklist as decision history.

Status: Development complete (Phase A–H) — manual user verification (Design mode, library components, keyboard layout) and release decision remain.  
Last updated: 2026-07-24 (commit f604703)  
Decisions record: [`layout-composer-decisions.md`](layout-composer-decisions.md)

## The pivot, in one paragraph

The previous roadmap (Phases 0–5, complete in `src/layout/`) generated full
React/TSX plus CSS Modules for a selected frame tree. That approach
over-commits the developer: generated wrappers, invented class names, and
scaffolded files fight the conventions of whichever codebase they land in, and
the tree-shaped generation carried the project's largest hardening burden
(naming collisions, import aliasing, placeholders, node limits, fuzzing).
Version 1 now behaves like Figma's own Dev Mode instead: selecting a node
shows a **Layout** CSS section, a **Style** CSS section, and the **Connected
component** information — nothing more. The developer keeps full control of
their own markup and files; the plugin supplies the values, tokens, and
component usages they actually copy.

## Objective

When a user selects any single node, both surfaces present:

1. **Layout** — the node's structural CSS (flex, gap, padding, sizing,
   alignment), shown as plain CSS declarations.
2. **Style** — the node's visual CSS (background, border, radius, shadow,
   typography, opacity), shown as plain CSS declarations.
3. **Connected component** — for a connected instance, the existing Tashil
   usage snippet (unchanged); for a frame, the connected component instances
   it contains.

Both surfaces must stay in lockstep:

1. **Figma Dev Mode** through `figma.codegen.on("generate")`.
2. **Tashil Code → Inspect Code** inside the plugin UI.

The differentiated value over Figma's native inspect panel:

- **Inspect Code works in Design mode** — teammates without a Dev Mode seat
  get Dev-Mode-like CSS inspection through the plugin.
- **One combined view** — CSS and the connected Tashil component snippet
  appear together instead of in separate panels.
- **Token-aware output** — variable-backed values surface as
  `var(--token, fallback)`, matching the design system rather than raw pixels.

## Product decisions

- [ ] Inspect the **selected node only**. No subtree code generation.
- [ ] Output plain CSS declarations, not CSS Modules, class names, or TSX
  scaffolding for frames.
- [ ] Use `node.getCSSAsync()` as the source of truth for CSS, partitioned
  into Layout and Style buckets. Do not rebuild Figma's CSS serializer.
- [ ] Preserve Figma variable output (`var(--spacer-3, 1rem)`) exactly as
  `getCSSAsync()` emits it.
- [ ] Connected component snippet output remains byte-for-byte backwards
  compatible; CSS sections are additive.
- [ ] Any single selected `SceneNode` is inspectable — frames, groups,
  sections, text, vectors, rectangles. "Unsupported root" ceases to exist as
  a concept; every node has CSS.
- [ ] For frames, enumerate connected component instances in the subtree,
  stopping at every instance boundary (instances stay atomic).
- [ ] Generation stays read-only: no canvas mutations, no persisted data, no
  network access.
- [ ] Retire the tree codegen path (TSX emitter, CSS Modules emitter, import
  aliasing, class naming) from the product; keep the pure modules in git
  history only.

## Non-goals

- Generating TSX, JSX wrappers, or files for frames or layouts.
- Editing, reformatting, or "improving" the CSS `getCSSAsync()` returns,
  beyond partitioning and deterministic ordering.
- Re-implementing Figma's CSS serialization (except the documented fallback).
- Responsive breakpoints, semantic element inference, or asset export.
- Persisting anything new on the Figma document.

## What survives from the layout composer

| Existing module | Fate | Reason |
| --- | --- | --- |
| `src/codegen.ts` (`createComponentUsage`, `createUsageSnippet`) | **Keep, unchanged** | Connected-component snippet is the product core |
| `src/layout/figma-component-resolver.ts` | **Keep** | Resolves connected/unconnected/broken instances; reused by the frame summary |
| `src/layout/generation-context.ts` | **Keep** | Per-generation caches and limits for the frame summary traversal |
| `src/layout/figma-layout-extractor.ts` | **Trim** | Traversal + instance-boundary rules reused to *enumerate* connected instances; container/text/placeholder IR construction removed |
| `src/layout/types.ts` | **Trim** | `ComponentUsage`, `ComponentImport`, diagnostics survive; composition-node IR and `GeneratedLayout` are replaced |
| `src/layout/tsx-emitter.ts` | **Retire** | No TSX is generated for frames |
| `src/layout/css-module-emitter.ts` | **Retire** (see fallback note in Phase B) | `getCSSAsync()` replaces it |
| `src/layout/imports.ts` | **Retire** | Snippets are independent; no cross-tree import dedup |
| `src/layout/naming.ts` | **Retire** | No generated class names |
| `docs/layout-composer-preview.html` | **Archive** | Previewed the retired codegen UI |

The uncommitted Phase 4–6 wiring (layout blocks in `src/main.ts`, the
`LayoutInspectView` in `src/ui.tsx`, `phase6.test.ts`) is superseded. Salvage
the UI scaffolding — section cards, copy buttons, diagnostics list, a11y
patterns — for the new inspection view; drop the TSX/CSS tab content and the
tree-generation tests.

## Target domain model

A small, serializable inspection result replaces `GeneratedLayout`:

```ts
export type CssDeclaration = {
  property: string;
  value: string;
};

export type NodeCss = {
  layout: CssDeclaration[];
  style: CssDeclaration[];
};

export type ConnectedComponentEntry = {
  nodeId: string;
  layerPath: string[];
  componentName: string;
  usage: ComponentUsage; // existing type: imports + jsx + diagnostics
};

export type FrameInspection = {
  nodeName: string;
  nodeType: string;
  css: NodeCss;
  connectedComponents: ConnectedComponentEntry[];
  diagnostics: InspectionDiagnostic[];
};
```

Boundary rules (unchanged in spirit from the composer):

- Figma node types are touched only in the extraction layer.
- The result contains serializable values only.
- Dev Mode and Inspect Code consume the **same** `FrameInspection`.

Diagnostic reasons shrink to what inspection can actually encounter:

```ts
type InspectionDiagnosticReason =
  | 'unconnected-instance'
  | 'invalid-connection'
  | 'missing-main-component'
  | 'css-unavailable'      // getCSSAsync threw or is not available
  | 'node-limit';          // frame summary traversal truncated
```

## Layout / Style partition

`getCSSAsync()` returns one flat declaration map. Partition it with an
explicit, tested property table — no scattered conditionals:

**Layout bucket** (exact-match or prefix):

```text
display, flex-direction, flex-wrap, flex-flow, flex, flex-grow, flex-shrink,
flex-basis, gap, row-gap, column-gap, justify-content, align-items,
align-self, align-content, padding, padding-*, width, height, min-width,
min-height, max-width, max-height, position, top, right, bottom, left,
overflow, overflow-*, box-sizing, grid, grid-*
```

**Style bucket**: every other property (background, border, border-radius,
box-shadow, opacity, color, font-*, line-height, letter-spacing, text-*,
fill, stroke, backdrop-filter, mix-blend-mode, …). Unknown or future
properties default to Style — the safe bucket, matching Figma's own panel.

Ordering: preserve `getCSSAsync()`'s emission order within each bucket so the
plugin's sections read identically to the native Dev Mode panel.

## Required invariants

- Connected component snippet output remains backwards compatible.
- Instance internals are never traversed or emitted.
- Dev Mode and Inspect Code render the same `FrameInspection`.
- Generation is read-only.
- Output ordering and diagnostics are deterministic across repeated calls.
- A failure on one connected descendant never discards the CSS sections or
  the other descendants.
- CSS text is passed through, never reformatted (beyond `property: value;`
  line assembly and the bucket split).

## Phase A — Spike and contract

- [ ] Verify `getCSSAsync()` availability and output in **both** runtimes:
  Dev Mode codegen and the Design-mode plugin (Inspect Code). Record exact
  behavior per node type (frame, group, section, text, instance, vector).
- [ ] Verify variable-backed values emit as `var(--name, fallback)` and
  under which file/library conditions. _(Verified in Dev Mode 2026-07-24:
  `var(--spacer-2, 0.5rem)` etc.; a variable without a resolvable fallback
  emits its raw name, passed through as-is.)_
- [ ] Capture fixture outputs from a real file for: auto-layout frame,
  non-auto-layout frame, group, text, connected instance, vector.
- [ ] Decide the fallback policy if `getCSSAsync()` is unavailable in the
  Design-mode runtime: either (a) reuse the retired `LayoutStyle` mapping as
  a Layout-only fallback with a `css-unavailable` diagnostic for Style, or
  (b) show Inspect Code CSS only when available. Record the decision.
- [ ] Add ADR **D — Dev-Mode-parity pivot** to
  `layout-composer-decisions.md`: why tree codegen was retired, what
  survives, and the `getCSSAsync()` source-of-truth decision.

Exit criteria: the API's real behavior in both runtimes is documented with
fixtures, and the fallback decision is recorded before any code moves.

## Phase B — CSS inspection service

Suggested files:

```text
src/inspect/types.ts
src/inspect/css-partition.ts
src/inspect/node-css.ts
src/inspect/*.test.ts
```

- [ ] Implement `partitionCss(declarations)` with the documented table;
  unit-test every listed property plus the unknown-property default.
- [ ] Implement `getNodeCss(node)` wrapping `getCSSAsync()`: deterministic
  declaration assembly, bucket split, `css-unavailable` diagnostic on
  failure, never throws.
- [ ] Render buckets as copy-ready CSS text (`property: value;` per line,
  matching the native panel).
- [ ] Implement the Phase A fallback decision.
- [ ] Golden tests from the Phase A fixtures.

Exit criteria: given a mocked `getCSSAsync()` result, the service returns
deterministic Layout and Style sections identical to the goldens.

## Phase C — Connected components summary

- [ ] Trim `figma-layout-extractor.ts` into a connected-instance enumerator:
  same visible-document-order traversal, same hard stop at every instance
  boundary, but collecting `ConnectedComponentEntry` items instead of
  building composition IR.
- [ ] Reuse `resolveInstance` and `GenerationContext` caches; guarantee no
  duplicate main-component or metadata lookup per generation.
- [ ] Unconnected or broken instances become diagnostics
  (`unconnected-instance`, `invalid-connection`, `missing-main-component`)
  with layer paths — never silent omission.
- [ ] Keep the node-count limit; truncation adds one `node-limit`
  diagnostic.
- [ ] Delete the retired modules (`tsx-emitter`, `css-module-emitter`,
  `imports`, `naming`) and their tests, unless Phase A chose the
  `LayoutStyle` fallback (then `css-module-emitter`'s declaration logic is
  the one salvage).
- [ ] Assemble `inspectFrame(node)` returning the full `FrameInspection`.

Exit criteria: fixtures with nested frames and mixed connected/unconnected
instances produce the expected entry list and diagnostics; instance internals
are never visited; existing component-codegen tests still pass unchanged.

## Phase D — Dev Mode adapter

- [ ] Replace `tryGenerateLayoutBlocks` in `src/main.ts` with the inspection
  path. For a non-component selection return:
  1. `CSS` block titled **Layout**.
  2. `CSS` block titled **Style** (omit when empty).
  3. `TYPESCRIPT` block **Connected components** (omit when none):
     deduplicated imports, then each usage — variant-mapped props included —
     preceded by its layer path as a comment. _(Originally a name-only
     plaintext list; changed after in-Figma verification showed the usage
     code is exactly what a developer wants in the Dev Mode panel. Same-name
     imports from different modules fall back to per-entry snippets rather
     than aliasing imports away from the JSX.)_
  4. `PLAINTEXT` diagnostics block when needed.
- [ ] Keep the connected-component branch byte-identical; optionally append
  the instance's own Layout/Style CSS blocks *after* the existing blocks.
- [ ] Remove the "not a layout Dev Mode supports yet" fallback — every node
  now yields CSS. Keep a plaintext error path only for unexpected failures.

Exit criteria: connected instances produce today's output (plus additive CSS
blocks); any frame/group/section/text/vector produces Layout and Style
blocks; repeated generation is deterministic.

## Phase E — Inspect Code integration

- [ ] Replace the `layout` status in `InspectCodeState` with
  `{ status: 'inspection'; inspection: FrameInspection }`.
- [ ] Update `sendSelectionState`: connected component → existing component
  state; any other single node → inspection state. Connect Component
  selection rules remain component-only.
- [ ] Rebuild the view from the salvaged `LayoutInspectView` scaffolding:
  - Header card: node name, node type.
  - **Layout** section: copyable CSS block.
  - **Style** section: copyable CSS block (hidden when empty).
  - **Connected components** section: per-entry name, layer path, copyable
    usage snippet (full snippets belong here, not in Dev Mode).
  - Diagnostics list with severity, reusing the existing pattern.
- [ ] Reuse CopyButton live-region feedback; keep keyboard order and the
  480 px no-horizontal-overflow constraint.
- [ ] Remove the TSX/CSS tab machinery and composition-summary UI.

Exit criteria: Inspect Code and Dev Mode render the same `FrameInspection`
for the same node; component connection authoring is unchanged.

## Phase F — Resilience

Deliberately small — single-node inspection removes the tree-hardening
surface (no naming collisions, no import aliasing, no placeholder contract,
no depth fuzzing).

- [ ] Stale-result guard: rapid selection changes never publish an outdated
  inspection (token/sequence check on the async `getCSSAsync()` round trip).
- [ ] `getCSSAsync()` failure on the selected node degrades to the
  connected-components section plus a `css-unavailable` diagnostic.
- [ ] One failed descendant resolution never discards CSS sections or other
  entries.
- [ ] Confirm no document mutations and no network access. _(Manifest
  pins `networkAccess: ["none"]`; a main-process test asserts generation
  never writes shared plugin data.)_
- [ ] Benchmark only the frame summary traversal (~500-node frame) — the
  single remaining O(tree) operation. _(Test: 500 shared-component instances
  finish under budget with exactly one metadata read.)_

Exit criteria: malformed nodes and rapid reselection fail predictably;
output is deterministic across repeated calls.

## Phase G — Tests

Pure unit tests:

- [ ] Partition table: every Layout property, Style defaults, unknowns.
- [ ] Declaration ordering and CSS text assembly.
- [ ] `FrameInspection` golden tests from Phase A fixtures.

Adapter tests:

- [ ] `getCSSAsync()` success, failure, and empty-result paths.
- [ ] Enumerator: boundary stopping, traversal order, caching, node limit,
  mixed connected/unconnected fixtures.

Main-process tests:

- [ ] Existing single-component Dev Mode output unchanged (frozen baseline).
- [ ] Frame selection returns Layout `CSS`, Style `CSS`, and optional
  `PLAINTEXT` blocks.
- [ ] Inspect Code receives the same `FrameInspection`.
- [ ] Stale-selection guard.

UI tests:

- [ ] Inspection state rendering: sections, empty Style, no connected
  components, diagnostics.
- [ ] Copy Layout / Copy Style / copy snippet.
- [ ] Keyboard order and narrow-window overflow.

Manual Figma acceptance matrix:

- [ ] Design mode plugin → Inspect Code (the Design-mode `getCSSAsync()`
  behavior from Phase A, re-verified in the real product).
- [ ] Dev Mode → Tashil UI codegen for frame, group, section, text, vector,
  connected instance, unconnected instance. _(Verified 2026-07-24 on real
  frames: Layout/Style blocks, connected snippet, unconnected notes.)_
- [ ] Variable-backed values render as `var(--token, fallback)`.
- [ ] Library/remote components; rapidly changing selections; light and
  dark themes.

## Phase H — Documentation and rollout

- [ ] Rewrite the layout-composer section of `project-brief.md` for the
  inspection model.
- [ ] Add `docs/inspect-frame.md`: what Layout/Style show, how the connected
  summary works, why instances are atomic, Design-mode value proposition.
- [ ] Move `layout-composer-preview.html` to `docs/archive/`.
- [ ] Changelog entry describing the pivot and the new behavior.
- [ ] Release as a beta; collect real usage before considering any return
  to code generation (a future "copy as TSX" affordance can be rebuilt from
  git history if users ask for it).

## Definition of done

- [ ] Selecting any single node shows Layout and Style CSS in both Dev Mode
  and Inspect Code, matching `getCSSAsync()` output.
- [ ] Variable-backed values pass through as `var(--token, fallback)`.
- [ ] Connected instance selection produces today's snippet output,
  byte-for-byte.
- [ ] Frame selection lists its connected components; instance internals are
  never traversed or emitted.
- [ ] Dev Mode and Inspect Code consume the same `FrameInspection`.
- [ ] Retired modules and superseded WIP wiring are removed.
- [ ] `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` pass;
  regenerated manifest committed when it changes.
- [ ] Documentation and changelog are complete.

## Suggested implementation order

1. Spike `getCSSAsync()` in both runtimes; freeze fixtures and the fallback
   decision (Phase A). **Everything else depends on this.**
2. Build the pure CSS inspection service (Phase B).
3. Trim the extractor into the connected-instance enumerator; delete retired
   modules (Phase C).
4. Integrate Dev Mode, then Inspect Code, against the shared
   `FrameInspection` (Phases D–E).
5. Harden, test, document (Phases F–H).

As before: do not build the Dev Mode and Inspect Code adapters
independently — the shared inspection service must be complete before either
surface gains formatting logic.

## References

- [Figma codegen API](https://developers.figma.com/docs/plugins/api/figma-codegen/)
- [Figma `CodegenResult`](https://developers.figma.com/docs/plugins/api/CodegenResult/)
- [`getCSSAsync` on SceneNode](https://developers.figma.com/docs/plugins/api/properties/nodes-getcssasync/)
- [Figma plugin manifest](https://developers.figma.com/docs/plugins/manifest/)
