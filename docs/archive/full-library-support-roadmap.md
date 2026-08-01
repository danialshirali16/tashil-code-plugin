# Full-Library Support Roadmap

Status: Archived
Last updated: 2026-08-01

Scope: `@tashilcar/swiss-army-knife`

## Objective

Extend the component-connection workflow so every public Swiss Army Knife
component can expose an accurate source contract and generate valid,
production-shaped TSX from a reviewed Figma mapping.

Full-library support does **not** mean deriving application data or business
logic from Figma. It means:

- The plugin finds the correct public props type for every exported component.
- Every prop is classified accurately as design-derived, fixed, runtime,
  intentionally left out, or unsupported with a clear reason.
- Supported design values generate type-correct JSX.
- Complex runtime values receive explicit, useful placeholders instead of
  incorrect literals.
- Connected nested components, slots, and icon swaps preserve their production
  component identity.
- Dev Mode, Inspect Code, preview, and Layout Composer produce the same result.

## Baseline

The source audit covered all 49 exports from the package's public `src/index.ts`.

| Coverage | Count | Current meaning |
|---|---:|---|
| Strong | 10 | Most public visual props are available |
| Partial | 28 | Useful props are available, but important features are missing |
| Blocked | 9 | No reliable or useful source contract is extracted |
| Not applicable | 2 | Runtime provider/context exports, not Figma components |

### Strong coverage today

- `Alert`
- `TashilHelperText`
- `TashilToast`
- `TashilSwitch`
- `Switch`
- `LicensePlateInput`
- `Checkbox`
- `Icon`
- `Radio`
- `RadioGroup`

### Partially supported today

- `TashilAuthentication`
- `Drawer`
- `TashilBadge`
- `TashilCheckout`
- `TashilDatePicker`
- `TashilDesktopModal`
- `TashilDropdown`
- `TashilInfoModal`
- `TashilTextInput`
- `TashilMenu`
- `TashilNumberInput`
- `TashilOtpInput`
- `TashilRadio`
- `TashilSlider`
- `TashilTab`
- `TashilUpload`
- `TashilNewMessage`
- `TashilJalaliDatePicker`
- `Sessions`
- `Button`
- `TextInput`
- `NumberInput`
- `Slider`
- `TashilCheckbox`
- `TashilStepper`
- `SingleFilePreview`
- `Countdown`
- `Text`

### Blocked today

- `TashilBreadcrumb`
- `TashilDataGrid`
- `TashilDataGridPro`
- `TashilGrid`
- `TashilMobileDrawer`
- `TashilPopover`
- `IconSymbols`
- `TashilTooltip`
- `Pagination`

### Out of Figma-connection scope

- `TashilThemeContext`
- `TashilThemeProvider`

These should remain available to application code but should not count against
visual component coverage.

## Product principles

- [ ] The exported component declaration is the source of truth.
- [ ] Never select an unrelated `Props` interface as a fallback.
- [ ] Never emit a value that contradicts the declared prop type.
- [ ] Treat application state, callbacks, data collections, and files as
      runtime inputs.
- [ ] Keep suggestions reviewable; do not silently connect uncertain values.
- [ ] Prefer explicit diagnostics over incomplete or fictional code.
- [ ] Preserve existing saved recipes and schema-v4 connections.
- [ ] Keep generated code deterministic and safe to paste into TypeScript.
- [ ] Use one resolver for preview, Inspect Code, Dev Mode, and Layout Composer.

## Target support model

Each prop must resolve to exactly one support mode:

| Mode | Meaning | Example |
|---|---|---|
| Figma property | Exposed variant, boolean, text, or instance swap | `size`, `disabled` |
| Nested Figma value | Nested text or exposed nested property | modal title |
| Connected component | A nested connected instance supplies a React node | leading icon |
| Fixed value | A literal authored in the connection | `variant="solid"` |
| Runtime value | Application code must supply it | callbacks, rows, files |
| Left out | Intentionally not emitted | `className` |
| Unsupported | Parser cannot safely represent it yet | unresolved generic |

An unsupported prop must include a diagnostic explaining the missing capability.

## Milestone 0 — Freeze the audit baseline

Goal: turn the one-time component audit into a repeatable compatibility test.

Status: Completed

### Deliverables

- [x] Add a manifest of all public component exports.
- [x] Add a source-contract selection fixture for each export.
- [x] Run the actual source parser against every fixture in CI.
- [x] Record selected props type, warnings, target kinds, and unsupported props.
- [x] Fail CI when a component silently selects a different props type.
- [x] Distinguish visual components from providers, contexts, and utilities.

Implementation:

- `src/semantic/library-compatibility.ts` contains the typed 49-export
  compatibility baseline and reusable audit helpers.
- `src/semantic/library-compatibility.test.ts` protects support totals, public
  export coverage, props-interface selection, target categories, warning
  categories, unsupported paths, and provider/context classification.
