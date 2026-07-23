# Layout Composer Roadmap

Status: Proposed  
Last updated: 2026-07-23  
Companion preview: [`layout-composer-preview.html`](layout-composer-preview.html)

## Objective

Allow a developer to select a layout in Figma and receive production-oriented
React/TSX plus CSS Modules output without manually combining Figma's CSS output
with Tashil component snippets.

The feature must work in both places:

1. **Figma Dev Mode** through `figma.codegen.on("generate")`.
2. **Tashil Code → Inspect Code** inside the plugin UI.

Both surfaces must use the same generation pipeline and return the same TSX,
CSS, diagnostics, and component-resolution decisions.

## Product decisions

- [x] Generate React/TSX and CSS Modules.
- [x] Do not support or expose Tailwind.
- [x] Treat every connected component instance as an atomic code boundary.
- [x] Generate layout wrappers around connected component usages.
- [x] Keep Connect Component focused on reusable design-system components.
- [x] Support both Dev Mode and the plugin's Inspect Code view.
- [x] Do not require a layout to be converted into a Figma component.
- [x] Do not persist generated layout code on the Figma document.
- [x] Do not traverse inside connected or unconnected component instances.

## Non-goals for the first release

- Pixel-perfect recreation of every visual property in Figma.
- Tailwind, styled-components, Emotion, or other style emitters.
- Automatic asset export for images, vectors, videos, or masks.
- Responsive breakpoint inference.
- Guessing semantic HTML from layer names.
- Generating production code from arbitrary absolute-positioned artwork.
- Editing the user's codebase from Figma.
- Persisting layout-specific metadata or changing the existing component
  connection schema.

## Current architecture and limitation

The existing implementation has a good component-generation core:

- `resolveSelection` resolves only `INSTANCE`, `COMPONENT`, and `COMPONENT_SET`
  nodes.
- `createUsageSnippet` generates one connected component usage, including its
  imports and prop mappings.
- `figma.codegen.on("generate")` exposes that usage in Dev Mode.
- `createInspectCodeState` exposes the same usage in Inspect Code.
- `InspectCodeState` currently represents only a single component result.

A selected frame, section, or group therefore becomes an invalid selection
before code generation starts.

The main architectural change is to introduce a layout document model between
Figma node traversal and code formatting:

```text
Figma SceneNode
    ↓
Layout extraction and component resolution
    ↓
Layout document IR
    ↓
TSX emitter + CSS Modules emitter + diagnostics
    ↓
Dev Mode adapter / Inspect Code adapter
```

## Required invariants

These rules must remain true throughout development:

- Connected component output must remain backwards compatible.
- A connected instance is emitted as one React component; its internal Figma
  children are never visited.
- An unconnected component instance is also not expanded into internal layers.
- Dev Mode and Inspect Code consume the same `GeneratedLayout` result.
- Generation is read-only and never mutates the canvas or plugin data.
- Output ordering, import ordering, class names, and diagnostics are
  deterministic.
- Unsupported nodes are reported; they are never silently omitted.
- A failure in one descendant should not discard otherwise usable layout code.
- Generated TSX and CSS must always be syntactically valid.

## Target domain model

Create a Figma-independent intermediate representation under `src/layout/`.

```ts
export type LayoutDocument = {
  root: CompositionNode;
  name: string;
  diagnostics: LayoutDiagnostic[];
};

export type CompositionNode =
  | ComponentCompositionNode
  | ContainerCompositionNode
  | TextCompositionNode
  | PlaceholderCompositionNode;

export type ComponentCompositionNode = {
  kind: 'component';
  nodeId: string;
  layerPath: string[];
  usage: ComponentUsage;
};

export type ContainerCompositionNode = {
  kind: 'container';
  nodeId: string;
  layerPath: string[];
  className: string;
  element: 'div';
  layout: LayoutStyle;
  children: CompositionNode[];
};

export type TextCompositionNode = {
  kind: 'text';
  nodeId: string;
  layerPath: string[];
  className?: string;
  text: string;
};

export type PlaceholderCompositionNode = {
  kind: 'placeholder';
  nodeId: string;
  layerPath: string[];
  reason: LayoutDiagnosticReason;
};

export type GeneratedLayout = {
  componentCount: number;
  wrapperCount: number;
  tsx: string;
  css: string;
  diagnostics: LayoutDiagnostic[];
};
```

