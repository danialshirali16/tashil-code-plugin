# Semantic Connect Roadmap

Status: Archived  
Last updated: 2026-07-23  
The companion preview was removed with the retired prototype workspace.

## Objective

Allow a Figma component to connect to its real production React API even when
the Figma layer/component structure does not resemble the source-code
structure.

For example, this Figma structure:

```text
Dialog
├── Header
│   ├── Title
│   └── Description
└── Footer
    ├── Secondary action
    └── Primary action
```

must be able to generate this source-shaped implementation:

```tsx
<ConfirmationDialog
  intent="danger"
  title="Delete account?"
  description="This action cannot be undone."
  cancelAction={{ label: "Cancel" }}
  confirmAction={{ label: "Delete" }}
  onConfirm={/* set in application */}
/>
```

The feature must preserve one core rule:

> Inspect shows the real public code API. It must never invent code components
> merely because similarly named layers or nested components exist in Figma.

## Product principles

- [ ] Treat the Figma tree and source-code tree as independent representations.
- [ ] Map semantic values and regions, not layer hierarchy to JSX hierarchy.
- [ ] Let the source component's public API define generated code structure.
- [ ] Keep every suggested mapping reviewable and editable by a human.
- [ ] Never silently invent props, component names, imports, or runtime behavior.
- [ ] Represent application-only values such as callbacks as explicit runtime
      requirements, not connection errors.
- [ ] Keep the default workflow simple and move transforms, wildcards, and raw
      output behind progressive disclosure.
- [ ] Preserve backwards compatibility for existing schema-v4 connections.
- [ ] Use one generation pipeline for Dev Mode and **Inspect Code**.
- [ ] Make drift visible and recoverable; never silently delete stale mappings.

## User outcomes

### Design-system owner

- Connect one Figma main component to one real public source component.
- Upload the relevant TypeScript source and inspect its public API.
- Connect code prop paths such as `confirmAction.label` to values located inside
  nested Figma regions.
- Mark callbacks, state, and other application concerns as runtime-provided.
- Review the exact output before saving.
- Return later and see whether Figma, source, or the recipe has drifted.

### Developer

- Select a connected component and receive copyable production-shaped TSX.
- Understand which design values produced each code prop.
- See runtime requirements separately from design-derived values.
- Never receive fictional compound components such as `Dialog.Header` when the
  source library does not export them.

## Definition of done

The feature is complete when all of the following are true:

- [ ] A Dialog-like structural mismatch can be authored without raw JSON.
- [ ] Nested Figma text, properties, and instance values can feed top-level or
      nested code prop paths.
- [ ] Generated TSX follows the source API exactly.
- [ ] Required runtime props are represented without invalidating the recipe.
- [ ] Selecting the whole component shows complete production code.
- [ ] Selecting a mapped region explains its contribution and directs the user
      to the owning component instead of generating fictional standalone code.
- [ ] Existing schema-v4 connections generate byte-for-byte compatible output.
- [ ] Schema migration, drift detection, reconciliation, and explicit stale
      mapping removal are covered by tests.
- [ ] Dev Mode and **Inspect Code** return the same usage result and diagnostics.
- [ ] The full verification suite passes:

  ```sh
  npm run typecheck
  npm test
  npm run lint
  npm run build
  ```

## Current foundation

The repository already contains most of the infrastructure needed for a
sustainable implementation.

### Already available

- Component inventory and per-component navigation in `src/ui.tsx`.
- Source upload and local TypeScript prop extraction in
  `src/source-schema.ts`.
- Source-led visual mappings in `src/mapping-editor-view.tsx`.
- Persisted schema-v4 `MappingDocument` snapshots in `src/types.ts`.
- Compilation from authoring state to runtime `PropMappings` in
  `src/mapping-document.ts`.
- Connection health and source/Figma drift detection in
  `src/connection-health.ts`.
- Shared component usage generation in `src/codegen.ts`.
- Dev Mode and **Inspect Code** adapters in `src/main.ts`.
- UI mutation/state ownership in `src/ui-controller.ts` and `src/ui-state.ts`.
- Unit, UI, migration, and code-generation test coverage.

### Current limitations

- `FigmaComponentSnapshot` describes only exposed top-level component
  properties.
- A `PropertyMapping` targets one top-level source prop name.
- The source snapshot does not describe nested object prop paths such as
  `confirmAction.label`.
- The mapping compiler can express direct property/value lookups, children, and
  instance swaps, but not safe object assembly or runtime requirements.
- Events and unsupported props are omitted from the normal mapping UI.
- Inspect explains diagnostics and references, but not the semantic source of
  each emitted prop.
- Connection health cannot yet detect drift in nested Figma source locators or
  nested source prop paths.

## Required invariants

These invariants must remain true throughout development:

- Existing schema-v4 metadata remains readable.
- Existing connected components continue to generate their current TSX.
- Source text stays local; persisted metadata contains derived schema and hashes
  only.
- No persisted transform is executed with `eval`, `Function`, or arbitrary
  JavaScript.
- Generated JSX identifiers and values are validated and escaped.
- A nested Figma region is not automatically treated as a public source
  component.
- A connected component remains an atomic boundary for Layout Composer.
- Layout Composer consumes the resulting component usage and never traverses
  the connected component's internal design layers.
- Reconciliation never deletes a saved binding automatically.
- Output and diagnostics are deterministic.
- A broken binding cannot silently disappear from generated output.
- Plugin data writes occur only after explicit save.

## Target architecture

Introduce a Figma-independent semantic recipe between design extraction and
component usage generation:

```text
Figma component
    ↓
Semantic source extraction
    ↓
Semantic connection recipe
    ↓
Typed component-usage IR
    ↓
TSX + imports + diagnostics + mapping explanation
    ↓
Dev Mode / Inspect Code / Layout Composer
```

### Recommended persisted model

The exact names can change during the RFC, but the boundaries should remain.

