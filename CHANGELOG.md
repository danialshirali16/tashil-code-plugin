# Changelog

All notable changes to Tashil Code are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions track the marketplace publish; there are no git tags — `package.json`
is the version of record.

## [1.0.0] - 2026-07-31

Initial marketplace release. Tashil Code connects a Figma design system to its
production React library: map real component props, generate accurate TSX,
convert layouts into styled-components, and export Figma Variables as CSS tokens.

### Added

- **Local source parsing.** Upload local `.ts`/`.tsx` source to discover a
  component's props, literal-union values, runtime defaults, children, and icon
  slots. Multi-file and drag-and-drop support. Parsing runs locally; original
  source contents are never persisted — only the extracted schema and a content
  hash.
- **Visual Connect Component editor.** A two-sided connect board for mapping
  code props and values to compatible Figma variant, boolean, text, and
  instance-swap properties. First-class label/children and RTL-aware
  leading/trailing icon-slot mappings; mapping progress and incomplete-mapping
  feedback; separate custom wildcard/raw mappings and a read-only generated
  JSON preview.
- **Realistic source-contract parsing.** `extends`/`Omit`/`Pick` heritage,
  imported type aliases, `string | ReactNode` text, and one-level nested/`Omit<…>`
  object props. Unsupported types stay visible instead of being dropped.
- **Semantic connect.** Connect a Figma component to a production React
  component even when the layer structure does not resemble the source API
  (for example a Header/Footer Dialog mapping to a flat `<ConfirmationDialog>`).
  Values from anywhere in the Figma component feed the source component's public
  props; Inspect and Dev Mode show only the real code API and never invent
  compound components. Behind the `SEMANTIC_CONNECT_AUTHORING_ENABLED` flag.
  See [Connect components with a different structure](docs/semantic-connect.md).
- **Implementation mapping editor.** Code props as the primary column, one
  value control per target (Figma value, static, set-in-application, or
  omitted), reviewable suggestions, enum value-aliasing (`Small`↔`sm`), and an
  inline generated-code preview.
- **Semantic editor diagnostics and compatibility report.**
  `validateRecipeDraft` returns a `RecipeValidationSummary`; the editor renders
  a compatibility summary and per-message lists before save.
  `createComponentAuditReport` derives per-kind target counts and unsupported
  paths from a live source contract; exportable as Markdown/JSON.
- **Set in application / Why this structure? / Deprecated** sections in Inspect
  and Dev Mode. Semantic connections resolve through one pipeline shared by Dev
  Mode, Inspect Code, and frame inspection.
- **Connection health and reconciliation.** Healthy, Needs review, Broken, and
  Source refresh required states; source and Figma drift detection for
  additions, removals, renames, type changes, option changes, and conflicts; a
  **Changes need review** reconciliation panel (identity-first remaps, explicit
  remove, never auto-delete); replace-source confirmation; optional
  owner/package/lifecycle metadata with deprecation guidance that never blocks
  code access.
- **Full selected-tree React generation.** Frames, groups, sections, and text
  produce one complete styled-components `.tsx` module in Dev Mode and Inspect
  Code. Token-aware Figma CSS is preserved inside styled declarations; connected
  instances import from `@tashilcar/swiss-army-knife`; unconnected instances
  remain atomic JSX markers. See [Generate and inspect a frame](docs/inspect-frame.md).
- **Unconnected-component layout generation.** Selecting an unconnected
  component instance now generates a layout from its visible children instead
  of stopping at a bare marker, while still reporting the connection gap.
- **Variant logic generation.** Selecting a `COMPONENT_SET` emits typed
  `VariantProps`, `VariantDefaults`, a `VariantMatrix`, and a `resolve…Variant`
  resolver so consumers pick the right variant by props.
- **Dev-Mode-parity frame inspection.** Selecting any layer in Figma Dev Mode
  or Inspect Code shows its Layout and Style CSS (from Figma's own CSS engine,
  with `var(--token, fallback)` values preserved) plus the usage code of every
  connected component inside the selection.
