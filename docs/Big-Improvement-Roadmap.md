# Feature Roadmap — Post-1.0 Proposals

> **Status:** Draft proposal — not yet committed
> **Date:** 2026-07-31
> **Related docs:** `semantic-connect-roadmap.md`, `layout-composer-roadmap.md`, `visual-prop-mapping-todo.md`, `docs/sync-tokens.md`, `CHANGELOG.md`

---

## 1. Purpose

Captures proposed features after the 1.0.0 release, prioritized into phases with
explicit invariants and exit criteria, matching repo documentation conventions.

Items already owned by existing roadmaps (Semantic Connect M2–M6, arrays /
discriminated unions, multi-framework output, auto Code Connect publish) are
**out of scope** here and are not re-proposed.

---

## 2. Global invariants

These apply to **every** phase below:

- **Local-first:** `networkAccess: none` in the manifest stays. No telemetry, no
  external calls, no new permissions.
- **Non-destructive by default:** any write to shared plugin data requires
  explicit user confirmation; reconciliation stays non-destructive.
- **Deterministic codegen:** all new output covered by golden tests (Vitest);
  byte-identical output for identical input.
- **Versioned persistence:** any change to persisted data (shared plugin data or
  `clientStorage`) ships with a schema version bump and backward-compatible
  migration; older payloads must keep loading.
- **Typed messaging only:** `main` ↔ `ui` communication goes through the typed
  message layer; no ad-hoc `postMessage` payloads.
- **Separation of concerns:** Figma API access stays in `main`; rendering and
  user interaction stay in `ui`.

---

## 3. Phase summary

| Phase | Item | Value | Effort | Area |
|-------|------|-------|--------|------|
| 0 | Quick wins (docs sync, UI error boundary, README badges) | Medium | Very low | Maintenance |
| 1 | Connection export / import (portability) | High | Medium | Data durability |
| 2 | Connection coverage report | High | Medium | DS-owner workflow |
| 3 | Storybook CSF generation | High | Medium | Codegen |
| 4 | Output style preferences | Medium | Low–medium | Codegen UX |
| 5 | Sync Tokens: SCSS / Tailwind formats + export diff | Medium | Low | Sync Tokens |
| 6 | A11y checks in Inspect Code | Medium | Low–medium | Differentiation |
| 7 | Adoption & community (demo file, GIF, topics, `PRIVACY.md`) | High (adoption) | Low | Community |

---

## 4. Phase 0 — Quick wins

Zero-risk maintenance items. Land first, in a single PR if convenient.

### 4.1 Docs sync fix

- **Problem:** `docs/sync-tokens.md` Troubleshooting table still says
  *"Want `.scss` / `.json` instead — Not supported yet. CSS only for now"*,
  but 1.0.0 shipped `json-flat | json-dtcg` output. README also mentions only
  "CSS token files".
- **Fix:** update the Troubleshooting row; mention JSON token output in README.

**Exit criteria:** docs match CHANGELOG 1.0.0 behavior; no stale "CSS only"
claims remain.

### 4.2 UI-level error boundary

- Add a root error boundary in `ui.tsx` catching render-time exceptions.
- Fallback UI offers "Copy diagnostics" and "Include in debug bundle", extending
  the existing per-connection debug bundle to plugin-level crashes.

**Exit criteria:** a throwing test component renders the fallback (unit test);
diagnostics are copyable; no unhandled exception reaches a blank iframe.

### 4.3 README badges

- CI status, version, license badges at the top of `README.md`.

**Exit criteria:** badges render on GitHub; CI workflow exists and is green on
`main`.

---

## 5. Phase 1 — Connection export / import

### Goal

Connections live in shared plugin data and travel with the Figma file — but are
lost on file duplication, library republish, or local→team-file migration.
Export/import makes connection data durable and portable.

### Scope

- **"Export all connections"** action → single versioned JSON download.
- **"Import connections"** action → **dry-run first**: preview shows
  matched / conflicted / missing-component per entry; user explicitly applies.