```ts
type SemanticConnectionRecipe = {
  schemaVersion: 1;
  sourceSnapshot?: SourceComponentSnapshotV2;
  figmaSnapshot: FigmaSemanticSnapshot;
  bindings: SemanticBinding[];
  revision: number;
  lastValidatedAt?: string;
};

type SemanticBinding = {
  id: string;
  target: CodePropTarget;
  source: SemanticBindingSource;
  transform?: SemanticTransform;
  requirement: "optional" | "required" | "runtime";
};

type CodePropTarget = {
  path: string[];
  typeName: string;
};

type SemanticBindingSource =
  | ComponentPropertySource
  | NestedPropertySource
  | NestedTextSource
  | InstanceSource
  | StaticValueSource
  | RuntimeValueSource;

type SemanticTransform =
  | EnumTransform
  | BooleanTransform
  | OmitWhenTransform
  | ObjectAssemblyTransform;
```

### Binding-source policy

Support sources in this order:

1. Exposed Figma component property with a stable property ID.
2. Nested component property reached through stable component identities.
3. Nested text/property role explicitly confirmed by the connection owner.
4. Connected instance identity when the source API really expects a component.
5. Static value authored in the recipe.
6. Runtime placeholder supplied by application code.
7. Layer-name/path fallback only when no stable semantic identity exists.

Every fallback locator must be labeled as fragile and included in connection
health.

### Transform policy

Version 1 may support only declarative, bounded transforms:

- Figma enum option to source literal.
- Figma boolean to source boolean/literal.
- Omit when a value is absent or false.
- Assemble nested object props from separately bound leaves.
- Emit a static literal.
- Mark a target as runtime-provided.

Do not persist:

- Arbitrary JavaScript.
- User-authored functions.
- Unvalidated JSX fragments.
- Repository imports inferred only from layer names.

## Milestones

| Milestone | Outcome | Exit gate |
| --- | --- | --- |
| M0 — Product and technical RFC | Decisions are explicit before schema work. | Approved model, non-goals, migration policy, and UX flow. |
| M1 — Schema-v5 foundation | Semantic recipes persist safely beside legacy mappings. | Migration and round-trip tests pass. |
| M2 — Design/source extraction | Nested design values and nested source prop targets are discoverable. | Deterministic fixtures cover Dialog-like mismatches. |
| M3 — Authoring UI | A user can create the recipe without raw JSON. | Dialog usability test completes without explanation. |
| M4 — Generation and Inspect | One recipe produces production TSX and explanations. | Dev Mode and Inspect output parity tests pass. |
| M5 — Maintenance lifecycle | Drift, reconciliation, and migration are dependable. | Source/Figma change matrix passes. |
| M6 — Beta and GA | Feature is supportable in production. | Telemetry/privacy decision, docs, rollout, and support gates pass. |

> **Scope note (2026-07-24).** This plugin is used by our own team only, not
> distributed externally. The formal governance gates below — RFC sign-off,
> closed beta, telemetry/privacy review, and GA release process — are
> **intentionally relaxed**: decisions are recorded in
> [`semantic-connect-decisions.md`](../semantic-connect-decisions.md) and shipping
> is gated on the verification suite plus manual Figma checks, not on approvals.
> The engineering gates (tests, migration safety, no arbitrary code execution)
> still apply in full.

## M0 — Product and technical RFC

### Product decisions

- [ ] Confirm the vocabulary used in UI:
  - **Code target** for the public source component.
  - **Implementation mapping** for source-prop-to-design-value bindings.
  - **Runtime value** for application-provided behavior.
  - **Figma value** for a component property or nested semantic source.
- [ ] Confirm that code props remain the left-hand/primary column in the editor.
- [ ] Confirm that structural mismatch is an informational state, not an error.
- [ ] Decide whether static values belong in the first release.
- [ ] Decide whether version 1 supports nested object paths beyond one level.
- [ ] Decide how a separately connected nested component can be used:
  - as an inline component value;
  - as a semantic value source; or
  - explicitly ignored for the parent recipe.
- [ ] Decide Inspect behavior when the user selects a nested contributing region.
- [ ] Define when a recipe is saveable despite runtime requirements.
- [ ] Define what “Healthy” means for a recipe with intentional runtime values.

### Technical decisions

- [ ] Decide whether semantic authoring replaces `MappingDocument` or is added as
      an optional v5 field during a compatibility period.
- [ ] Add an independent `schemaVersion` to the recipe document so authoring
      changes do not always require bumping all connection metadata.
- [ ] Define stable IDs for bindings.
- [ ] Define safe locator precedence and fragility scoring.
- [ ] Define limits for traversal depth, node count, binding count, and persisted
      metadata size.
- [ ] Define a structured `ComponentUsage` value IR before JSX formatting.
- [x] Record decisions in a dedicated ADR or decisions section in this document.
      (2026-07-24) [`semantic-connect-decisions.md`](../semantic-connect-decisions.md)
      records the decisions as implemented, including how the Open decisions
      below were resolved.

### M0 exit criteria

- [ ] Product, design-system, and plugin engineering owners approve the RFC.
- [ ] The Dialog, Switch, Button-with-icon, and compound-component examples are
      represented in the proposed model.
- [ ] The model can distinguish a design region from a public source component.
- [ ] No example requires arbitrary code execution.

## M1 — Schema-v5 foundation

### Domain types

- [ ] Add `SemanticConnectionRecipe`, `SemanticBinding`,
      `SemanticBindingSource`, `CodePropTarget`, and transform types to a
      dedicated module.
- [ ] Keep the core recipe serializable and independent of Figma plugin types.
- [ ] Represent code prop targets as validated path segments rather than
      dot-separated strings internally.
- [ ] Add binding IDs that remain stable across display-name changes.
- [ ] Store user intent separately from inferred suggestions.
- [ ] Store locator stability/fragility metadata.
- [ ] Store runtime requirements explicitly.
- [ ] Add recipe revision and validation timestamps.

