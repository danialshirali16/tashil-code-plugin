# Sync Tokens remediation TODOs

Source: [Sync Tokens audit](../output/sync-tokens-audit/audit-report.md), 2026-07-26.

## P1 — Export correctness

- [x] Escape dot and slash separators in emitted CSS custom-property identifiers.
  - Declaration names and every `var()` reference use the same escaping.
  - The logical token-name formatter still returns `color.primary.hover` for display and non-CSS uses.
  - Serializer, UI preview, and plugin export tests cover dot and slash output.
- [x] Keep output filenames stable as mode selections change.
  - Collections with multiple available modes always include the mode name.
  - Single-mode collections keep the concise collection-only filename.
  - UI and plugin export tests cover selecting one and multiple modes.

## P2 — Export trust

- [ ] Replace the synthetic CSS preview with previews generated from the selected files.
  - Use the same resolved tokens and serializer as the download.
  - Show a bounded preview per output file.
- [ ] Add export preflight counts and warnings.
  - Distinguish selected Figma variables from emitted declarations.
  - Report unresolved aliases, unsupported values, and skipped conversions.
- [ ] Surface cross-collection alias mode fallbacks.
  - Show the chosen target mode when names do not match.
  - Allow explicit mappings if fallback warnings are common.
- [ ] Clarify filtered bulk selection completely.
  - [x] Label the action with its result scope.
  - [x] Disable it when no collections match.
  - [ ] Keep selected-count and clear-all feedback visible.
- [x] Hide or disable filename copy actions for inactive modes.
- [ ] Announce successful downloads and packaging failures through an accessible status region.

## P3 — Scale and accessibility

- [ ] Avoid sequential variable lookups for large collections.
  - Load variables once or use bounded parallel resolution.
  - Preserve stale-operation cancellation.
- [ ] Explain numeric values skipped by px-to-rem because their Figma scope is unknown.
- [ ] Run keyboard, screen-reader, and contrast QA in the real Figma host.

## Verification

- [x] Run focused Sync Tokens tests.
- [x] Run typecheck, lint, full tests, and production build.
- [x] Validate every naming format in a real browser stylesheet.
- [ ] Complete a real Figma-hosted export and inspect the downloaded CSS/ZIP.