- `scripts/audit-library-compatibility.mjs` discovers exports from the real
  package barrel, loads each component's source files, and fails on export,
  module, parser-selection, target-kind, warning, or unsupported-path drift.
- Run the real-source audit after checking out both repositories:

  ```sh
  SWISS_ARMY_KNIFE_ROOT=/path/to/packages/swiss-army-knife \
    npm run audit:library
  ```

  The same path can be passed explicitly with
  `npm run audit:library -- --package-root /path/to/swiss-army-knife`.

### Acceptance criteria

- [x] CI reports coverage for all 49 currently audited public exports.
- [x] Adding or removing a package export fails the real-source audit.
- [x] A fallback to an unrelated interface is a test failure, not a warning.

## Milestone 1 — Resolve the real public props type

Goal: stop relying on an interface named exactly
`${ComponentName}Props`.

Status: Completed

### Required parser capabilities

- [x] Read `type` aliases as root prop contracts.
- [x] Read local intersections such as:

  ```ts
  type TextProps = OwnProps & React.HTMLAttributes<HTMLElement>;
  ```

- [x] Support alternative names such as:
  - `ICountdownProps`
  - `StepperPropsType`
  - `MobileDrawerPropsType`
  - `checkboxPropsType`
  - local `Props` aliases
- [x] Infer props from component declarations:

  ```ts
  const Checkbox: React.FC<Props> = ...
  function Button(props: ButtonProps) ...
  forwardRef<HTMLButtonElement, ButtonProps>(...)
  ```

- [x] Follow default and named exports back to their implementation declaration.
- [x] Resolve local re-exports and barrel files.
- [x] Show the inferred relationship in the UI:

  ```text
  Button export → ButtonProps
  ```

Implementation progress:

- `src/source-props.ts` now provides one shared declaration selector and local
  member resolver for both visual and semantic source parsing.
- Selection supports interfaces, type aliases, local intersections,
  `React.FC<T>`, `FunctionComponent<T>`, annotated function parameters,
  `forwardRef` callbacks, alternative props names, and file-scoped local
  `Props` aliases.
- The mapping header displays the resolved relationship, such as
  `Checkbox → Props` or `Text → TypographyProps`.
- The compatibility baseline improved from 6 strong / 23 partial / 18 blocked
  to 10 strong / 28 partial / 9 blocked.
- Named exports, default aliases, `export *` chains, extensionless module
  paths, directory indexes, and circular barrels are resolved locally without
  executing source.
- External package re-exports such as
  `TashilGrid → @mui/material/Grid` intentionally move to Milestone 2 because
  they require dependency type information.

### Components with resolved props selection

- `Countdown`
- `Checkbox`
- `Icon`
- `IconSymbols`
- `Radio`
- `RadioGroup`
- `Text`
- `TashilCheckbox`
- `TashilMobileDrawer`
- `TashilStepper`
- `SingleFilePreview`

`IconSymbols` and `TashilMobileDrawer` now select the correct contract but
remain blocked until their unsupported/imported types are resolved.

### Acceptance criteria

- [x] Every visual export with a locally declared props contract selects it.
- [x] `SingleFilePreview` never falls back to `TashilUploadProps`.
- [x] Type aliases and interfaces generate the same source-target model.

## Milestone 2 — Type-checker-backed dependency resolution

Goal: resolve inherited and imported props instead of only parsing local AST
syntax.

Status: Completed

### Deliverables

- [x] Build a local TypeScript `Program` from uploaded files.
- [x] Use the TypeScript type checker to resolve:
  - imported local interfaces and aliases;
  - local `extends` and intersections;
  - `Pick`, `Omit`, `Partial`, and `Required`;
  - local generic instantiations.
- [x] Resolve React intrinsic and DOM props when their declaration tree is
  included with the source input.
- [x] Resolve uploaded package dependency declaration trees, including
  `node_modules/@types` package fallback.
- [x] Add a bounded source-bundle/folder collection flow so the UI can gather
  dependency declarations without flattening their paths.
- [x] Preserve the declaring source file for every resolved prop.
- [x] Detect circular aliases and recursive object types safely.
- [x] Cache parsed dependency graphs by content hash.
- [x] Report missing dependency files without discarding locally declared props.

### Implementation progress — 2026-07-29

- Both source-schema parsers now consume the same checker-resolved root member
  model and retain the AST resolver as a compatibility fallback.
- Programs are execution-free, contain only uploaded source and built-in utility
  declarations, and are cached by source content hash.
- Concrete generic substitutions and mapped-type requiredness now flow into
  generated source targets.
- Missing imported dependencies produce scoped warnings while local members
  remain available.
- The real-library audit remains green at 49 exports. Checker resolution
  improved `TashilDropdown` from 19 to 14 unsupported targets and identified
  three additional event targets.