### Persistence and migration

- [ ] Bump `CURRENT_SCHEMA_VERSION` from 4 to 5 only after the migration path is
      complete.
- [ ] Add schema-v5 validation in the connection read path.
- [ ] Migrate every schema-v4 visual `PropertyMapping` into an equivalent direct
      component-property semantic binding.
- [ ] Preserve legacy `propMappings` as the runtime compatibility representation
      during the transition.
- [ ] Keep reading schema versions 1–4.
- [ ] Define behavior when a newer unsupported recipe version is encountered.
- [ ] Reject malformed path segments, unsafe transforms, and oversized metadata.
- [ ] Add fixtures for v1→v5, v2→v5, v3→v5, and v4→v5 migration.
- [ ] Add round-trip serialization tests.
- [ ] Add downgrade documentation: once saved as v5, older builds may read the
      connection as unsupported rather than corrupting it.

### Compatibility compiler

- [ ] Compile simple semantic bindings back to existing `PropMappings` where
      possible.
- [ ] Route bindings that require nested values or object assembly through the
      new usage IR instead of forcing them into legacy JSON.
- [ ] Keep existing `createUsageSnippet` output byte-for-byte stable for legacy
      connections.

### M1 exit criteria

- [ ] All existing migration and codegen tests remain green.
- [ ] A schema-v4 connection can be opened, saved as v5, and generate the same
      code.
- [ ] Invalid semantic metadata produces an actionable connection issue.
- [ ] No v5 save can persist executable code.

## M2 — Design and source extraction

### Source contract v2

- [ ] Extend source parsing to describe nested object leaves such as
      `confirmAction.label`.
- [ ] Preserve the owning top-level prop and full target path.
- [ ] Record whether each target is required, optional, runtime, visual, event,
      or unsupported.
- [ ] Treat callbacks as visible runtime requirements rather than hiding them.
- [ ] Detect object props that can be safely assembled from serializable leaves.
- [ ] Continue to exclude `className`, style-system internals, refs, and other
      non-design props by policy.
- [ ] Add support for props interfaces split across local files without storing
      original source text.
- [ ] Evaluate support for type-alias props declarations.
- [ ] Keep unsupported types visible with an explanation rather than silently
      discarding them.
- [ ] Add parser fixtures for:
  - direct strings and numbers;
  - literal unions;
  - booleans;
  - nested objects;
  - optional nested objects;
  - callbacks;
  - React nodes;
  - discriminated unions;
  - imported aliases;
  - defaults.

### Figma semantic snapshot

- [ ] Add a bounded descendant extractor for connect-authoring only.
- [ ] Do not change Layout Composer's atomic component-boundary rule.
- [ ] Capture exposed top-level component properties as today.
- [ ] Capture eligible nested instance properties.
- [ ] Capture eligible nested text sources.
- [ ] Capture stable child main-component identities where available.
- [ ] Capture a human-readable path for display and diagnostics.
- [ ] Prefer component/property identities over raw layer node IDs.
- [ ] Mark name/path-only locators as fragile.
- [ ] Record whether a nested instance has its own Tashil connection.
- [ ] Exclude hidden, decorative, and unsupported layers by default while
      allowing explicit review.
- [ ] Add depth, node-count, and time limits.
- [ ] Return partial results with diagnostics instead of failing the whole scan.

### Suggestion engine

- [ ] Suggest bindings using compatible types first.
- [ ] Rank exact normalized-name matches.
- [ ] Rank semantic synonyms only from an explicit, testable dictionary.
- [ ] Consider source prop path and Figma region context together.
- [ ] Suggest `Header / Title` for `title` but require confirmation.
- [ ] Suggest `Footer / Primary / Label` for `confirmAction.label` but require
      confirmation.
- [ ] Suggest event callbacks as runtime values.
- [ ] Never auto-save or silently replace a confirmed binding.
- [ ] Include confidence and the reason for every suggestion.
- [ ] Add deterministic suggestion fixtures.

### M2 exit criteria

- [ ] The Dialog fixture exposes all five design-derived values and the runtime
      callback.
- [ ] Reordering Figma layers does not break stable semantic locators.
- [ ] Renaming a display label produces review feedback without losing the
      binding when the stable identity remains.
- [ ] Extractors remain within documented performance limits.

### M2 source-contract robustness (real-world gaps)

Found 2026-07-24 by running the shipped `extractSourceContract` against a real
production modal: `swiss-army-knife/.../tashil-info-modal/types.ts`
(`InfoModalProps`) connected to the Figma `Dialogbox` component set (variant
`Size = Small | Medium | Large | xLarge`). The generation pipeline is sound,
but the source parser drops or misclassifies most of this component's real
props. These items block production use for any component beyond a clean, flat,
self-contained interface. Priority order reflects observed impact.

- [x] **Resolve `extends` / `Omit<>` / `Pick<>` on the props interface.**
      (2026-07-24) `source-contract.ts` now builds a cross-file symbol table
      and `collectInterfaceMembers` walks heritage clauses — plain `extends`,
      `Omit<Base, keys>`, `Pick<Base, keys>` — with own members overriding
      inherited ones. `InfoModalProps` now exposes `size` (`sm|md|lg|xl`) and
      `dir` (`rtl|ltr`); the Figma `Size` variant is connectable.
- [x] **Resolve imported type aliases to their underlying union.**
      (2026-07-24) The symbol table spans every uploaded file, so `dealias`
      resolves `ButtonVariantType`/`ButtonSizeType` from a sibling
      `button/types.ts` to their literal unions when that file is uploaded.
      `CancelVariant`, `cancelSize`, `submitSize` now extract as visual enums.
      Unresolvable external bases (e.g. `ComponentPropsWithoutRef`) warn and are
      skipped rather than failing the scan.
