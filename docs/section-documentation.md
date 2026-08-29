# Section Guide — Documentation (`src/documentation/`)

Status: Active
Last updated: 2026-08-29

The **Documentation** section provides automated documentation generation and
in-place reconciliation for design system foundations (Figma Variable Collections
such as Colors, Spacing, and Radius) and connected Components.

It creates pixel-accurate, presentation-ready specification pages directly on
the Figma canvas matching the Swiss-Army design system standard (exemplified
in frame `1. Colors` [node `1386:9125`](https://www.figma.com/design/EdpV2zxUDxFXoOtnRivgQD/%E2%9C%B2--Swiss-Army?node-id=1386-9125&t=PqgRU2azybF9d8FI-11)),
exports structured Markdown/Storybook specifications, and updates existing documentation
frames **in place** without resetting layouts, positions, or component structures.
Token-documentation frames size themselves to their collection: 1100px for one
mode, 1500px for two, 1900px for three, 2300px for four, and 3000px for five or
more modes. Their primary content hierarchy fills the available Auto Layout
width at every supported size.
Tokens without a slash-delimited group are collected into a leading `General`
section. That section uses the same `.[Documentation] Section` component as
other groups, but its Boolean `Title` property is disabled so the table begins
without a redundant General heading.
Generated root frames use stable source-facing names: exactly the Variable
Collection name for token documents, and `<ComponentName> Guideline` for
component documents. In-place updates repair older root-frame names to the same
convention.

---

## Docs Interface

The plugin presents these capabilities as a searchable **Documentation
library** in `src/ui.tsx`. A native `@create-figma-plugin/ui`
`SegmentedControl` separates design tokens from components. Each scope keeps
its own native `Textbox` search, and a native `RadioButtons` group selects one
title-and-caption source row at a time. Component sources are sorted
alphabetically and hide dot-prefixed base/hidden components by default; a native
`Checkbox` filter can reveal them without changing the inventory scan. A lazy selected-source preview reports the
number of generated token groups (with up to three sample names) or component
variant combinations without constructing the full document or variant
matrix. For design-token sources, an inline native `SegmentedControl` between
the source list and preview limits generated groups to 1, 2, 3, or 4 path levels,
or preserves the full token path. New sessions recommend and default to 3
levels; generated token-frame metadata stores the chosen depth so drift checks
and in-place updates keep the same structure. Older frames without this field
continue to use full-depth grouping. Component captions omit instance counts after the lightweight inventory
scan; a numeric zero is shown only when coverage was actually calculated. A
scope-aware refresh action sits opposite the library heading and
reloads token collections or rescans the component inventory as appropriate,
while the shared bottom action-bar pattern used by Sync Tokens exposes only the
primary **Generate Document** canvas action. While a document is building, that
fixed bar replaces the action with Cancel and contains the live stage message,
progress bar, and percentage; the scrolling content does not render a separate
process card. Selecting a generated token-documentation frame
reveals its drift report, Markdown export, and in-place update actions in a
native banner. Source lists keep their natural content height inside the single
Docs content scroller, so long token and component inventories scroll with the
rest of the page while the bottom action bar remains fixed.

This view is presentation-only: new interface work must continue to use the
existing documentation handlers and message contracts rather than duplicating
generation, export, drift, or reconciliation logic in the UI.

---

## Module Map

| File | Purpose | Pure or Figma-aware |
| --- | --- | --- |
| [`src/documentation/types.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/types.ts) | Domain models, metadata schema (`tashil_doc_meta`), doc IR, and drift reports. | **Pure** |
| [`src/documentation/token-doc-model.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/token-doc-model.ts) | Groups variables into folder-matching sections, provides a name-only group summary for lazy previews, dynamically derives headlines and context-aware descriptions, resolves mode values/aliases, and computes deterministic content hashes. | **Pure** |
| [`src/documentation/generation-cancellation.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/generation-cancellation.ts) | Shared cooperative cancellation guard used by the main message layer, canvas writers, and in-place updaters. | **Pure** |
| [`src/documentation/doc-diff.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/doc-diff.ts) | Diffs current documents against previous snapshots/metadata to report exact drift (added, modified, removed tokens and modes). | **Pure** |
| [`src/documentation/component-doc-model.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/component-doc-model.ts) | Combines props contracts, Figma properties, and variant combinations into component doc models, and counts combinations without expanding the Cartesian matrix for previews. | **Pure** |
| [`src/documentation/markdown-emitter.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/markdown-emitter.ts) | Serializes doc IR to structured GitHub-flavored Markdown / Storybook documentation. | **Pure** |
| [`src/documentation/figma-canvas-writer.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/figma-canvas-writer.ts) | Figma canvas frame creator: loads fonts, instantiates master components from Swiss-Army, binds swatch fills to Figma Variables (`setBoundVariableForPaint`), sets column appearance modes (`applyColumnMode`), arranges frames side-by-side (100px gap), and stamps metadata. | **Figma-aware** |
| [`src/documentation/figma-canvas-updater.ts`](file:///Users/danial/Downloads/TashilStoryBook/src/documentation/figma-canvas-updater.ts) | In-place reconciler: updates existing text cells, swatch variable bindings, and table rows 1-to-1 without deleting or repositioning the root frame. | **Figma-aware** |

---

## Swiss-Army Design System Component Templates

The documentation builder binds to master components or component sets from the Swiss Army Knife design system:

| Component / Template | Node ID | Usage |
| --- | --- | --- |
| `.[Documentation] Header & Footer` | `1386:9060` (`1386:9061` Header, `1386:9066` Footer) | Root specification document header and footer bars |
| `.[Documentation] Hero` | `1422:17985` | Hero banner with dynamic title, subtitle, stats chips, and badge gradient |
| `.[Documentation] Separator` | `1422:18167` | Section divider rule with collection title badge |
| `.[Documentation] Section` | `1422:18185` | Section container holding headline, description, and `Slot` frame |
| `Variant Matrix Grid` | `1958:91236` | Multi-tier 2D Variant matrix showcase with layered column headers (`xTiers`), layered row headers (`yTiers`), right-facing & downward dimension bracket indicators, and dashed instance bounding boxes (`#8a38f5`) with transparent purple `None` placeholders for unsupported permutations |
| `.[Table] Header` | `1929:52306` | Column header bar across Token and Value columns |
| `.[Table] Token Item` | `1929:52305` | Row cell representing token name and indicator |
| `.[Table] Value Item` | `1929:52304` | Component set with variants (`Type=Color`, `Type=Number`, `Type=Boolean`, `Type=String`). For `Color`, the `Color Icon` layer fill is bound to the Figma Variable |
| `Table` | `1929:52307` | Horizontal auto-layout container grouping one Token Column and multiple Value Columns |

When master components are unavailable (e.g. running in an isolated test document), procedural fallback builders reconstruct identical auto-layout frames with exact typography, fills, and padding.

---

## Multi-Tiered Variant Matrix Architecture

The component documentation generator renders a layered 2D variant matrix matching the Swiss-Army design standard:

- **Multi-Level Column Headers (`xTiers`)**:
  - Tier containers use explicit Top-Right Auto Layout alignment.
  - Property names and option values preserve their exact casing from Figma.
  - **Tier 0 (Column Main)**: Top-level property group (e.g. `style: solid`, `style: tonal`) spanning all child columns with downward-facing brackets.
  - **Tier 1 (Column Secondary)**: Sub-level property group (e.g. `size: sm`, `size: md`) spanning sub-columns with secondary brackets.
  - **Tier 2 (Column Tertiary / Leaf)**: Leaf-level properties (e.g. `-` for false/default, `isOnlyIcon` for true) aligned directly above each column.
- **Multi-Level Row Labels (`yTiers`)**:
  - Tier containers use explicit Top-Right Auto Layout alignment.
  - Property names and option values preserve their exact casing from Figma.
  - **Tier 0 (Row Main)**: High-level property group (e.g. `intent: primary`, `intent: neutral`) with right-facing spanning brackets (`x = 0` spine, arms pointing right).
  - **Tier 1 (Row Secondary / Leaf)**: Sub-level states (e.g. `state: enabled`, `state: hovered`, `state: pressed`, `state: loading`, `state: disabled`) aligned with each instance row.
- **Intersection Badge**: `❖ ComponentName` tag placed at the top-left intersection aligned with header heights.
- **Complete Coverage & Fallbacks**: $100\%$ of all permutations are evaluated; valid Figma variants are instantiated, and unsupported combinations display a centered purple `None` placeholder without a cell background fill.

---

## Core Invariants & Rules for Editors

1. **Pure Cores are 100% Figma-Free**:
   - `types.ts`, `token-doc-model.ts`, `doc-diff.ts`, `component-doc-model.ts`, and `markdown-emitter.ts` must never import `@figma/plugin-typings`. They compile under `tsconfig.tests.json`.
2. **Variable Binding on Color Swatches**:
   - Swatch fills in `.[Table] Value Item` (`Color Icon` layer) must be bound to the Figma variable using `figma.variables.setBoundVariableForPaint(solidPaint, 'color', variable)`.
3. **Explicit Mode Assignment on Value Columns**:
   - Value columns must set their explicit variable mode using `applyColumnMode` via `node.setExplicitVariableModeForCollection(collection, mode.modeId)` so bound tokens resolve to the respective mode accurately.
4. **Dynamic Headlines & Context-Aware Descriptions**:
   - Headlines are derived from Figma folder paths (`formatDynamicHeadline`).
   - Descriptions are generated dynamically based on token data types, scopes, and keywords (`generateDynamicSectionDescription`) without hardcoded static tables.
5. **Metadata Tagging on Generated Frames**:
   - Generated canvas documentation frames must always be stamped via `setPluginData('tashil_doc_meta', ...)` with `DOC_FRAME_SCHEMA_VERSION = 1`, `docType`, `targetId`, `targetName`, `contentHash`, and `modeIds`.
6. **In-Place 1-to-1 Reconciliation**:
   - When an existing frame is updated, reconcile sections, rows, and mode columns 1-to-1 in place so canvas position, layer IDs, links, and comments remain intact without layout degradation.
7. **Font Loading Before Text Mutation**:
   - Every async text mutation on the canvas must be preceded by `await figma.loadFontAsync(textNode.fontName)`.
8. **Side-by-Side Canvas Placement**:
   - New documentation frames are placed side-by-side to the right of existing frames with 100px margins and automatically focused in the viewport.
9. **Lazy Source Previews**:
   - Preview only the selected source. Token previews must derive group identities from variable names without resolving values; component previews must multiply variant-option counts without constructing the matrix. Ignore superseded preview responses in the UI.
10. **One Docs Scroll Surface**:
   - Source lists must retain their natural content height and must not introduce an internal scrollbar. Keep the shared action bar outside the Docs content scroller so it remains fixed while the complete page scrolls.
11. **Single-Selection Source Semantics**:
   - Token collections and components are mutually exclusive selections within their scope. Use the native Figma `RadioButtons` component—not checkboxes—so the control communicates and exposes that single-selection behavior correctly.
12. **Unsupported Variant Cells Stay Transparent**:
   - During generation and in-place updates, keep the dashed matrix boundary and centered purple `None` label for unsupported combinations, but leave the cell `fills` array empty so missing variants are visually distinct from generated component instances.
13. **Tier Alignment Is Top-Right**:
   - Set every generated and in-place-updated `Tier …` frame to Top-Right. For horizontal X-axis tiers use primary `MAX` / counter `MIN`; for vertical Y-axis tiers use primary `MIN` / counter `MAX`.
14. **Unknown Instance Counts Are Not Zero**:
   - `ComponentInventoryItem.instanceCount` is optional because lightweight scans skip instance traversal. Omit the count when it is undefined; display `0 instances` only after a coverage scan has produced an explicit zero.
15. **Deterministic Component Discovery**:
   - Sort Docs component sources alphabetically by their displayed component name. Hide names beginning with `.` by default and expose them through the native **Show hidden components** checkbox. If filtering hides the active source, select the first available visible source instead.
16. **Variant Label Casing Comes From Figma**:
   - Preserve the exact casing of component property names and variant option values in generated Tier labels and legacy axis labels. In-place updates must also repair older lowercase labels without altering the underlying component variants.
17. **Token Grouping Depth Is End-to-End**:
   - Treat `TokenGroupingDepth` as generation input, not presentation-only state. Pass it through lazy previews, canvas/Markdown generation, and token in-place updates; stamp it in token-frame metadata and use the stamped value for drift checks. The `all` value must preserve the legacy content hash so older full-depth documents do not report false drift.
18. **Cancel Stops the Active Documentation Job**:
   - The Docs Cancel action must emit `CANCEL_DOC_GENERATION`, invalidate the active main-thread run, and check the shared cancellation guard between sections, table batches, matrix rows, and async Figma operations. Cancelled runs must not emit a late success/error result; newly generated partial root frames must be removed. A later generation starts with a fresh guard and must remain usable.
19. **Generation Progress Belongs to the Fixed Action Bar**:
   - Keep the live stage message, progress bar, percentage, and Cancel action inside the fixed Docs footer. Do not add a duplicate progress card to the scrolling content.
20. **Token Document Width Follows Mode Count**:
   - Generated and in-place-updated token documents must use 1100px for one mode, 1500px for two, 1900px for three, 2300px for four, and 3000px for five or more. Keep the root's Header, Hero, Separator, Sections, Footer, section Title/Slot, tables, columns, and rows set to Fill Container so content uses the complete available width.
21. **Root-Level Tokens Lead Without a Title**:
   - Keep the `general` section first while preserving the source order of every other group. Disable the Section component's Boolean `Title` property for General and restore it for all named groups during both generation and in-place updates; procedural fallbacks must mirror this through Title-layer visibility.
22. **Root Frame Names Are Source-Facing**:
   - Name token-document roots exactly after `collectionName`, with no numeric prefix. Name component-document roots `<ComponentName> Guideline`. Apply the same convention during in-place updates so legacy names are repaired without replacing their frames.