- Uploaded declaration paths are now preserved through
  `File.webkitRelativePath`. The virtual resolver recognizes declaration trees
  below any uploaded `node_modules` root and maps imports such as `react` to
  `@types/react`.
- Dependency declarations are excluded from component/props selection, so a
  package's similarly named contract cannot replace the uploaded component's
  own public API.
- Both mapping editors expose a secondary folder picker. Collection preserves
  `webkitRelativePath`, ignores non-TypeScript files, rejects unsafe or
  duplicate paths, and enforces limits of 512 files, 1,000,000 characters per
  file, and 8,000,000 total characters before parsing.

### Components improved

- `Button`
- `TashilNumberInput`
- `NumberInput`
- `TashilDataGrid`
- `TashilDataGridPro`
- `TashilPopover`
- `TashilTooltip`
- `Pagination`
- `Slider`
- `TashilBreadcrumb`

### Acceptance criteria

- [x] Inherited local public props appear once, with correct required status.
- [x] Missing MUI or React types produce a scoped diagnostic.
- [x] Local props remain usable even when a dependency cannot be resolved.
- [x] Uploaded dependency props and React DOM defaults resolve end to end.
- [x] The UI collects a bounded declaration dependency closure from a selected
  project or prepared source bundle.

## Milestone 3 — Expand the source-target type system

Status: Completed

Goal: represent the full public API without forcing complex props into primitive
mapping controls.

### New target kinds

- [x] Primitive: string, number, boolean.
- [x] Literal union and enum.
- [x] React node and component slot.
- [x] Callback/event.
- [x] Date and serializable scalar object.
- [x] Array/collection.
- [x] Record/object.
- [x] Controlled value.
- [x] File/browser object.
- [x] Render function/component type.
- [x] Framework styling/system prop.

### Object support

- [x] Replace the current one-level object limit with recursive typed paths.
- [x] Preserve optional-object boundaries.
- [x] Support array item schemas without pretending Figma supplies full arrays.
- [x] Allow a whole object to be marked runtime-provided.
- [x] Allow selected safe object leaves to be mapped from Figma.

### Implementation progress

- Added explicit `array`, `record`, `date`, `file`, `render`, and `styling`
  source-target kinds.
- Required complex targets default to a reviewed runtime binding and block save
  if that decision is removed.
- Runtime previews preserve the source type in their requirements and generate
  an actionable `undefined /* Set in application. */` placeholder.
- Object targets now support bounded recursive paths up to eight segments;
  recursive aliases terminate as an explicit runtime record instead of
  expanding forever.
- Arrays, tuples, sets, and maps preserve bounded item/key/value schemas while
  the collection itself remains application-provided.
- Top-level state props are classified as `controlled` only when a compatible
  public callback is present; the contract records that callback relationship
  and defaults the state value to application runtime wiring.
- Re-audited all 49 public exports with zero baseline drift:
  - Strong: 10
  - Partial: 30
  - Blocked: 7
  - Not applicable: 2
- The audit now identifies 18 array, 11 record, 8 render, 4 styling, and 1 file
  targets that were previously mixed into `unsupported`.
- The audit identifies 13 controlled values across checkbox, modal, dropdown,
  number input, radio, slider, and switch APIs.

### Acceptance criteria

- [x] No public prop is classified as `unsupported` merely because it is an array,
  record, date, file, or nested object.
- [x] Complex props default to runtime rather than invalid JSX.
- [x] The generated placeholder remains type-correct and clearly actionable.

## Milestone 4 — Runtime inputs and controlled components

Status: Completed

Goal: generate useful scaffolding for behavior that cannot come from Figma.

### Runtime categories

- [x] Callbacks:
  - `onChange`
  - `onClick`
  - `onSubmit`
  - `onClose`
- [x] Controlled state:
  - `value`
  - `open`
  - `checked`
  - active selections
- [x] Collections:
  - dropdown options;
  - menu items;
  - tabs;
  - data-grid rows and columns;
  - sessions;
  - upload files.
- [x] Environment/framework values:
  - themes;
  - typography;
  - MUI slots;
  - transition components;
  - Popover anchors.

### Generated output

Default Inspect Code should remain a usage snippet:

```tsx
<TashilDropdown
  options={options /* Set in application. */}
  value={value /* Set in application. */}
  onChange={onChange /* Set in application. */}
/>
```

Optional advanced output may generate a runnable example with local state, but
it must be a separate action and never replace the default usage snippet.

### Implementation progress

- Runtime JSX now uses deterministic named placeholders derived from target
  paths instead of `undefined`.
- Top-level values keep their public prop names (`options`, `value`,
  `onChange`); nested paths use safe camel-cased identifiers.
- Reserved words and identifier collisions receive deterministic safe names.
- Runtime requirement records include the exact placeholder, source target
  path, and source type.
- Recognizable themes, typography, Popover anchors, MUI transition/paper
  configuration, component constructors, and nested `componentsProps` are
  explicit environment or render targets rather than parser failures.