- [x] **Treat `string | ReactNode` as text-bindable.** (2026-07-24) A union
      that admits a bare `string` (e.g. `title: string | React.ReactNode`) now
      classifies as free-text `visual`; `null`/`undefined` union members are
      ignored. **Still pending:** a lone `React.ReactNode` that is really text
      (`description`) stays a `node`/slot — needs Figma-side evidence before we
      can offer it a text binding safely.
- [x] **Assemble `Omit<ButtonProps, …>` nested-object props** the same way as
      `confirmAction.label`. (2026-07-24) The main loop and `extractObjectLeaves`
      now resolve object-shaped props via `resolveObjectMembers`
      (type literal, interface ref, or `Omit`/`Pick` of one), flattening one
      level and honouring each prop's own `Omit`/`Pick` key list. `submitProps`
      and `cancelProps` now expose `.color`, `.variant`, `.fullWidth`,
      `.iconOnly` (etc.) as nested visual targets; nested `className` stays
      excluded and deeper-than-one-level members stay `unsupported`.
- [x] **Value-alias enum options across casing/abbreviation.** (2026-07-24)
      Replaced the one-directional alias dictionary with canonical equivalence
      groups (`VALUE_ALIAS_GROUPS`) — bidirectional by construction, and now
      including the size scale (`sm↔small`, `md↔medium`, `lg↔large`,
      `xl↔xlarge`, plus `xs`/`xxl`). `deriveTransform` now produces a complete
      `{ Small: 'sm', Medium: 'md', Large: 'lg', xLarge: 'xl' }` map for the
      Figma `Size` variant. Unlisted pairings stay unmapped and surface as a
      review warning — never auto-applied fuzzily. **Follow-up (optional):** a
      per-option override control in the editor for the long tail a dictionary
      can't cover (e.g. project-specific `tiny/regular/huge`).
- [ ] **Array-of-object props** (`actionButtons?: InfoModalActionButtons[]`)
      remain out of scope for v1 (see open decision on array assembly); keep
      them visibly `unsupported` with an explanation, not dropped.
- [ ] Add parser fixtures mirroring `InfoModalProps`: interface `extends
      Omit<Base, …>`, imported alias unions, `string | ReactNode`, `Omit<>`
      object prop, and an array-of-object prop.
- [ ] Re-run the `InfoModalProps` ↔ `Dialogbox` case as an acceptance check once
      the above land.

## M3 — Authoring UI

### Components inventory

- [ ] Keep the current **Components** inventory, filters, search, dot-name
      filter, and per-component navigation unchanged.
- [ ] Add no semantic-mapping concepts to the inventory list.
- [ ] Continue to use Connected, Not connected, and Needs attention statuses.

### Component detail

- [ ] Preserve the current single-column component-detail page.
- [ ] Add a concise **Code target** source summary.
- [ ] Rename the mapping section to **Implementation mapping**.
- [ ] Keep code props as the primary list; do not show a parallel Figma tree.
- [ ] Group targets into Content, Variants & states, Actions, Slots, and
      Application behavior.
- [ ] Display nested source targets such as `confirmAction.label` as one row.
- [ ] Show eligible Figma values in a single searchable/selectable control.
- [ ] Label runtime targets as **Set in application**.
- [ ] Show one informational note when the design and code structures differ.
- [ ] Hide raw JSON, wildcards, and advanced transforms under an Advanced
      disclosure.
- [ ] Show mapping progress based on required visual targets, not total source
      props.
- [ ] Let users intentionally mark a source target as:
  - mapped from Figma;
  - static;
  - runtime;
  - optional/omitted.
- [ ] Show why a source target is excluded by policy.
- [ ] Provide an inline generated-code preview before save.

### Validation and save behavior

- [ ] Disable save when a required visual target is unresolved.
- [ ] Allow save when a required callback is explicitly marked runtime.
- [ ] Warn, but do not block, on fragile name/path locators.
- [ ] Block duplicate ownership of the same non-repeatable code prop target.
- [ ] Require an explicit transform when source and Figma value types differ.
- [ ] Preserve unsaved changes when switching between Components and Inspect.
- [x] Confirm before replacing uploaded source when doing so would invalidate
      bindings. (2026-07-24) `uploadSourceFiles` gates behind a **Replace
      uploaded source?** confirmation when re-uploading over a *saved* semantic
      recipe that has bindings; a first-time in-session draft and legacy
      connections replace freely so the quick connect flow is uninterrupted.

### Accessibility

Audit of the new semantic authoring UI (2026-07-24):

- [x] Maintain keyboard-operable tabs and form controls. The semantic editor
      uses native `<select>`/`<input>`/`<button>` controls only — no custom
      widgets — so tab order and activation are keyboard-operable by default.
- [x] Give every mapping control a unique accessible name. Each target's value
      control carries a `visually-hidden` label naming its target path; the
      reconciliation Accept/Remove buttons now use `aria-label="… for
      {targetPath}"` so otherwise-identical buttons are distinguishable.
- [x] Announce validation, save, and reconciliation results. Accepting/removing
      a proposal writes to the existing `aria-live="polite"` status region
      (e.g. "Removed the stale mapping for title."); save/validation reuse the
      established form status/alert regions.
- [x] Alertdialog focus: the **Replace uploaded source?** confirmation
      (`role="alertdialog"`) moves focus to its safe "Keep current" choice on
      open, mirroring the clear-connection confirmation.
- [ ] Preserve focus when returning to the component inventory. *(existing app
      behavior; unchanged by semantic work — re-verify at GA.)*
- [ ] Verify focus order with advanced sections collapsed and expanded.
      *(manual Figma verification pending.)*
- [x] Meet WCAG 2.2 AA contrast for statuses and interactive controls. The
      reconciliation panel and replace-source prompt reuse the existing
      `connection-health-needs-review` styling already validated for contrast.