- **Connected components snippet** with deduplicated imports and root-relative
  `//./ …` source comments, toggleable via the new "Layer path comments" Dev
  Mode codegen preference.
- **Inspection diagnostics** for unconnected, broken, and truncated
  descendants, and graceful degradation when CSS is unavailable.
- **Sync Tokens.** Export Figma Variable collections as CSS files (one file per
  collection × selected mode) with name-style options (kebab/slash/dot/snake/
  pascal), color-format options (hex/rgb/rgba/variable), and optional px→rem
  conversion gated on Figma variable scopes. Preview before export; alias
  cross-collection mode overrides. See [Sync Tokens](docs/sync-tokens.md).
- **JSON output for Sync Tokens.** An `outputFormat` dispatch in
  `generateTokenFiles` supports `css | json-flat | json-dtcg`. Flat JSON mirrors
  the CSS keys/values (always hex colors); DTCG JSON emits W3C `$value`/`$type`
  nested by `/` path. JSON intentionally ignores `colorFormat` to avoid an
  8-way behavior matrix. Includes duplicate-name warnings.
- **Connect component settings redesign.** A redesigned settings surface for
  authoring connections.
- **Validation hardening.** Real TypeScript-program validation for generated
  layout modules, PostCSS parsing for every emitted styled-components template,
  deterministic snapshots for every layout fixture, adversarial
  name/text/token/CSS coverage, and byte-identical Dev Mode / Inspect Code
  parity tests.
- **Library compatibility baseline** for `@tashilcar/swiss-army-knife` with a
  CI audit runner (`npm run audit:library`) that fails when a package export is
  added, removed, or reselected.
- Schema version 4 authoring snapshots, validation timestamps, and
  confirmed-save revisions.
- Dedicated prop-mapping, connection-maintenance, and contributor documentation.

### Changed

- **Standard mappings are authored visually** instead of through the legacy
  JSON textarea. Removed the standalone Children, Figma text property, and icon
  configuration inputs — labels, children, and icon slots are now managed
  through Source & prop mappings.
- **React layout extraction and selected-layer inspection share request-local
  component, connection, variable, and CSS caches.** Sibling extraction is
  concurrency-bounded while preserving Figma document order.
- **Inspect Code separates semantic runtime requirements from generation
  diagnostics** and reports unresolved-component, unsupported-asset, and
  omitted-declaration counts.
- **Bound gap, padding, width, and height variables are reconstructed** with
  Sync Tokens' kebab-case CSS names and measured fallbacks when Figma CSS is
  unavailable; repeated variable lookups are cached per generation.
- **Freeform selected designs generate relative containers** with positioned
  ordinary descendants using their Figma-local coordinates and dimensions;
  absolute children no longer become placeholder comments merely because node
  CSS is unavailable.
- **Generated styled-components reference recognized Figma color variables**
  through `colors` from `styles/colors` (for example `${colors.text.default}`)
  instead of emitting color CSS custom properties. The import is omitted when
  the selected design does not use a recognized color token.
- Connection revisions increment only after a successful save; saved Figma
  snapshots refresh only after an update is confirmed; existing advanced and
  wildcard mappings are preserved during visual edits.
- Updated the connection guide and in-plugin help for the new workflow.

### Fixed

- Fixed the Connect Component footer so it remains anchored to the bottom while
  only the form content scrolls.
- Stopped source-backed components without a `children` prop from requesting a
  missing Figma `label` property.
- Treated saved Figma-only properties without a source mapping, such as
  interaction-state variants, as intentionally unmapped during code generation.
- Prevented reconciliation from silently deleting mappings.
- Prevented Broken connections from being saved before their conflicts are
  resolved.
- Preserved revision progression across repeated and in-flight saves.

### Compatibility

- Existing schema version 3 connections migrate to version 4 without changing
  generated TSX.
- Existing children and icon metadata remains supported by code generation.
- Runtime code generation continues to consume the compiled `propMappings`
  format.
