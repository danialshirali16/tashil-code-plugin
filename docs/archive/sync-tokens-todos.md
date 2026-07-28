# Sync Tokens remediation TODOs

> Archived — all remediation and verification tasks are complete. Retained for
> implementation and QA history.

Source: [Sync Tokens audit](../../output/sync-tokens-audit/audit-report.md), 2026-07-26.

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

- [x] Replace the synthetic CSS preview with previews generated from the selected files.
  - Use the same resolved tokens and serializer as the download.
  - Show a bounded preview per output file.
- [x] Add export preflight counts and warnings.
  - Distinguish selected Figma variables from emitted declarations.
  - Report unresolved aliases, unsupported values, and skipped conversions.
- [x] Add explicit cross-collection alias mode mapping.
  - [x] Show the chosen fallback mode when names do not match.
  - [x] Allow explicit per-output-mode mappings from the fallback warning.
- [x] Clarify filtered bulk selection completely.
  - [x] Label the action with its result scope.
  - [x] Disable it when no collections match.
  - [x] Keep selected-count and clear-all feedback visible.
- [x] Hide or disable filename copy actions for inactive modes.
- [x] Announce successful downloads and packaging failures through an accessible status region.

## P3 — Scale and accessibility

- [x] Avoid sequential variable lookups for large collections.
  - Load variables once or use bounded parallel resolution.
  - Preserve stale-operation cancellation.
- [x] Explain numeric values skipped by px-to-rem because their Figma scope is unknown.
- [x] Run keyboard, screen-reader, and contrast QA in the real Figma host.
  - Figma's accessibility tree exposes named tabs, collection checkboxes,
    settings, preview status, and export actions.
  - Keyboard Space toggles px-to-rem and its conditional root-size field;
    arrow keys operate the official Figma segmented controls.
  - Dark-theme host inspection confirmed readable selected, preview, summary,
    and action states.

## Verification

- [x] Run focused Sync Tokens tests.
- [x] Run typecheck, lint, full tests, and production build.
- [x] Validate every naming format in a real browser stylesheet.
- [x] Complete a real Figma-hosted export and inspect the downloaded CSS/ZIP.
  - `4-measurement.css` parsed as 29 custom properties with no empty values.
  - `sync-tokens.zip` contained valid 61- and 29-declaration stylesheets,
    exactly matching the 90-declaration preflight.