- [x] Respect reduced-motion preferences. The new panels introduce no
      animation or transition.

### M3 exit criteria

- [ ] A first-time user can connect the Dialog fixture without editing JSON.
- [ ] A user can explain the difference between mapped, static, runtime, and
      omitted values after using the flow.
- [ ] The component inventory remains visually and behaviorally consistent with
      the current plugin.
- [ ] UI tests cover mapping, validation, save, cancel, source replacement, and
      keyboard interaction.

## M4 — Generation and Inspect

### Component usage IR

- [x] Introduce a typed value IR for component props (`usage-ir.ts`):
  - primitive literal;
  - nested object;
  - connected component usage — added 2026-07-24 via the `instance` binding
    source; renders `prop={<Child />}` and merges the child's import;
  - omitted value;
  - runtime placeholder.
- [ ] Keep imports structural and deterministic.
- [ ] Assemble nested object props without string concatenation.
- [ ] Omit empty optional objects.
- [ ] Validate source prop paths before generation.
- [ ] Preserve existing children and icon instance-swap behavior.
- [ ] Keep formatting deterministic without runtime Prettier.

### Semantic resolver

- [ ] Resolve the active instance's top-level Figma properties.
- [ ] Resolve confirmed nested text/property sources using stable locators.
- [ ] Apply declarative transforms.
- [ ] Assemble all target values before JSX formatting.
- [ ] Produce a structured explanation for every emitted or omitted target.
- [ ] Produce a structured runtime-requirements list.
- [ ] Return partial usable output with diagnostics when optional values fail.
- [ ] Block unsafe or type-incompatible required values.

### Inspect Code

- [ ] Show production-shaped TSX as the primary copyable result.
- [ ] Show runtime placeholders with clear comments.
- [ ] Add a compact **Why this structure?** explanation.
- [ ] Add an expandable target-to-Figma-source mapping list.
- [ ] Keep Storybook and source references.
- [ ] Keep mapping diagnostics outside the copyable TSX.
- [ ] If a selected region has no public code component, show:
  - the owning connected component;
  - the props to which the region contributes; and
  - an action to inspect the full implementation.
- [ ] If a nested component truly maps to a public source component, show its
      own connection only when selected independently.

### Dev Mode parity

- [ ] Make native codegen and Inspect consume the same resolved
      `ComponentUsage`.
- [ ] Keep code and imports identical between both surfaces.
- [ ] Add parity tests for code, diagnostics, and references.
- [ ] Document any unavoidable presentation-only differences.

### Layout Composer compatibility

- [x] Feed resolved semantic component usage into Layout Composer's existing
      component boundary. (2026-07-24) `figma-component-resolver.buildComponentNode`
      now routes a `semanticRecipe` connection through `createConnectedUsage`,
      which calls the shared semantic resolver; legacy connections keep
      `createComponentUsage` byte-for-byte. This automatically covers frame
      inspection, since `inspectFrame` enumerates connected instances through
      the same resolver.
- [x] Do not expose internal semantic Figma locators to layout traversal.
      (2026-07-24) The composition path resolves the recipe from the instance's
      **live top-level component properties** (variant/enum values reflect the
      instance) plus the recipe's **captured nested-source snapshot** — the
      resolver's `samples` fallback — so no internal design layers are
      traversed. Per-instance nested-text override reflection inside a layout is
      a documented future enhancement.
- [x] Confirm nested design regions never become additional layout nodes.
      (2026-07-24) Unchanged atomic-boundary traversal: `inspectFrame` /
      `resolveInstance` still stop at every INSTANCE boundary; the semantic
      recipe only changes how the single component node's usage is computed.
- [x] Add a golden layout fixture containing a semantically connected Dialog.
      (2026-07-24) `src/inspect/semantic-inspect.test.ts`: a nested semantic
      Dialog resolves to the approved `ConfirmationDialog` usage, reflects a
      live `intent` variant change, and never emits `Dialog.Header`/`.Footer`.

### M4 exit criteria

- [ ] Dialog generates the approved `ConfirmationDialog` usage.
- [ ] Dev Mode and Inspect output are equivalent.
- [ ] No fictional `Dialog.Header` or `Dialog.Footer` output appears.
- [ ] Runtime requirements are obvious but do not contaminate mapping
      diagnostics.
- [ ] Layout Composer still treats the Dialog as one atomic component usage.

## M5 — Sustainable maintenance lifecycle

### Connection health v2

- [ ] Extend health evaluation to semantic binding targets and sources.
- [ ] Detect nested Figma source removal.
- [ ] Detect nested source movement when identity survives.
- [ ] Detect fragile locator breakage or ambiguity.
- [ ] Detect source prop path addition, removal, rename, and type change.
- [ ] Detect nested object optionality changes.
- [ ] Detect transform input/output incompatibility.
- [ ] Treat confirmed runtime values as healthy.
- [ ] Treat new unmapped required visual props as Needs review.
- [ ] Treat bindings to removed required values as Broken.
- [ ] Keep Source refresh required behavior until repository-owned manifests
      exist.

### Reconciliation

Pure model landed 2026-07-24 in `src/semantic/reconcile.ts` (`planReconciliation`,
`applyProposal`, `markRecipeReconciled`), covered by `reconcile.test.ts` across
the design/source change matrix. UI wiring into the component-detail page is the
remaining piece.

- [x] Match by stable identity before attempting rename heuristics.
      `planReconciliation` matches a moved nested source by its component key
      first (disambiguating sibling instances that share a key by the surviving
      leaf name), and only falls back to a single-type-compatible-target rename
      heuristic for source props.
- [x] Present suggested remaps separately from confirmed bindings. (2026-07-24)
      `SemanticMappingView` renders a **Changes need review** panel above the
      mapping rows; the controller feeds it `planReconciliation(recipe,
      semanticSnapshot, sourceContract)` so design *and* source drift surface.
      `createRecipeDraft` now preserves bindings orphaned by a re-upload instead
      of dropping them, so source renames/removals reach the panel.