- The real-library audit removed five unsupported modal targets, three
  dropdown targets, and one slider target without weakening unknown-type
  handling.
- The default remains a usage snippet. No local state or fictional application
  behavior is generated automatically.

### Acceptance criteria

- [x] Required runtime values never block saving a valid connection.
- [x] Runtime requirements appear separately from mapping errors.
- [x] Generated code never uses `undefined` where a clearer named placeholder is
  available.

## Milestone 5 — React nodes, slots, and instance composition

Goal: support components whose public API is assembled from nested components.

Status: Completed

### Deliverables

- [x] Generalize connected nested-instance mapping beyond Button icons.
- [x] Support ReactNode, ReactElement, and arrays of React elements.
- Support component props such as:
  - [x] leading/trailing adornments;
  - [x] action buttons;
  - [x] modal content;
  - [x] tab content;
  - [x] custom empty states;
  - [x] upload previews.
- [x] Preserve nested component imports.
- [x] Preserve nested component props and selected instance-swap identity.
- [x] Add explicit ordering for repeated slots.
- [x] Detect incompatible connected child components when the source type
  declares an explicit component constraint.
- [x] Keep connected children atomic for Layout Composer.

### Implementation progress — 2026-07-29

- Live semantic trees now carry a connected child's validated semantic recipe
  without copying that recipe into the parent's persisted snapshot.
- A connected child resolves through its own recipe before it is emitted into a
  parent React-node slot. This preserves mapped child props and named runtime
  placeholders for non-icon compositions such as a Dialog action Button.
- Nested imports are merged into the parent usage and deduplicated across the
  whole expression.
- Child explanations, runtime requirements, and issues are retained with the
  parent slot path as a prefix, so nested behavior remains inspectable.
- Resolution is bounded to the shared semantic locator depth. Older child
  connections without semantic recipes continue to use the existing atomic
  component and icon-name fallback.
- Regression coverage proves a connected `Button` can populate a Dialog
  `footerAction` slot as a real component expression with its selected
  `variant` and runtime `onClick`.
- Live semantic trees now resolve `INSTANCE_SWAP` property ids on each nested
  instance into the selected component id and name. A child recipe receives
  only that exact instance's swap map, preventing parent or sibling swap
  identities from leaking into its generated props.
- Regression coverage proves a connected nested `Button` whose exposed
  `leadingIcon` is swapped to `Trash` generates
  `renderLeftIcon={<Icon name={"trash"} />}` and preserves the required
  `Button` and `Icon` imports.
- Explicit React element constraints such as
  `ReactElement<ButtonProps, typeof Button>` now flow through authoring and
  resolution. Matching connected children are ranked as compatible;
  incompatible children are flagged, block saving, and are never emitted.
- Plain `ReactNode`, `ReactElement`, and `JSX.Element` remain intentionally
  open slots because their source types do not declare a component identity.
- Array targets whose item schema is a React node/element can now bind up to 16
  connected nested instances as one ordered source. Recipes persist stable
  locators, component identities, imports, and the authored order.
- The mapping inspector exposes checkboxes for membership plus explicit move-up,
  move-down, and remove controls. Generated code emits a deterministic JSX
  array and merges each child's own semantic recipe and imports.
- Health checks report fragile or removed repeated-slot items individually.
  Locator keys now include the nested main-component key when available, so
  same-named sibling instances remain distinct.
- Collection schemas now expose React-node fields inside object-valued items
  without expanding ordinary runtime records. This models the real
  `TashilTab.components` API while keeping `Item[]` and map values unchanged.
- Repeated slot recipes persist the item field path and generate ordered object
  entries such as
  `components={[{ component: <SecurityPanel /> }, { component: <AccountPanel /> }]}`.
  The same selection, reorder, import, health, and nested-recipe behavior used
  by direct React-element arrays is retained.
- The Swiss Army Knife Dropdown declares `clearIcon`, `popupIcon`, and
  `noOptionsText` as `Node`. Exact `Node` type references are now classified as
  component slots alongside `ReactNode` and `ReactElement`, allowing custom
  empty states to generate as connected JSX such as
  `noOptionsText={<DropdownEmptyState />}`.
- The Swiss Army Knife upload API exposes `SingleFilePreview` as a standalone
  component rather than a React-node prop on `TashilUpload`. Its
  `SelectedItemProps` contract is selected directly: `status`, `size`, and
  `fileId` can come from Figma, while `file` and the required `onRemove` and
  `onRetry` callbacks remain explicit application inputs. Callers may leave the
  optional `file` out when the design supplies `fileId`.
- The standalone `Icon` source contract now preserves the complete
  `IconNames` literal union on its required `name` target. Direct Icon
  connections generate `<Icon name={...} />`, while a stale live Figma value
  outside the uploaded catalog is omitted with a precise resolution issue.