The exact property names may change, but the boundaries should not:

- Figma-specific nodes stay in the extraction layer.
- The IR contains serializable values only.
- Emitters do not import or reference Figma types.
- UI and Dev Mode adapters receive completed strings and diagnostics.

## Component usage refactor

`createUsageSnippet` currently combines import generation and JSX formatting.
Layout composition needs these pieces separately.

- [x] Add a pure `createComponentUsage` API that returns:

  ```ts
  type ComponentUsage = {
    imports: ComponentImport[];
    jsx: string;
    diagnostics: MappingDiagnostic[];
  };
  ```

- [x] Keep `createUsageSnippet` as a compatibility wrapper around
  `createComponentUsage`.
- [x] Confirm existing component codegen output remains byte-for-byte stable.
- [x] Represent imports structurally using module path, imported name, and local
  name.
- [x] Deduplicate imports across all component descendants.
- [x] Sort imports deterministically.
- [x] Resolve same-name imports from different modules using deterministic local
  aliases.
- [x] Ensure aliased local names are also used in the generated JSX.
- [x] Preserve existing icon instance-swap behavior and named `Icon` imports.
- [x] Preserve all existing mapping diagnostics.

## Supported layout scope

### Version 1: supported

- A single selected `FRAME` using horizontal or vertical auto layout.
- Nested auto-layout frames.
- Visible connected component instances.
- Visible text nodes outside component instances.
- Groups that can be treated as transparent containers without changing layout
  meaning.
- Auto-layout wrapping.
- Figma layout sizing values needed for `FIXED`, `HUG`, and `FILL`.
- Per-child grow, stretch, and auto-layout positioning.
- Generated TSX and one CSS Module.

### Version 1: detected but not fully generated

- Frames with `layoutMode === "NONE"`.
- Grid auto layout.
- Absolute-positioned children.
- Sections used as visual organization rather than auto-layout containers.
- Images, vectors, booleans, stars, polygons, lines, videos, and embeds.
- Masks, blend modes, complex effects, rotations, and transforms.
- Multiple selected roots.

These cases must produce valid placeholder comments plus actionable diagnostics.
They must not cause an empty result or expose component internals.

### Later support

- [ ] CSS Grid generation for Figma grid layouts.
- [ ] Constrained absolute positioning for overlays and badges.
- [ ] Image and vector asset references.
- [ ] Figma variable to CSS custom-property mapping.
- [ ] Reusable layout templates and named slots.
- [ ] Optional semantic element hints.
- [ ] Responsive variants based on explicit Figma annotations or saved hints.

## Auto-layout to CSS Modules contract

Document and test every mapping. Avoid relying on scattered conditionals.

| Figma property | CSS output |
| --- | --- |
| `layoutMode: HORIZONTAL` | `display: flex; flex-direction: row` |
| `layoutMode: VERTICAL` | `display: flex; flex-direction: column` |
| `layoutWrap: WRAP` | `flex-wrap: wrap` |
| `itemSpacing` | `gap` |
| `counterAxisSpacing` | `row-gap` or `column-gap` when wrapping requires it |
| Four padding values | Minimal valid `padding` shorthand |
| Primary `MIN` | `justify-content: flex-start` |
| Primary `CENTER` | `justify-content: center` |
| Primary `MAX` | `justify-content: flex-end` |
| Primary `SPACE_BETWEEN` | `justify-content: space-between` |
| Counter `MIN` | `align-items: flex-start` |
| Counter `CENTER` | `align-items: center` |
| Counter `MAX` | `align-items: flex-end` |
| Counter `BASELINE` | `align-items: baseline` |
| Child `layoutGrow: 1` | `flex-grow: 1` with an appropriate basis |
| Child `layoutAlign: STRETCH` | `align-self: stretch` when needed |
| Child `layoutPositioning: ABSOLUTE` | Placeholder and diagnostic in version 1 |