- [x] Never auto-delete stale bindings. Planning only proposes; `applyProposal`
      removes a binding solely under an explicit `remove` action.
- [x] Provide explicit **Remove stale mapping** actions. `design-removed` /
      `source-removed` proposals are remove-only (`isRemoveOnly`); `accept` on
      them is a deliberate no-op so nothing is silently guessed.
- [x] Provide a one-click safe rename migration when identity and type match.
      `locator-moved` (design identity survives) and `source-renamed` (single
      type-compatible target) proposals apply in one accept.
- [x] Save reconciliation only after explicit confirmation. (2026-07-24)
      Accepting/removing a proposal edits the in-memory form draft only;
      persistence still goes through the existing Save button and its recipe
      validation, so nothing is written to plugin data without confirmation.
- [x] Record revision and validation time only after a successful save.
      `markRecipeReconciled` is the only path that bumps `revision` and stamps
      `lastValidatedAt`; planning and applying never touch them.
- [x] Keep a pre-save in-memory snapshot so cancel restores the previous recipe.
      (2026-07-24) Reconciliation edits flow through the existing form-draft
      system, whose `baseline` is the pre-edit snapshot; abandoning the edit
      (no Save) never persists it. `applyProposal` never mutates its input.

### Ownership and lifecycle

Optional lifecycle metadata landed 2026-07-24: `RecipeLifecycle` on
`SemanticConnectionRecipe` (validated in `schema.ts`), surfaced by the resolver
as an advisory `deprecation` string that never blocks generation.

- [x] Add optional owner/team metadata. `RecipeLifecycle.owner`.
- [x] Add optional component package/version metadata.
      `RecipeLifecycle.packageName` / `packageVersion`.
- [x] Add connection lifecycle state:
  - draft;
  - connected;
  - needs review;
  - deprecated.
- [x] Add replacement guidance for deprecated source components.
      `RecipeLifecycle.replacement`, folded into the deprecation notice.
- [x] Show deprecation guidance in Inspect without preventing code access.
      Dev Mode adds a **⚠️ Deprecated** block and Inspect a `role="note"`
      banner above the code; the production TSX is still emitted in full.
- [ ] Decide whether multiple source API versions can coexist temporarily.
      *(open decision; `packageVersion` records the authored version but no
      multi-version coexistence yet.)*
- [ ] Document the supported plugin/schema compatibility matrix.

### Recovery and supportability

- [x] Add an exportable redacted connection-debug bundle. (2026-07-24)
      `src/semantic/debug-bundle.ts` — `createConnectionDebugBundle` +
      `serializeConnectionDebugBundle`, redacted by construction. Wired to an
      **Export debug bundle** action under *Support* in the Implementation
      mapping editor, downloading JSON via `downloadBlob` (2026-07-24).
- [x] Include schema version, hashes, diagnostics, and health state. Connection
      and recipe schema versions, source `contentHash`, binding/target counts,
      per-binding kind/requirement/transform, and a health summary
      (`bySeverity` counts + affected code targets).
- [x] Exclude source text, private URLs, customer content, and credentials.
      The assembler only reads counts, kinds, hashes, code identifiers, and
      severities; reference URLs/paths become booleans, and design content
      (sample values, nested text, static literals, layer-name paths) and owner
      are never copied. Proven by redaction tests in `debug-bundle.test.ts`.
- [ ] Provide human-readable recovery messages for unsupported future schemas.
      *(Partly covered: `validateSemanticRecipe` already returns an actionable
      "newer than this plugin supports — update the plugin" message; a
      connection-level recovery surface is pending.)*
- [x] Document manual recovery for malformed or legacy metadata. (2026-07-24)
      [Maintain a connection §"Recover a malformed or unreadable connection"](../maintain-connections.md)
      documents each validation message, its recovery, and the
      blocked-not-destructive guarantee.

### M5 exit criteria

- [ ] The full source/Figma/recipe drift matrix is covered by tests.
- [ ] No maintenance action silently changes generated code.
- [ ] A broken locator can be remapped without rebuilding the recipe.
- [ ] Deprecation and replacement are visible in both Connect and Inspect.

## M6 — Beta, rollout, and GA

### Feature delivery

- [ ] Add a local development feature flag while schema and UI are unstable.
- [ ] Support reading v5 before enabling v5 authoring.
- [ ] Enable authoring for internal test files first.
- [ ] Run a closed beta on structurally matched and mismatched components.
- [ ] Include at least:
  - Button;
  - Switch;
  - Dialog;
  - Select;
  - compound component;
  - component with nested object props;
  - component with required callbacks.
- [ ] Record task completion, confusion points, and failed mappings.
- [ ] Fix all P0/P1 usability and data-integrity findings before broader rollout.
- [ ] Remove the feature flag only after migration and rollback procedures are
      tested.

### Documentation

- [ ] Update `docs/connect-component.md`.
- [ ] Update `docs/prop-mapping.md`.
- [ ] Update `docs/maintain-connections.md`.
- [ ] Add a guide for structural mismatches and runtime values.
- [ ] Add Dialog and compound-component examples.
- [ ] Document locator fragility and how to make Figma components more stable.
- [ ] Document the schema-v5 migration and compatibility policy.
- [ ] Update in-plugin help.
- [ ] Add a changelog entry.

### Privacy and telemetry

The plugin currently declares no network access. Preserve that default unless a
separate privacy-approved telemetry proposal changes it.

- [ ] Decide whether the feature needs telemetry.
- [ ] Prefer local counters or explicit exported diagnostics during beta.
- [ ] Do not transmit source schemas, component names, file names, design text,
      URLs, or connection recipes without an approved policy and user consent.
- [ ] If network telemetry is proposed, review the manifest/network-access
      change separately.

### Performance budgets