- Icon-name enforcement is intentionally scoped to the standalone `Icon`
  target. Fixed values on other components remain open-ended; validating names
  synthesized from nested instance swaps still depends on the package-owned
  catalog and alias work below.
- Synthesized swap names use direct normalization only: camel-case names become
  kebab-case (`ChevronLeft` → `chevron-left`) and the leading Figma component
  namespace is removed (`Icon / Trash` → `trash`). No direction metadata or
  package alias is inferred.

### Icon support

- [x] Connect the standalone `Icon` component directly.
- Icon rotation/direction is intentionally not inferred. The public `IconProps`
  contract has no direction, rotation, or style prop, and the agreed mapping
  preserves direct component names without retaining synthetic direction
  metadata. Consumers that need rotation can set the library-supported
  `className` in application code.

### Acceptance criteria

- [x] A connected slot generates a real component expression, never a boolean.
- [x] Required imports are deduplicated.
- [x] Slot output is identical in preview, Inspect Code, Dev Mode, and layout
  output because all four consume the same semantic resolver result.

## Milestone 6 — Complex component recipes

Goal: provide intentional workflows for components whose API cannot be inferred
from one Figma instance alone.

Status: Completed (2026-08-01)

### Recipe families

#### Data-driven components

- [x] `TashilDataGrid`
- [x] `TashilDataGridPro`
- [x] `TashilDropdown`
- [x] `TashilMenu`
- [x] `TashilTab`
- [x] `Sessions`
- [x] `Pagination`

Required support:

- design-derived appearance and state;
- runtime rows/options/items;
- named runtime placeholders;
- optional sample-data generation in a separate preview mode.

### Implementation progress — 2026-07-29

- Complex-component defaults now live in a declarative recipe registry rather
  than resolver JSX branches.
- The first recipe covers `TashilDropdown`: required `options` plus the useful
  controlled `value` and `onChange` inputs are named application placeholders.
  Optional advanced callbacks, render functions, and object overrides start as
  `Left out`, while appearance targets such as `size` continue to map from
  Figma. Users can still opt into any omitted target in the editor.
- `TashilMenu` now defaults `options`, `handleClose`, inherited `anchorEl`, and
  inherited `open` to named application placeholders. Search presentation can
  still come from Figma, while optional MUI event and object overrides start as
  `Left out` and remain available for explicit opt-in.
- `TashilTab` models its two public content APIs as mutually exclusive. It
  starts with runtime `items`; selecting ordered connected `components`
  automatically leaves `items` out, so generated code never supplies both
  branches of the library component's render logic.
- `Sessions` defaults its collection, optional active-session record, required
  application name, and delete callbacks to named runtime placeholders. The
  recipe can intentionally treat `appName` as runtime even though its source
  type is a plain string; loading and secondary-title flags remain Figma-owned.
- `Pagination` defaults `count`, controlled `page`, and `onChange` to runtime
  placeholders while appearance stays design-derived. `page` and `defaultPage`
  form an exclusive controlled/uncontrolled pair; selecting one automatically
  leaves the other out.
- `TashilDataGrid` was checked against the wrapper's inherited
  `@mui/x-data-grid@5.17.2` declarations. `rows` and `columns` are its required
  application data; optional identifiers, controlled selection, callbacks, and
  render hooks remain available for explicit opt-in instead of being emitted by
  default.
- `TashilDataGrid` defaults required `rows` and `columns` to named runtime
  placeholders. Optional selection state, callbacks, render hooks, and MUI
  overrides start as `Left out`; loading and selection appearance remain
  Figma-derived. The recipe applies after the uploaded bundle resolves the
  inherited `@mui/x-data-grid` declarations.
- `TashilDataGridPro` defaults its required `rows` and `columns` to named
  runtime placeholders after resolving the inherited
  `@mui/x-data-grid-pro@6.9.1` declarations. Its v6 row-selection controls and
  Pro-only tree, detail, pinning, and event hooks begin as `Left out`, while
  visual flags remain available for Figma mapping.

#### Form and authentication components

- [x] `TashilAuthentication`
- [x] `TashilCheckout`
- [x] `TashilOtpInput`
- [x] `TashilUpload`
- [x] `TashilNewMessage`

Required support:

- controlled values and callbacks;
- validation state;
- file/runtime inputs;
- nested field components;
- form-specific diagnostics.

### Form recipe progress — 2026-08-01

- `TashilAuthentication` treats `pageState`, `childProps`, and `onBack` as
  application-owned workflow inputs while content and presentation remain
  Figma-derived. The extractor now preserves the heterogeneous `PagesProps`
  union as one runtime record, so challenge-specific submit, OTP, loading, and
  validation fields are never flattened into an invalid combined object.
- `TashilCheckout` keeps `checkoutData`, `banks`, `defaultBank`, `onBack`, and
  `onSubmit` as named application inputs. The component continues to own bank
  selection after its initial value, and the recipe leaves `totalAmount` out by
  default so the source component can derive it from checkout rows.