Sizing policy:

- [ ] Let normal document flow represent `HUG` whenever possible.
- [ ] Emit `width: fit-content` or `height: fit-content` only when omission
  changes the layout contract.
- [ ] Convert `FILL` to `width: 100%`, `height: 100%`, or flex growth according
  to the parent axis.
- [ ] Emit fixed dimensions for nested nodes only when needed for fidelity.
- [ ] Omit the selected root's fixed canvas width by default and add an
  informational diagnostic.
- [ ] Do not emit fractional values with unstable floating-point noise.
- [ ] Normalize numeric values with one shared formatter.
- [ ] Use `box-sizing: border-box` when Figma layout behavior requires it.

Visual styling policy for version 1:

- [ ] Support border radius, simple solid background, simple solid border, and
  opacity only after the auto-layout contract is stable.
- [ ] Keep typography support limited to explicit unconnected text nodes.
- [ ] Report unsupported paints and effects instead of approximating them.
- [ ] Do not duplicate visual styling already owned by a connected component.

## Naming and formatting rules

- [ ] Derive the exported React function name from the selected layout name.
- [ ] Validate and sanitize it as a legal PascalCase identifier.
- [ ] Fall back to `GeneratedLayout` when no valid name can be derived.
- [ ] Derive CSS class names from container layer names.
- [ ] Use stable path-based suffixes for duplicate or empty layer names.
- [ ] Escape CSS identifiers, JSX text, string literals, and comments safely.
- [ ] Default every generated wrapper to `<div>`.
- [ ] Do not infer `<main>`, `<header>`, `<nav>`, or other semantic elements from
  layer names.
- [ ] Format TSX and CSS deterministically without requiring Prettier at runtime.
- [ ] Keep generated line endings and indentation consistent with current
  component snippets.

## Diagnostics contract

Create a structured diagnostic type shared by Dev Mode and Inspect Code:

```ts
type LayoutDiagnostic = {
  severity: 'info' | 'warning' | 'error';
  reason: LayoutDiagnosticReason;
  message: string;
  nodeId?: string;
  layerPath?: string[];
};
```

Initial diagnostic reasons:

- `unconnected-instance`
- `invalid-connection`
- `missing-main-component`
- `unsupported-root`
- `unsupported-node`
- `unsupported-layout-mode`
- `grid-layout`
- `absolute-positioning`
- `unsupported-paint`
- `unsupported-effect`
- `hidden-layer`
- `name-collision`
- `node-limit`
- `depth-limit`
- `root-fixed-size-omitted`

Behavior:

- [ ] Emit an inline valid JSX comment for placeholder nodes.
- [ ] Include the human-readable layer path in the diagnostic.
- [ ] Aggregate duplicate diagnostics when the remediation is identical.
- [ ] Preserve errors for individual component prop mappings.
- [ ] Show concise summaries in Dev Mode.
- [ ] Show the structured composition and full diagnostics in Inspect Code.
- [ ] Never include raw plugin data, source contents, or sensitive document
  metadata in diagnostics.

## Phase 0 — Contract fixtures and architecture

- [x] Add an architecture decision record for the shared layout IR and dual
  adapters.
- [x] Record the version 1 supported-node matrix.
- [x] Create representative mocked Figma fixtures:
  - Vertical form layout.
  - Horizontal header layout.
  - Nested auto-layout frames.
  - Wrapping action row.
  - Connected components from one package.
  - Connected components from multiple packages.
  - Duplicate component names from different packages.
  - Unconnected component instance.
  - Broken component metadata.
  - Raw text node.
  - Absolute-positioned child.
  - Unsupported vector/image layer.
- [x] Save reviewed golden TSX, CSS, and diagnostics for each fixture.
- [x] Measure current connected-component output so compatibility can be tested.

Exit criteria:

- Supported behavior and deliberate fallbacks are documented.
- Every later phase has stable input and expected-output fixtures.