- [ ] Define a maximum semantic extraction time for a normal component.
- [ ] Define hard traversal depth and node-count limits.
- [ ] Define a maximum saved recipe size.
- [ ] Define maximum UI render time for a large source contract.
- [ ] Add performance fixtures for a component set with many variants and
      descendants.
- [ ] Ensure source parsing and mapping suggestions do not block interaction for
      noticeable periods.

### GA exit criteria

- [ ] Migration and rollback are documented and tested.
- [ ] No open P0/P1 correctness, accessibility, or data-loss issues.
- [ ] Supported component patterns and limitations are documented.
- [ ] Performance budgets pass on representative files.
- [ ] The feature has an identified owner and maintenance rotation.
- [ ] Release notes and support guidance are ready.

## Test strategy

### Unit tests

- [ ] Recipe validation and serialization.
- [ ] Schema-v4→v5 migration.
- [ ] Source target-path extraction.
- [ ] Figma semantic locator extraction.
- [ ] Suggestion ranking.
- [ ] Declarative transforms.
- [ ] Object assembly.
- [ ] Runtime requirement handling.
- [ ] Semantic health evaluation.
- [ ] JSX escaping and identifier validation.

### Golden tests

- [ ] Legacy schema-v4 Button output remains unchanged.
- [ ] Dialog structural mismatch.
- [ ] Compound component whose design and code structures do match.
- [ ] Switch with design-only interaction states.
- [ ] Nested optional action object.
- [ ] Runtime callback.
- [ ] Static prop value.
- [ ] Missing optional nested text.
- [ ] Broken required locator.
- [ ] Connected nested instance used as a real component prop.

### UI tests

- [ ] Open Dialog from the component inventory.
- [ ] Upload and replace source.
- [ ] Map direct and nested targets.
- [ ] Mark runtime/static/omitted targets.
- [ ] Review a low-confidence suggestion.
- [ ] Resolve a stale locator.
- [ ] Save and inspect code.
- [ ] Cancel without persisting changes.
- [ ] Preserve focus and keyboard navigation.
- [ ] Verify accessible names and live announcements.

### Integration tests

- [ ] Main-thread descendant extraction with mocked Figma nodes.
- [ ] Plugin-data schema-v5 read/write.
- [ ] Selection changes between root and contributing nested region.
- [ ] Dev Mode and Inspect parity.
- [ ] Semantic component usage inside Layout Composer.
- [ ] Partial extraction and timeout diagnostics.

### Manual Figma verification

- [ ] Light and dark themes.
- [ ] Minimum supported plugin window size.
- [ ] Large resizable window.
- [ ] Component, component set, and instance selections.
- [ ] Nested region selection.
- [ ] Source replacement and reconciliation.
- [ ] Dev Mode code copy.
- [ ] Inspect Code copy.
- [ ] Reload plugin and reopen a saved connection.
- [ ] Open the file with an older plugin build and verify safe failure behavior.

## Implementation map

| Area | Primary files |
| --- | --- |
| Persisted schema and message types | `src/types.ts` |
| Schema validation and migration | `src/codegen.ts`, `src/main.ts`, new semantic schema module |
| Source API extraction | `src/source-schema.ts` |
| Figma semantic extraction | `src/main.ts`, new semantic extractor module |
| Mapping authoring state | `src/mapping-document.ts`, `src/mapping-editor.ts` |
| Mapping UI | `src/mapping-editor-view.tsx`, `src/ui.tsx`, `src/ui.css` |
| UI orchestration | `src/ui-controller.ts`, `src/ui-state.ts` |
| Health and reconciliation | `src/connection-health.ts` |
| Usage IR and JSX generation | `src/codegen.ts`, new semantic resolver/IR modules |
| Inspect and Dev Mode adapters | `src/main.ts`, `src/ui.tsx` |
| Layout Composer integration | `src/layout/figma-component-resolver.ts`, layout golden tests |
| Documentation | `docs/`, `README.md`, `CHANGELOG.md` |

Recommended new modules:

```text
src/semantic/
├── types.ts
├── schema.ts
├── migrate.ts
├── source-contract.ts
├── figma-extractor.ts
├── locators.ts
├── suggestions.ts
├── transforms.ts
├── resolver.ts
├── usage-ir.ts
└── health.ts
```

Avoid moving stable existing code until the new boundaries are proven. Extract
modules incrementally and keep compatibility wrappers during migration.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Nested Figma paths are brittle. | Prefer stable component/property identities, label fallbacks as fragile, and detect ambiguity. |
| The editor becomes too complex. | Keep a source-led single-column flow and hide advanced transforms. |
| Automatic suggestions create false confidence. | Show confidence/reason, require confirmation, never auto-save. |
| Schema-v5 breaks existing codegen. | Dual-read, compatibility compiler, byte-for-byte golden tests. |
| Arbitrary transforms become a security or correctness problem. | Support only declarative validated transforms; never evaluate code. |
| Source parser cannot model a TypeScript API. | Preserve unsupported targets visibly and permit explicit runtime/omitted classification. |
| Metadata becomes too large. | Store bounded descriptors and hashes, enforce size limits, avoid persisting source text/tree dumps. |
| Nested semantic traversal conflicts with Layout Composer. | Keep extraction authoring-only; connected components stay atomic in layout generation. |
| Runtime placeholders are mistaken for production-ready code. | Separate runtime requirements visually and include explicit comments in copied examples. |
| Maintenance becomes manual and noisy. | Stable IDs, fingerprints, review-only drift, explicit reconciliation, and ownership metadata. |

## Explicit non-goals for the first release

- Inferring arbitrary application architecture from Figma.
- Turning every Figma layer into JSX.
- Guessing event-handler implementations.
- Executing arbitrary mapping code.
- Editing the user's repository from Figma.
- Supporting every TypeScript type expression.
- Automatically publishing Figma Code Connect files.
- Automatically choosing between competing public source components.
- Multi-framework output beyond the current React/TSX contract.
- Network-based repository scanning or telemetry.