- `TashilOtpInput` keeps `values`, `onChange`, and `onComplete` as named runtime
  inputs. Error/helper/loading/disabled/size state remains design-derived, and
  optional array overrides such as `placeholder` begin as `Left out`.
- `TashilUpload` keeps `files`, `onChangeFiles`, `onRetry`, and `onRemove` as
  named runtime inputs so its controlled file list stays synchronized. Upload
  text and validation/sending/required/size state remain Figma-derived;
  `onRejectFiles` begins as `Left out` because built-in feedback still works.
- `TashilNewMessage` keeps inherited attachment state/actions plus `onSubmit`
  as named runtime inputs. Composer copy, attachment visibility, sending state,
  and close-ticket presentation remain Figma-derived. Declarative omitted
  targets prevent `textInputProps.value` and `textInputProps.onChange` from
  being emitted because the source implementation overwrites both.

#### Overlay components

- [x] `Drawer`
- [x] `TashilDesktopModal`
- [x] `TashilInfoModal`
- [x] `TashilMobileDrawer`
- [x] `TashilPopover`
- [x] `TashilTooltip`

Required support:

- open/close state;
- trigger/anchor runtime values;
- content and action slots;
- transition/framework props kept runtime or left out.

### Overlay recipe progress — 2026-08-01

- `Drawer` keeps `open`, `onClose`, content, and action-button collections in
  application code. Drawer appearance remains Figma-derived; MUI paper/modal
  overrides begin as **Left out**.
- `TashilDesktopModal` keeps visibility, close handling, and modal content in
  application code. Full-screen, width, scrolling, and escape-key appearance
  remain available for Figma mapping; paper and transition customization begin
  as **Left out**.
- `TashilInfoModal` keeps visibility plus submit/cancel behavior and custom
  action-button collections in application code. Title, description, mode,
  loading, button visibility, sizes, and other presentation state remain
  Figma-derived; advanced button-prop objects begin as **Left out**.
- `TashilMobileDrawer` keeps visibility, close handling, and content in
  application code. Backdrop and drawer presentation remain Figma-derived;
  MUI modal, paper, and slide overrides begin as **Left out**.
- `TashilPopover` keeps visibility, close handling, anchor element, and content
  in application code. Portal/appearance flags remain Figma-derived; origin,
  paper, and transition objects begin as **Left out**.
- `TashilTooltip` keeps its required trigger and default tooltip content in
  application code. Arrow, placement, and interaction appearance remain
  Figma-derived. Optional controlled-open callbacks stay **Left out** so the
  default hover/focus behavior is not accidentally converted to controlled
  state.
- The recommendations are declarative entries in
  `src/semantic/complex-recipes.ts`; resolver JSX has no overlay-specific
  branches. `src/semantic/complex-recipes.test.ts` protects all six defaults
  and production-shaped Popover placeholder generation.

#### Date and range components

- [x] `TashilDatePicker`
- [x] `TashilJalaliDatePicker`
- [x] `TashilSlider`
- [x] `Slider`

Required support:

- date/range runtime values;
- Figma-derived appearance;
- controlled-state placeholders;
- safe formatting of dates and numeric arrays.

### Date and range recipe progress — 2026-08-01

- `TashilDatePicker` keeps required date-change and submit callbacks in
  application code. Copy, bounds, direction, disabled/required state, and
  validation appearance remain Figma-derived. The optional initial date leaves
  begin as **Left out** because the component owns its selected date after
  initialization.
- `TashilJalaliDatePicker` keeps single-date/range change callbacks and action
  callbacks in application code. Picker mode, copy, open/error/reset state,
  and visual sizing remain Figma-derived. Initial single and range dates begin
  as **Left out** to avoid inventing serialized date objects from a Figma
  instance.
- `TashilSlider` and `Slider` keep the controlled `value` and `onChange` in
  application code while bounds and appearance remain Figma-derived.
  `defaultValue` and `marks` begin as **Left out**; explicitly selecting
  `defaultValue` automatically leaves `value` out so generated code never mixes
  the controlled and uncontrolled APIs. Number-array values stay named runtime
  placeholders instead of being formatted as unsafe source literals.
- These recommendations are declarative entries in
  `src/semantic/complex-recipes.ts`; resolver JSX has no date- or slider-specific
  branches. `src/semantic/complex-recipes.test.ts` protects all four defaults,
  controlled/uncontrolled exclusivity, and generated slider placeholders.

### Acceptance criteria

- [x] Every complex component has a documented recommended mapping strategy.
- [x] The editor chooses suitable defaults by prop category.
- [x] Component-specific behavior is implemented through declarative recipes, not
  hard-coded JSX branches.

## Milestone 7 — Editor and diagnostics

Status: Completed (2026-07-30)

Goal: make expanded support understandable without making the default workflow
overwhelming.

### Deliverables