## Phase 1 — Pure component and layout core

Suggested files:

```text
src/layout/types.ts
src/layout/naming.ts
src/layout/imports.ts
src/layout/tsx-emitter.ts
src/layout/css-module-emitter.ts
src/layout/generate-layout.ts
```

TODOs:

- [x] Introduce the layout IR and diagnostic types.
- [x] Refactor `createUsageSnippet` into the compatible structured component
  usage API.
- [x] Implement deterministic import collection and aliasing.
- [x] Implement class-name generation and collision handling.
- [x] Implement the TSX emitter.
- [x] Implement the CSS Modules emitter.
- [x] Add unit tests for every pure formatter and emitter.
- [x] Add golden tests for complete generated documents.

Exit criteria:

- The core accepts an IR fixture and returns complete, deterministic TSX, CSS,
  and diagnostics without importing Figma APIs.
- Existing component tests remain unchanged and passing.

## Phase 2 — Figma scene extraction

Suggested files:

```text
src/layout/figma-layout-extractor.ts
src/layout/figma-component-resolver.ts
src/layout/generation-context.ts
```

TODOs:

- [x] Add a root resolver that distinguishes component and layout selections.
- [x] Traverse supported layout descendants in visible document order.
- [x] Stop immediately at every component instance boundary.
- [x] Resolve connected component metadata through the existing connection
  reader.
- [x] Convert connected instances into structured component usages.
- [x] Convert unconnected or broken instances into placeholders.
- [x] Convert supported frames into container IR nodes.
- [x] Convert supported text nodes into escaped text IR nodes.
- [x] Convert unsupported nodes into placeholders and diagnostics.
- [x] Exclude hidden nodes and record an informational diagnostic only when the
  omission is materially useful.
- [x] Track the full layer path during traversal.
- [x] Add per-generation caches for:
  - Main-component lookup by instance ID.
  - Connection target lookup.
  - Parsed connection metadata.
  - Resolved instance swaps. _(Deferred: the swap cache is wired in Phase 4
    alongside `figma.getNodeByIdAsync`; connected instances without icon swaps
    — the version-1 common case — resolve fully today.)_
- [x] Avoid a global cache until invalidation behavior is proven.
- [x] Add configurable maximum depth and node count.
- [x] Return a controlled partial result when a limit is reached.

Exit criteria:

- Supported Figma fixtures produce the expected IR.
- Traversal never enters a component instance.
- A descendant failure does not reject the entire layout.

## Phase 3 — Auto-layout CSS

- [ ] Implement the documented auto-layout mapping table.
- [ ] Implement padding and gap shorthand formatters.
- [ ] Implement main-axis and cross-axis alignment.
- [ ] Implement wrapping and counter-axis spacing.
- [ ] Implement `FIXED`, `HUG`, and `FILL` sizing policy.
- [ ] Implement child grow and stretch behavior.
- [ ] Add the root fixed-width omission policy.
- [ ] Add numeric normalization.
- [ ] Add unit tests for every Figma-to-CSS mapping.
- [ ] Add combination tests for nested parent/child sizing.
- [ ] Add regression fixtures for RTL document content without changing CSS
  layout semantics implicitly.

Exit criteria:

- Version 1 auto-layout fixtures match reviewed golden CSS.
- Unsupported layout properties produce diagnostics rather than guesses.

## Phase 4 — Figma Dev Mode integration

Figma's `CodegenResult` supports a dedicated `CSS` language, so the Dev Mode
adapter should return separate highlighted blocks.

- [ ] Widen the local `CodegenBlock.language` union to include `CSS`.
- [ ] Extract the existing inline Dev Mode handler into a small function such as
  `generateCodegenBlocks(node)`.
- [ ] Keep the existing connected-component branch unchanged.
- [ ] Add a supported-layout branch that calls the shared layout generator.
- [ ] Return:
  1. A `TYPESCRIPT` block containing composed TSX.
  2. A `CSS` block containing the CSS Module.
  3. A `PLAINTEXT` diagnostics block when needed.
