# Semantic Connect Roadmap

Status: Proposed  
Last updated: 2026-07-23  
Companion preview:
[`semantic-connect-preview.html`](../prototypes/connect-components-preview/semantic-connect-preview.html)

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
- [ ] Record decisions in a dedicated ADR or decisions section in this document.

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
- [ ] Confirm before replacing uploaded source when doing so would invalidate
      bindings.

### Accessibility

- [ ] Maintain keyboard-operable tabs and form controls.
- [ ] Give every mapping control a unique accessible name.
- [ ] Announce validation, save, and reconciliation results.
- [ ] Preserve focus when returning to the component inventory.
- [ ] Verify focus order with advanced sections collapsed and expanded.
- [ ] Meet WCAG 2.2 AA contrast for statuses and interactive controls.
- [ ] Respect reduced-motion preferences.

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

- [ ] Introduce a typed value IR for component props:
  - primitive literal;
  - nested object;
  - connected component usage;
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

- [ ] Feed resolved semantic component usage into Layout Composer's existing
      component boundary.
- [ ] Do not expose internal semantic Figma locators to layout traversal.
- [ ] Confirm nested design regions never become additional layout nodes.
- [ ] Add a golden layout fixture containing a semantically connected Dialog.

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

- [ ] Match by stable identity before attempting rename heuristics.
- [ ] Present suggested remaps separately from confirmed bindings.
- [ ] Never auto-delete stale bindings.
- [ ] Provide explicit **Remove stale mapping** actions.
- [ ] Provide a one-click safe rename migration when identity and type match.
- [ ] Save reconciliation only after explicit confirmation.
- [ ] Record revision and validation time only after a successful save.
- [ ] Keep a pre-save in-memory snapshot so cancel restores the previous recipe.

### Ownership and lifecycle

- [ ] Add optional owner/team metadata.
- [ ] Add optional component package/version metadata.
- [ ] Add connection lifecycle state:
  - draft;
  - connected;
  - needs review;
  - deprecated.
- [ ] Add replacement guidance for deprecated source components.
- [ ] Show deprecation guidance in Inspect without preventing code access.
- [ ] Decide whether multiple source API versions can coexist temporarily.
- [ ] Document the supported plugin/schema compatibility matrix.

### Recovery and supportability

- [ ] Add an exportable redacted connection-debug bundle.
- [ ] Include schema version, hashes, diagnostics, and health state.
- [ ] Exclude source text, private URLs, customer content, and credentials.
- [ ] Provide human-readable recovery messages for unsupported future schemas.
- [ ] Document manual recovery for malformed or legacy metadata.

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

- [ ] Should a runtime prop be copied as a comment, omitted, or represented in a
      second non-copyable requirements section?
- [ ] Should static values be first-class in M3 or deferred?
- [ ] What is the maximum supported nested code prop depth?
- [ ] How should discriminated-union prop objects be authored?
- [ ] Can one Figma source feed multiple code prop targets?
- [ ] Can multiple Figma sources assemble one array prop in version 1?
- [ ] When a nested component has its own connection, who owns the decision to
      inline it versus consume its values?
- [ ] Where should explicit semantic roles live: recipe-only metadata, Figma
      plugin data on descendants, or both?
- [ ] Should schema-v5 continue writing legacy `propMappings`, and for how many
      releases?
- [ ] What compatibility promise applies when a file is opened with an older
      plugin build after a v5 save?

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