- [x] Display the resolved props source and inheritance chain (2026-07-30).
      `SourceContract.propsTypeChain` carries resolved base-type names, captured
      from whichever extraction path wins: the AST heritage walker accumulates
      them in `source-props.ts`, and the type-checker path adds a best-effort
      `collectLocalBaseTypeNames` (`getBaseTypes`, local interfaces only). The
      two results are merged so transitive, alias, and uploaded dependency bases
      discovered by the AST walk are not lost when type-checker extraction wins. The
      semantic Connect editor renders `Component → propsTypeName → BaseA → BaseB`
      in the source header. No schema-version bump — the permissive
      `isPersistedSourceContract` tolerates the new optional field, so existing
      connections load unchanged (chain absent). Legacy mapping editor
      intentionally unchanged (separate `SourceComponentSnapshot` model).
- [x] Group targets into sections (content, variants & states, actions,
      application data, slots, application behavior, excluded by policy).
      Derived in `getTargetSection` (`src/semantic/authoring.ts`) and rendered
      with `.mapping-section-label` dividers in `SemanticMappingView`.
- [x] Show why a value is runtime-only or unsupported (2026-07-30).
      `targetKindReason(kind)` in `src/semantic/source-contract.ts` returns a
      per-kind human reason drawn from the same intent as the `SourceTargetKind`
      JSDoc. `PropInspector` now shows it for excluded, unsupported, and every
      runtime/framework kind (event, array, record, date, file, render, styling,
      controlled, environment), replacing the two previous fixed strings.
- [x] Show the expected TypeScript type beside every editor — `target.typeName`
      renders in both `PropRow` and `PropInspector` via `<code class="prop-type">`.
- [x] Add structured editors for safe objects and arrays (2026-07-30).
      Array-of-nodes slots have a full structured editor (`RepeatedSlotEditor`
      with checkbox selection + ordering); safe object leaves flatten into their
      own mappable targets (`confirmAction.label`); and the collection's item
      shape is visible in the inspector via `summarizeCollectionItemSchema`
      (`src/semantic/source-contract.ts`), rendering object-like
      `{ id: string, label: string }` and Record-like `{ [key]: value }`.
      **By design** (M3 decision): a whole array/record stays application-
      provided and is *not* broken into per-leaf Figma bindings — Figma cannot
      supply a full array, so per-item scalar mapping would be fictional
      coverage (see Risks §"False confidence"). The collection emits a named
      runtime placeholder instead.
- [x] Add searchable runtime-placeholder names (2026-07-30). The Connect editor
      gained a `SearchTextbox` above the code-prop list that filters rows by a
      case-insensitive substring across target path, type name, and the resolved
      value label. It composes with the existing All/Review filter, keeps the
      inspector focused on a visible result, and an empty-result search shows a
      distinct "No code props match …" state without a stale inspector.
- [x] Add a compatibility summary before saving (2026-07-30). `validateRecipeDraft`
      now returns a `summary` with counts of unresolved required props, unmarked
      runtime inputs, incompatible slots, total blocking, and review items. The
      Connect editor shows a scannable "Cannot save — …" / "Saveable with …"
      status line above the per-message lists. Required runtime inputs remain
      blocking if an older recipe explicitly omitted them, and repeated-slot
      incompatibilities are counted per slot rather than per child.
      `src/semantic/authoring.ts`, `src/semantic-editor-view.tsx`.
- [x] Export the component compatibility report as Markdown or JSON (2026-07-30).
      `createComponentAuditReport` derives per-kind target counts and unsupported
      paths from the live source contract; the Connect editor exports both
      formats via the established `downloadBlob` path. `src/semantic/audit-report.ts`.

### Acceptance criteria

- A user can connect a complex component without editing JSON.
- The UI never shows an incompatible Figma property as the preferred option.
- Every unresolved required prop has one clear remediation.

## Milestone 8 — Scale, drift, and compatibility

Status: Completed

Goal: make full-library support durable as both Figma and source evolve.

### Deliverables

- [x] Reconcile renamed source props and exported component aliases (2026-08-01).
      Source replacements now enter a pending-contract state. Existing bindings
      receive explicit rename proposals, and a changed exported component alias
      is promoted only through **Accept source update**.
- [x] Detect changed inherited dependency types (2026-08-01). Source targets
      retain their declaration file; changes to targets declared outside the
      selected component file are reported as inherited dependency drift.
- [x] Detect changed array/object schemas (2026-08-01). Reconciliation compares
      deterministic target signatures covering collection item schemas,
      literal values, requiredness, defaults, and controlled-state companions,
      even when the outer TypeScript type text is unchanged.
- [x] Detect stale nested-instance and instance-swap locators (2026-08-01).
      Connected instances and repeated-slot items remap by stable component key;
      nested `INSTANCE_SWAP` property identity and selected component changes
      are persisted and reviewed explicitly.
