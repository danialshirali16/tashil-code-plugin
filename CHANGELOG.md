# Changelog

All notable changes to Tashil Code are documented in this file.

## [Unreleased]

### Added

- Added local `.ts` and `.tsx` source uploads with multi-file and drag-and-drop support.
- Added automatic extraction of component props, literal-union values, runtime defaults, children, and icon slots.
- Added a visual editor for mapping code props and values to compatible Figma component properties.
- Added first-class label/children and RTL-aware leading/trailing icon-slot mappings.
- Added mapping progress and incomplete-mapping feedback.
- Added Healthy, Needs review, Broken, and Source refresh required connection states.
- Added source and Figma drift detection for additions, removals, renames, type changes, option changes, and conflicts.
- Added an explicit reconciliation flow that preserves stale mappings until they are manually removed.
- Added separate custom wildcard/raw mappings and a read-only generated JSON preview.
- Added schema version 4 authoring snapshots, validation timestamps, and confirmed-save revisions.
- Added dedicated prop-mapping, connection-maintenance, and contributor documentation.

### Changed

- Standard mappings are now authored visually instead of through the legacy JSON textarea.
- Connection revisions now increment only after a successful save.
- Saved Figma snapshots refresh only after an update is confirmed.
- Existing advanced and wildcard mappings are preserved during visual edits.
- Source parsing remains local; original source contents are not persisted.
- Removed the standalone Children, Figma text property, and icon configuration inputs. Labels, children, and icon slots are now managed through Source & prop mappings.
- Updated the connection guide and in-plugin help for the new workflow.

### Fixed

- Fixed the Connect Component footer so it remains anchored to the bottom while only the form content scrolls.
- Stopped source-backed components without a `children` prop from requesting a missing Figma `label` property.
- Treated saved Figma-only properties without a source mapping, such as interaction-state variants, as intentionally unmapped during code generation.
- Prevented reconciliation from silently deleting mappings.
- Prevented Broken connections from being saved before their conflicts are resolved.
- Preserved revision progression across repeated and in-flight saves.

### Compatibility

- Existing schema version 3 connections migrate to version 4 without changing generated TSX.
- Existing children and icon metadata remains supported by code generation.
- Runtime code generation continues to consume the compiled `propMappings` format.

### Validation

- Added parser, compiler, migration, drift, revision, upload, and UI integration coverage.
- All 274 automated tests pass.
- ESLint, TypeScript checks, and the production build pass.
