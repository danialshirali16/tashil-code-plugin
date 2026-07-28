# Sync Tokens audit

Audit date: 2026-07-26

Scope: the local Figma-plugin harness at `http://127.0.0.1:5178/dev/harness/index.html`, the Sync Tokens UI, serializer, Figma variable resolution, and download pipeline.

Remediation update: all recommendations were completed and verified. The
historical checklist is archived at
[`docs/archive/sync-tokens-todos.md`](../../docs/archive/sync-tokens-todos.md).

## Executive summary

The three-step flow is understandable and the loading, empty, error, and stale-operation guards are sound. The feature is not yet safe to ship with every advertised naming format: raw dot and slash token names produce invalid CSS custom-property declarations. The filename policy and synthetic preview also make the output less predictable than the interface suggests.

## Evidence

1. `01-start.png` — initial collection-selection state.
2. `02-output-modes.png` — one selected collection and mode filenames.
3. `03-output-settings.png` — two modes, Variable color output, and dot naming.
4. `04-search-empty.png` — search with no matching collections.

## Findings

### P1 — Dot and slash names are invalid CSS identifiers

The serializer emits raw values such as `--color.text.primary` and `--color/text/primary`. Browser validation with `CSS.supports()` rejects both declaration names, while kebab and snake pass. Escaped forms (`--color\.text\.primary` and `--color\/text\/primary`) pass.

Recommendation: escape separator characters in the emitted CSS identifier, and make the preview use the exact serialized string. Add a browser-level test that inserts every naming style into a stylesheet and verifies the declaration is retained.

### P1 — A file can silently change its name when a second mode is selected

With one selected mode, the file is `product-tokens.css`. Selecting a second mode renames the first file to `product-tokens-zhina.css`. This can break imports, scripts, caches, and diffs.

Recommendation: make mode filenames stable. For a collection with multiple available modes, always include the mode suffix, or export a deliberate unsuffixed alias in addition to stable per-mode files.

### P2 — The preview does not preview the selected export

The current preview is a synthetic three-token example. It does not use the selected collection, selected mode, actual aliases, or the final files produced by the export pipeline.

Recommendation: generate a per-file preview from the same serializer and resolved token data used for download. Show the first 10–20 declarations, total declaration count, and warnings.

### P2 — Counts overstate export certainty

The footer reports selected Figma variable counts, not successfully serialized declarations. Missing variables, unsupported values, unresolved aliases, and unknown modes can reduce or change the output.

Recommendation: present a preflight summary such as `294 variables → 286 declarations · 8 warnings`, with warnings grouped per file.

### P2 — Cross-collection alias mode fallback is implicit

Alias resolution matches a referenced collection's mode by name and otherwise falls back to that collection's default mode. This is a sensible fallback, but it can silently combine the selected mode with unrelated default-mode values.

Recommendation: show the resolved mode mapping before export and warn when a referenced collection falls back. For advanced use, allow an explicit per-collection mode mapping.

### P2 — Selection and search feedback are ambiguous

`Select all` acts on filtered results while preserving selections outside the filter. In a no-results state it remains enabled, and the footer still shows hidden selections.

Recommendation: label the action with its scope (`Select 2 results`), disable it when there are no results, and show a persistent `2 selected · Clear all` summary.

### P2 — Inactive modes expose active-looking copy actions

Unchecked modes still show a copyable prospective filename. This can imply that the file will be exported.

Recommendation: disable or hide copy for inactive modes, or label the filename as a preview until the mode is selected.

### P2 — Export completion needs visible confirmation

The UI returns from `Exporting` to `Ready to export` after packaging, but it does not announce a successful download or identify the resulting file/archive.

Recommendation: add an `aria-live` success message such as `Downloaded sync-tokens.zip with 2 CSS files`, plus a retryable packaging error.

### P3 — Large collections are processed sequentially

The export pipeline awaits each variable lookup and alias chain inside nested loops. This is reliable but can be slow for hundreds of variables.

Recommendation: load local variables once into a map or use bounded parallel resolution, while retaining the existing stale-operation guard.

### P3 — px-to-rem exclusions are invisible

Conversion only applies to tokens with explicit length scopes, which avoids corrupting unitless values. Tokens with broad or unknown scopes remain raw numbers without explanation.

Recommendation: retain the safe behavior and add a warning count for numeric tokens skipped because their unit scope is unknown.

## Accessibility

Strengths: the workflow uses headings, checkboxes, a tab panel, labeled controls, an alert region for errors, and keyboard-accessible segmented controls.

Risks: unchecked controls and inactive segments have very low visual emphasis and can look disabled. Search-result selection scope is not communicated to assistive technology. A full keyboard and screen-reader pass is still needed in the real Figma host.

## Verification

- Browser console: no application errors observed in the exercised states.
- Automated tests after remediation: 600 passed across the full test suite.
- Typecheck, lint, production build, and browser validation for all five naming formats passed.
- Limitation: the harness uses fixture collections and does not complete a real Figma-hosted download, so final host integration and download confirmation were assessed from the implementation rather than captured interactively.
