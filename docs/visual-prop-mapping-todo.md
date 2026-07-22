# Visual Prop Mapping TODO

## Foundation

- [x] Add source, Figma, mapping-document, and revision types.
- [x] Compile a structured mapping document into the existing `PropMappings` format.
- [x] Bump persisted connection metadata to schema v4.
- [x] Migrate schema v3 connections without changing generated TSX.
- [x] Preserve advanced and wildcard mappings during standard visual edits.

## Source ingestion

- [x] Parse `.ts` and `.tsx` prop interfaces locally.
- [x] Resolve local literal-union type aliases.
- [x] Classify standard, children, event, and advanced React-node props.
- [x] Read optional runtime defaults from an implementation file.
- [x] Add multi-file upload, replace, and validation states.
- [x] Add drag-and-drop source upload.
- [x] Persist only the extracted source snapshot and content hash.

## Figma schema

- [x] Return stable raw property identifiers and display names.
- [x] Include variant, boolean, text, and instance-swap descriptors.
- [x] Snapshot the selected component set for later drift detection.

## Visual editor

- [x] Replace the raw JSON textarea for standard mappings.
- [x] Add property and value mapping rows.
- [x] Add first-class `children` text and RTL leading/trailing icon-slot rows.
- [x] Detect leading/trailing icon visibility guards.
- [x] Add compatible-property suggestions and automatic value matching.
- [x] Add upload progress and incomplete-mapping validation states.
- [x] Keep generated JSON available as a read-only advanced preview.
- [x] Surface preserved wildcard/raw mappings separately.

## Maintenance

- [x] Compare current Figma properties with the saved snapshot.
- [x] Compare re-uploaded source props with the saved snapshot.
- [x] Classify additions, removals, renames, type changes, and conflicts.
- [x] Add Healthy, Needs review, Broken, and Source refresh required states.
- [x] Add a reconciliation flow that never silently removes mappings.
- [x] Increment the connection revision after confirmed updates.

## Quality and release

- [x] Add drift and direct file-input integration tests (parser, compiler, migration, and UI coverage exists).
- [x] Verify existing instance-swap and children behavior.
- [x] Run source lint, typecheck, 273 tests, and production build.
- [x] Exclude or separately lint the standalone `previews/` prototype in the root lint command.
- [x] Update the connection guide and in-plugin help.

## Deferred

- [ ] Generate a repository-owned `tashil-components.json` manifest in CI.
- [ ] Import or retrieve manifests for automatic source drift detection.