- [ ] Use the selected layout name in block titles.
- [ ] Keep references for connected single-component output.
- [ ] Define reference behavior for multi-component layouts; do not dump a long
  unstructured list in version 1.
- [ ] Return a clear message for unsupported roots or generation limits.
- [ ] Confirm behavior in Figma's native `Tashil UI` language selection.

Exit criteria:

- Selecting a connected component in Dev Mode produces the current output.
- Selecting a supported frame produces TSX and CSS blocks.
- Selecting an unsupported layout produces an actionable plaintext result.

## Phase 5 — Inspect Code integration

Replace the loose optional-field state with a discriminated state model:

```ts
type InspectCodeState =
  | { status: 'invalid-selection'; message?: string }
  | { status: 'not-connected' }
  | { status: 'connection-issue'; message: string; connectionIssue: ConnectionIssue }
  | { status: 'component'; output: GeneratedComponent }
  | { status: 'layout'; output: GeneratedLayout; composition: CompositionSummary };
```

TODOs:

- [ ] Update `sendSelectionState` to resolve either a component or layout target.
- [ ] Keep Connect Component selection rules component-only.
- [ ] Add the layout composition summary shown in the HTML preview.
- [ ] Render connected components, wrapper count, and layer paths.
- [ ] Render TSX and CSS as separate copyable code blocks.
- [ ] Render structured diagnostics with severity.
- [ ] Preserve current component references and copy behavior.
- [ ] Reuse the exact `GeneratedLayout` created for Dev Mode.
- [ ] Add keyboard navigation and accessible tab semantics for TSX/CSS views.
- [ ] Add live-region feedback for copy results and selection refreshes.
- [ ] Ensure the 480 px plugin window remains usable without horizontal page
  overflow.

Exit criteria:

- Inspect Code and Dev Mode outputs are byte-for-byte identical for the same
  selected layout.
- Component connection authoring remains unchanged.

## Phase 6 — Correctness, performance, and resilience

- [ ] Establish a benchmark fixture before setting a performance budget.
- [ ] Benchmark layouts with approximately 25, 100, and 500 visible nodes.
- [ ] Record total generation time and expensive async lookup counts in tests.
- [ ] Guarantee no duplicate main-component or metadata lookup in one generation.
- [ ] Prevent stale Inspect Code results after rapid selection changes.
- [ ] Keep generation work cancellable or safely discard stale results.
- [ ] Cap traversal depth and node count with explicit diagnostics.
- [ ] Verify prototype-safe dictionaries for Figma property and layer names.
- [ ] Fuzz-test names, text, CSS identifiers, comments, and import paths.
- [ ] Test empty, deleted, remote, and unavailable main components.
- [ ] Test malformed, legacy, and future-version connection metadata inside a
  layout.
- [ ] Test mixed successful and failed descendant generation.
- [ ] Confirm no document mutations occur during extraction or emission.
- [ ] Confirm no network access is introduced.

Exit criteria:

- Large or malformed layouts fail predictably without freezing the plugin.
- Generation remains deterministic across repeated calls.

## Phase 7 — Test plan

### Pure unit tests

- [ ] Layout naming and collision handling.
- [ ] Import deduplication and aliasing.
- [ ] TSX placeholder and text escaping.
- [ ] CSS property mappings and numeric formatting.
- [ ] Diagnostic aggregation.
- [ ] Full IR-to-output golden tests.

### Figma adapter tests

- [ ] Root type resolution.
- [ ] Component boundary stopping.
- [ ] Nested traversal order.
- [ ] Hidden-node policy.
- [ ] Per-generation caching.
- [ ] Limits and partial results.

### Main-process integration tests

- [ ] Existing single-component Dev Mode output is unchanged.
- [ ] Layout Dev Mode returns `TYPESCRIPT`, `CSS`, and optional `PLAINTEXT`
  blocks.
- [ ] Inspect Code receives the same layout output.
- [ ] Rapid selection changes do not publish stale layout output.
- [ ] Broken descendants do not discard successful descendants.

### UI tests