## Open decisions

Resolved decisions are recorded in
[`semantic-connect-decisions.md`](../semantic-connect-decisions.md); the section
letter is cited below.

- [x] Should a runtime prop be copied as a comment, omitted, or represented in a
      second non-copyable requirements section? → **Both** (inline comment plus
      a separate section). *Decision E.*
- [x] Should static values be first-class in M3 or deferred? → **First-class.**
      *Decision F.*
- [x] What is the maximum supported nested code prop depth? → **Two path
      segments** (one level of nesting). *Decision G.*
- [ ] How should discriminated-union prop objects be authored? → **Still open by
      choice**; surfaced as `unsupported` for now. *Decision N.*
- [x] Can one Figma source feed multiple code prop targets? → **Yes**; a target
      still has exactly one binding. *Decision H.*
- [x] Can multiple Figma sources assemble one array prop in version 1? → **No**;
      arrays stay visibly unsupported. *Decision H.*
- [x] When a nested component has its own connection, who owns the decision to
      inline it versus consume its values? → **The parent recipe decides**: it
      may consume the child's values, or use it as a whole component value via
      the `instance` binding source. *Decision I.*
- [x] Where should explicit semantic roles live: recipe-only metadata, Figma
      plugin data on descendants, or both? → **Recipe only.** *Decision J.*
- [x] Should schema-v5 continue writing legacy `propMappings`, and for how many
      releases? → **Moot**: there is no v5 bump; semantic recipes do not write
      legacy `propMappings`. *Decisions A and C.*
- [x] What compatibility promise applies when a file is opened with an older
      plugin build after a v5 save? → **Degraded output, not corruption or data
      loss** (older builds ignore the unknown recipe field). *Decision B.*

## Recommended first implementation slice

Build the smallest vertical slice that proves the architecture:

1. Add schema-v5 recipe types behind a feature flag.
2. Parse nested source target paths one level deep.
3. Extract explicit nested Figma text/property sources for the Dialog fixture.
4. Author direct, nested, and runtime bindings in the current component-detail
   page.
5. Resolve the recipe into a typed `ComponentUsage`.
6. Generate the approved `ConfirmationDialog` TSX in both Dev Mode and Inspect.
7. Migrate one schema-v4 fixture and prove output compatibility.
8. Add health checks for a removed nested source and a renamed source prop.

Do not begin with generalized arbitrary transforms or a reusable semantic role
system. Prove the Dialog flow end to end, then generalize from tested patterns.

### Slice status (2026-07-24)

Implemented in `src/semantic/` behind `SEMANTIC_CONNECT_AUTHORING_ENABLED`
(off; nothing is wired into the plugin runtime yet):

1. ~~Recipe types and schema-v5 validation~~ — `types.ts`, `schema.ts`,
   `flags.ts`.
2. ~~Nested source target paths one level deep~~ — `source-contract.ts`
   (visual/event/node/excluded/unsupported classification, optional-parent
   tracking).
3. ~~Nested Figma text/property extraction~~ — `figma-extractor.ts` (bounded
   traversal, fragile-locator marking, partial results with diagnostics,
   connected-instance boundary).
4. ~~Authoring UI (first pass)~~ — `src/semantic/authoring.ts` (pure draft/
   suggestion/validation model) + `src/semantic-editor-view.tsx`
   (**Implementation mapping** section, flag-gated by
   `SEMANTIC_CONNECT_AUTHORING_ENABLED`, currently on for local development).
   Uploading source now also builds a semantic recipe draft: code targets are
   the primary column grouped into Content / Variants & states / Actions /
   Slots / Application behavior; each target has one control offering
   type-compatible Figma values (top-level and nested, fragile ones flagged),
   Static value, Set in application, and Omitted; suggestions carry reasons
   (`confirmAction.label` → `Footer / Primary action / label` via the synonym
   dictionary); required unresolved visual targets block save while runtime
   callbacks do not; an inline preview renders from captured sample values.
   Still pending from M3: reconciliation UI for semantic locators, replace-
   source confirmation for invalidated bindings, accessibility audit.
5. ~~Typed `ComponentUsage` resolution~~ — `resolver.ts`, `usage-ir.ts`
   (object assembly, runtime placeholders, per-target explanations).
6. ~~Dev Mode and Inspect wiring with parity~~ — `ConnectionMetadata` gains an
   optional `semanticRecipe` (still schema v4; validated on read/save),
   `main.ts` resolves both surfaces through one `createConnectedOutput`
   pipeline using the selected node's own subtree (instance overrides win),
   and `figma-adapter.ts` bridges Figma nodes to the pure extractor shape.
   Inspect and Dev Mode show **Set in application** and **Why this
   structure?** separately from mapping diagnostics. Runtime props emit
   `prop={undefined /* Set in application. */}` so copied TSX stays valid —
   revisit under Open decisions. Layout Composer / frame-inspection now route
   semantic connections through the shared resolver too (see M4 Layout Composer
   compatibility) — nested values from the recipe's captured snapshot, live
   top-level variant props from the instance.
7. ~~Schema-v4 migration with output compatibility~~ — `migrate.ts`
   (`PropMappings` round-trip proven against `compileMappingDocument`).
8. ~~Health checks for removed nested sources and renamed source props~~ —
   `health.ts`.

Verified end to end in a real Figma file on 2026-07-24 (built a Dialog fixture,
uploaded matching source, confirmed suggestions + Inspect/Dev Mode parity).
A second pass against a real production component (`InfoModalProps` ↔ Figma
`Dialogbox`) surfaced source-parser gaps now tracked under
[M2 source-contract robustness](#m2-source-contract-robustness-real-world-gaps);
those are the current top priority — the generation pipeline is proven, but the
parser cannot yet model an inheriting, alias-heavy real-world interface.