- Reuse the validation and migration infrastructure already in `codegen.ts` /
  `schema.ts`; this phase is mostly orchestration, not new parsing.

### Export format

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-07-31T00:00:00.000Z",
  "pluginVersion": "1.0.0",
  "connections": [
    {
      "componentKey": "<figma-component-key>",
      "sourcePath": "src/components/Button.tsx",
      "mappings": [],
      "health": {}
    }
  ]
}
```

### Conflict handling

Per-conflict user choice in the dry-run preview: **keep existing** /
**overwrite with imported** / **skip**. Default: keep existing.

### Invariants

- Import never writes without explicit confirmation after the dry-run report.
- Round-trip: export → import into the same file is a **no-op** (golden test).
- Older export versions migrate forward through the same migration path as
  stored connections — one migration code path, not two.
- Nothing leaves the machine except the user-saved JSON file.

### Exit criteria

- Golden tests: export fixture matches snapshot; dry-run report matches
  snapshots for matched / conflict / missing cases.
- Migration test: a v1 export loads under the current schema.
- Manifest unchanged (`networkAccess: none`).

---

## 6. Phase 2 — Connection coverage report

### Goal

Give design-system owners a file-level answer to *"which components are worth
connecting?"* — the inventory shows per-component status, but there's no
prioritized overview.

### Scope

New **Coverage** tab/panel with an explicit "Scan" action:

| Metric | Example |
|--------|---------|
| Instance count per main component, sorted desc | `Button — 340 instances, not connected` |
| % connected vs unconnected instances | `72% coverage` |
| Broken instances (deleted main component) | list with layer path |

- Reuse the existing traversal in `figma-layout-extractor`.

### Invariants

- Fully local; scan runs **on demand**, never implicitly on selection change.
- Large files: traversal must be chunked/cancellable so the plugin stays
  responsive (yield between chunks).

### Exit criteria

- Fixture-based tests: instance counts and broken-instance detection match
  expected values.
- Scan of a large synthetic tree never blocks the plugin thread beyond the
  agreed chunk budget.

---

## 7. Phase 3 — Storybook CSF generation

### Goal

Close the loop: the plugin already emits `Variant Props`, `VariantMatrix`, and
the variant resolver for `COMPONENT_SET` nodes, and already accepts a Storybook
URL. Generating `<Component>.stories.tsx` (CSF 3) removes the last manual step
teams write by hand to keep Storybook in sync with Figma.

### Scope

- **"Generate stories"** action in the Connect editor and Dev Mode panel.
- One story per variant combination; for large matrices, a user-selected subset.
- `args` derived from existing prop mappings; imports reuse the existing
  import-builder logic (no parallel import code path).
- Copy + download affordances consistent with existing copy actions.

### Invariants

- Deterministic output; golden tests per component kind (single component, set
  with matrix, set with boolean props).
- **Combination guard:** if the matrix exceeds a threshold (default: 32
  combinations), subset selection is required — never silently emit hundreds of
  stories.

### Exit criteria

- Golden tests for CSF output across the mapping fixture set.
- Generated stories compile in the example repo's Storybook (documented manual
  verification step).

---

## 8. Phase 4 — Output style preferences

### Scope

A **Settings** page persisted in `clientStorage` (per-user, never on the
document):

- Quote style, semicolons, indentation, trailing comma.
- Styled-component naming pattern (default `{Name}Root`, configurable).
- Copy modes: "Copy without imports" / "Imports only".
- **Mid-term:** alternate styling emitters for layout generation — the CSS
  Modules emitter retired earlier can return as an opt-in output target
  (recoverable from git history, as noted in the layout-composer roadmap).

### Invariants

- **Defaults unchanged:** output for existing fixtures is byte-identical to
  1.0.0.
- Preferences never written to shared plugin data.
- Every style knob has golden tests with a non-default configuration.

### Exit criteria

- Golden tests pass for the default config and at least two non-default configs.
- Settings UI unit tests; persistence round-trip test (set → reload → read).

---

## 9. Phase 5 — Sync Tokens extensions

### Scope

- **New `outputFormat` values:** `scss` (variables/map) and `tailwind-theme`
  (theme-extension snippet), dispatched through the existing format-dispatch
  switch. JSON formats shipped in 1.0.0; SCSS is the explicitly documented gap
  (`docs/sync-tokens.md` Troubleshooting).
- **Export diff:** hash of the last export stored in `clientStorage`;
  pre-download summary — e.g. *"12 tokens changed, 3 removed"* — so teams know
  whether a commit is warranted.

### Invariants

- `css`, `json-flat`, `json-dtcg` output remains byte-identical.
- Diff is informational only; it never blocks or alters the export.

### Exit criteria

- Golden tests per new format.
- Diff unit tests: added / changed / removed / unchanged classification.

---

## 10. Phase 6 — A11y checks in Inspect Code

### Scope

Leverage the already-resolved variables and Layout/Style partition:

- **Contrast ratio** (WCAG AA / AAA) between text color and resolved background.
- **Minimum touch target** (24×24 px) and minimum font-size heuristics.
- Rendered as inline badges in the Inspect panel.

### Invariants

- Local computation only; no new permissions.
- Findings are **warnings, never errors**; they never block copy.

### Exit criteria

- Unit tests for contrast computation against known color pairs.
- Golden Inspect output includes the a11y section for a fixture with a known
  contrast failure.

---

## 11. Phase 7 — Adoption & community

Biggest leverage for a freshly published plugin (repo currently has zero
external traction).

- **Figma Community demo file + sample React repo:** a new user reaches their
  first copied TSX in under 5 minutes without setting up their own DS.
- **README demo GIF:** the Connect → Dev Mode copy flow.
- **GitHub topics:** `figma-plugin`, `design-system`, `design-tokens`,
  `codegen`, `react`; plus issue templates.
- **Standalone `PRIVACY.md`:** the local-first model is a selling point —
  document exactly what data lives where (shared plugin data vs `clientStorage`
  vs nothing-at-all).

**Exit criteria:** a new user can go from the Community file to copied TSX in
under 5 minutes following the README alone (verified by a cold run-through).

---

## 12. Backlog (not scheduled)

<details>
<summary>Medium/long-term candidates — revisit after Phases 1–7</summary>

- **Multi-select in Dev Mode:** combined output for several instances with
  deduped imports.
- **JSDoc / Figma description display** in the Connect editor and Inspect panel.
- **Custom health thresholds:** team-defined rules, e.g. Figma-only properties
  prefixed `prototype/` count as intentional-unmapped.
- **RTL preview toggle** (`dir`) in the inline preview — consistent with
  existing `dir: rtl|ltr` support and leading/trailing icon handling.
- **CI manifest review:** a small CLI running `extractSourceContract` against a
  repo and comparing to exported connection snapshots (from Phase 1) — brings
  drift detection to CI without plugin network access. Currently declared out of
  scope ("repository-owned manifest"); revisit once adoption justifies it.
- **Code Connect output as a downloadable file** (not auto-publish): a bridge
  for native-ecosystem users, respecting the current non-goal.

</details>

---

## 13. Sequencing rationale

1. **Phase 0 first** — zero risk, immediate docs correctness.
2. **Phase 1 before anything that increases connection investment** (Phases 2–3
   make connections more valuable; export/import must exist before users have
   more to lose).
3. **Phases 2–3** deliver DS-owner and developer-facing value; they share the
   variant-matrix and traversal infrastructure.
4. **Phases 4–6** are independent, low-effort increments; schedule around
   feedback.
5. **Phase 7** runs in parallel from day one — it requires no code changes and
   compounds over time.

---

## 14. Definition of done (per phase)

- [ ] Golden tests + unit tests green (`vitest`), parity tests where codegen
      output is involved
- [ ] Invariants from §2 verified (manifest unchanged, migration path tested)
- [ ] README / relevant doc under `docs/` updated in the same PR
- [ ] CHANGELOG entry under `Unreleased`
- [ ] No new dependencies without explicit justification