- [ ] Layout detected state.
- [ ] Composition summary and layer tree.
- [ ] TSX/CSS switching.
- [ ] Copy TSX and Copy CSS.
- [ ] Diagnostics and empty states.
- [ ] Keyboard focus order and tab behavior.
- [ ] Narrow-window overflow.

### Manual Figma acceptance matrix

- [ ] Figma Design mode plugin → Inspect Code.
- [ ] Figma Dev Mode → Tashil UI codegen selection.
- [ ] Local connected components.
- [ ] Library/remote connected components.
- [ ] Nested variants and instance swaps.
- [ ] Mixed connected and unconnected instances.
- [ ] Light and dark Figma themes.
- [ ] Rapidly changing selections.

## Phase 8 — Documentation and rollout

- [ ] Add a user guide: `docs/generate-layout-code.md`.
- [ ] Document the supported and unsupported layout matrix.
- [ ] Document why connected components are treated atomically.
- [ ] Add TSX/CSS examples to the README.
- [ ] Add troubleshooting guidance for unconnected descendants.
- [ ] Add a changelog entry.
- [ ] Keep the interactive HTML preview as a product reference or archive it
  after the production UI matches it.
- [ ] Release first as a documented beta for auto-layout frames.
- [ ] Collect concrete unsupported-layout examples before expanding scope.
- [ ] Do not expand to grid, assets, or absolute positioning until version 1
  diagnostics show which limitation matters most.

## Suggested implementation order

1. Freeze fixtures and compatibility expectations.
2. Refactor component usage into structural imports plus JSX.
3. Introduce the pure layout IR and emitters.
4. Build the Figma extraction adapter.
5. Implement auto-layout CSS Modules mapping.
6. Integrate Dev Mode.
7. Integrate Inspect Code.
8. Harden performance, limits, and diagnostics.
9. Complete manual Figma verification and documentation.

Do not implement the Dev Mode and Inspect Code paths independently. The shared
generator should be complete enough to integrate before either UI adapter gains
layout-specific formatting logic.

## Proposed file changes

New files:

```text
src/layout/types.ts
src/layout/naming.ts
src/layout/imports.ts
src/layout/tsx-emitter.ts
src/layout/css-module-emitter.ts
src/layout/generate-layout.ts
src/layout/figma-layout-extractor.ts
src/layout/figma-component-resolver.ts
src/layout/generation-context.ts
src/layout/*.test.ts
docs/generate-layout-code.md
```

Modified files:

```text
src/codegen.ts
src/codegen.test.ts
src/main.ts
src/main.test.ts
src/types.ts
src/ui.tsx
src/ui.css
src/ui.test.tsx
README.md
CHANGELOG.md
```

No component connection schema migration is required for version 1.

If semantic tags, layout slots, or per-layout output preferences are persisted
later, store them under a separately versioned layout namespace. Do not add them
to `ConnectionMetadata`.

## Definition of done

- [ ] A supported selected frame generates valid React/TSX and CSS Modules.
- [ ] Every connected descendant uses its saved Tashil component mapping.
- [ ] Component internals are never emitted.
- [ ] Imports are deduplicated and name conflicts are resolved.
- [ ] Unsupported descendants produce valid placeholders and diagnostics.
- [ ] Dev Mode returns TSX and CSS in native codegen blocks.
- [ ] Inspect Code shows the same TSX, CSS, composition, and diagnostics.
- [ ] Current single-component output remains backwards compatible.
- [ ] Pure, adapter, integration, UI, and manual Figma tests pass.
- [ ] `npm run typecheck` passes.
- [ ] `npm test` passes.
- [ ] `npm run lint` passes.
- [ ] `npm run build` passes and generated manifest output is committed when it
  changes.
- [ ] User documentation and changelog are complete.

## References

- [Figma codegen API](https://developers.figma.com/docs/plugins/api/figma-codegen/)
- [Figma `CodegenResult`](https://developers.figma.com/docs/plugins/api/CodegenResult/)
- [Figma plugin manifest](https://developers.figma.com/docs/plugins/manifest/)