- [x] Increase or make configurable the current limits where safe (2026-08-01):
  - 64 bindings;
  - two target-path segments;
  - eight locator segments;
  - 400 extracted nodes;
  - 64 nested sources.
      Defaults are now 256 bindings, eight target segments, sixteen locator
      segments, 2,000 extracted nodes, and 256 nested sources. Extraction also
      accepts lower per-scan overrides while schema hard limits remain bounded.
- [x] Provide partial-extraction diagnostics for large component sets
      (2026-08-01). Snapshots persist structured node/depth/source truncation
      diagnostics and the editor reports a partial Figma scan on reopen.
- [x] Preserve old recipes until the user explicitly accepts migration
      (2026-08-01). `pendingSourceContract` is authoring-only; resolution keeps
      the accepted contract and bindings until all drift is resolved and the
      user accepts the source update. Saving is blocked while a contract is
      pending.
- [x] Add recipe schema migrations for every new target kind (2026-08-01).
      Recipe schema v2 has an ordered migration registry. Its v1→v2 migration
      preserves bindings/output while enabling pending contracts, extraction
      diagnostics, and nested instance-swap identity; migrated data is written
      only on explicit save.

### Acceptance criteria

- Updating source never silently deletes a mapping.
- Large components report truncation clearly.
- Existing connections continue to generate their previous output until
  migrated.

## Rollout order

### Wave 1 — Parser unlocks

Target:

- `Checkbox`
- `Radio`
- `RadioGroup`
- `Text`
- `Icon`
- `Countdown`
- `TashilCheckbox`
- `TashilStepper`

Reason: these components are primarily blocked by prop-declaration discovery,
not difficult Figma behavior.

### Wave 2 — Inherited wrappers

Target:

- `Button`
- `TextInput`
- `NumberInput`
- `Slider`
- `Pagination`
- `TashilTooltip`
- `TashilPopover`

Reason: type-checker-backed inheritance should unlock most of their public API.

### Wave 3 — Slots and overlays

Target:

- `Drawer`
- `TashilDesktopModal`
- `TashilInfoModal`
- `TashilMobileDrawer`
- `TashilTab`

Reason: these need generalized React-node composition and controlled runtime
state.

### Wave 4 — Collections and application data

Target:

- dropdowns;
- menus;
- sessions;
- uploads;
- authentication;
- checkout;
- data grids;
- date pickers.

Reason: these require structured runtime inputs and component-specific recipes.

## Verification strategy

### Source-contract tests

- One fixture per public export.
- Interfaces, aliases, intersections, generics, and re-exports.
- Exact exported component-to-props resolution.
- Imported and inherited type resolution.
- Circular and missing dependency diagnostics.

### Mapping tests

- Figma variants, text, booleans, and instance swaps.
- Nested text and exposed nested properties.
- Static, runtime, and left-out values.
- Recursive object assembly.
- Arrays and collections marked runtime.
- Connected slots and imports.

### Generation tests

- Type-correct JSX for every public component.
- No fictional components or prop names.
- Valid imports and identifier escaping.
- Identical preview, Dev Mode, Inspect Code, and Layout Composer output.
- Backwards-compatible output for existing saved connections.

### Required commands

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

## Success metrics

- 100% of visual exports select the correct public prop contract.
- 0 unrelated fallback interfaces.
- 100% of public props receive an explicit support classification.
- 0 required props silently omitted.
- 0 type-incorrect literals in generated code.
- At least 90% automatic source-contract coverage across the library.
- 100% of remaining complex props represented as explicit runtime requirements
  or reviewed exclusions.
- No regressions in existing schema-v4 and semantic connections.

## Risks

### TypeScript dependency size

Loading complete MUI and React type graphs inside the plugin may be expensive.
Mitigate with content-hash caching, scoped dependency loading, and extraction
budgets.

### False confidence

Parsing a prop does not mean Figma can supply it. The UI must distinguish
source support from design-derived support.

### Overfitting to Swiss Army Knife

Component-specific recipes should use declarative metadata and reusable prop
categories. Avoid hard-coding package component names in the resolver unless a
package-owned adapter explicitly requires it.

### Recipe migration

New target kinds and recursive paths change persisted metadata. Add migrations
before enabling the related editor controls.

### Generated runtime code

The default output must remain a component usage snippet. Runnable examples
with state or sample data must be optional and clearly labeled.

## Definition of done

Full-library support is complete when:

- [ ] Every visual public export resolves to its correct source contract.
- [ ] Every public prop has an explicit support mode.
- [ ] Simple visual props map directly from Figma.
- [ ] Complex data and behavior props become explicit runtime requirements.
- [ ] React-node slots generate real connected component expressions.
- [ ] Every component has a valid tested usage fixture.
- [ ] No generated snippet is type-incorrect.
- [ ] Preview, Inspect Code, Dev Mode, and Layout Composer agree.
- [ ] Existing connections remain compatible.
- [ ] The compatibility audit reports no blocked visual components.
