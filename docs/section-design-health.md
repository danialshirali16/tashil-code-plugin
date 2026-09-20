# Design Health — How It Works (Developer Guide)

Status: Active  
Last updated: 2026-09-19  
See also: [Section guide index](sections-index.md) · [Figma Editor Modes](section-editor-modes.md)

Design Health provides frame-level design-token auditing, one-click token
binding, and library deprecation inspection in Figma Design mode.

---

## At a glance

While the Design Health tab is active, opening the tab, changing the
selection, or a debounced document change requests a fresh subtree audit.
Selection changes on other tabs do not run this audit:

```text
Triggers (explicit UI subscription in ui.tsx)
   ├── Tab opened, selectionchange, or debounced document change
   │  (DESIGN_HEALTH_DOCUMENT_CHANGED from main.ts, ≥1.5s debounce,
   │   suppressed while a binding mutation is in flight;
   │   the documentchange listener attaches lazily on the first scan,
   │   after figma.loadAllPagesAsync() as dynamic-page access requires)
   ▼
Backend (src/main/design-health-adapter.ts)
   │  ui.tsx emits SCAN_DESIGN_HEALTH with a monotonic scanId, then:
   │  1. In-memory variable harvest: local variables plus referenced
   │     collections' sister tokens (parallel chunked fetches)
   │  2. Resolves all token candidates once for the audit root's mode
   │     context; exact matches are verified per node with
   │     variable.resolveForConsumer(node) (max 3 checks per issue); values
   │     without an exact token get near-value/name-ranked suggestions
   │  3. Traverses subtree (BFS, 800-node cap, isolated node try/catch,
   │     never descends into non-root component instances)
   │  4. Evaluates individual fills/strokes, radius, gap, each padding
   │     edge, and opacity (one bridge read per property group per node)
   │  5. Detects library deprecation tags and counts instance statistics
   │  6. Emits scan honesty fields: nodesVisited, capReached, selectionCount
   │  emit SCAN_DESIGN_HEALTH_RESULT (monotonic scanId drops stale refreshes)
   ▼
UI View (src/views/DesignHealthView.tsx)
   │  ├── Tokens tab: coverage meter, three groups (Ready to auto-fix /
   │  │   Review suggestions / No token match), per-row token Dropdown
   │  └── Library tab: instance stats + deprecated cards with canvas focus
   ▼
User triggers Action:
   └── Bind: APPLY_TOKEN_BINDINGS → setBoundVariableForPaint /
       setBoundVariable (exact field/paintIndex) → commitUndo() when ≥1 bound
```

---

## Module map

| File | Role |
| --- | --- |
| `src/design-health/types.ts` | **Pure domain model.** Zero `@figma/plugin-typings` imports. Defines `TokenPropertyIssue`, `TokenAuditSummary` (with `audited`), `TokenSuggestion`, `DeprecatedInstanceNotice`, and `DesignHealthScanResult` (with `nodesVisited`/`capReached`/`selectionCount`). |
| `src/design-health/token-audit.ts` | **Pure token linting and ranking.** Compares raw layer values against available design tokens. Scores suggestions into High, Medium, and Low confidence based on inferred variable, exact value match, and property scope matching; when no token holds the value, falls back to nearest-value (scale step / shade distance / RGB-equal-alpha) and layer-name-affinity suggestions that are decision-only. `calculateTokenAuditSummary` reports `audited: false` (and 0% — never 100%) when nothing was scanned. |
| `src/design-health/token-audit.test.ts` | Unit tests for pure token ranking, scope matching, confidence classification, and summary honesty. |
| `src/main/design-health-adapter.ts` | **The Figma runtime adapter.** The only place in this feature that interacts with the Figma Plugin API: walks nodes defensively (instances stay atomic — no descent into non-root instance internals), reads bound and inferred variables, resolves token candidates once per audit into a value index and verifies each suggestion for its consuming node, applies variable bindings to exact field/paint targets, and commits undo steps. `focusNodeOnCanvas` scrolls/zooms **without changing the selection**. |
| `src/views/DesignHealthView.tsx` | **Preact UI view.** Built from `@create-figma-plugin/ui` primitives (`main`/`h1` document structure, `SegmentedControl`, `Banner`, `Dropdown`, `Checkbox`, official icons). Hosts the coverage meter, token groups, and library health. |
| `src/views/DesignHealthView.test.tsx` | UI component tests: honest empty states, binding payloads, clustering, scope accounting, and deprecation cards. |
| `src/styles/design-health.css` | Stylesheet for the view. Colors only through `var(--figma-color-*)` tokens (hex solely as `var()` fallback). No keyframes. |
| `src/ui-controller.ts` | State machine and message orchestrator: `designHealthScanResult`, `designHealthStatus`, `designHealthMessage`, selection/document-change sequences, and the binding dispatcher. |
| `src/types.ts` | Message contracts: `SCAN_DESIGN_HEALTH`, `APPLY_TOKEN_BINDINGS`, `FOCUS_NODE`, `DESIGN_HEALTH_DOCUMENT_CHANGED`. |

---

## The Pure Core (`src/design-health/`)

### 1. Token Audit & Confidence Ranking (`token-audit.ts`)

Every supported visual property (fill, stroke, corner radius, gap, each
padding edge, and opacity) is evaluated against the available design system
tokens:

- **High Confidence:** a Figma inferred-variable match exists.
- **Medium Confidence:** an exact value match with a compatible scope, or
  semantic naming disambiguates multiple exact matches.
- **Low Confidence:** multiple exact-value candidates remain ambiguous.
- **Alternatives Ranking:** all tokens sharing the value are retained and
  offered in a per-row `Dropdown` so the user can pick their preferred
  semantic token before binding.

When several tokens share the value, name signals decide the winner in this
precedence order (lowest rank wins):

1. **A word of the layer's own name** appears in the token name — the layer
   says what it is better than any naming convention does.
2. **Tiered property keywords** — semantic words that say "this token exists
   for this property kind" (`background`/`bg`/`surface` for fills,
   `border`/`stroke` for strokes) outrank generic buckets (`color`). Note
   `bg` is a keyword on its own: "background" contains none of the other
   substrings, so keyword lists must carry the full word explicitly.
3. **Primitive & interaction-state penalties** — a token whose last path
   segment is a bare number (`color/gray/100`, `primary/600`) is a scale
   step, not a semantic choice; a token naming an interaction state
   (`background/neutral/transparent-hover` — hover/active/pressed/focus/
   selected/disabled, matched inside hyphenated segments too) describes a
   transient state, while a raw audited fill is in its resting state. Both
   rank one tier weaker, so a same-value semantic resting token wins.
4. Ties stay **low confidence** with every candidate in the `Dropdown` — the
   user decides, but the default pick is no longer systematically wrong.

**Figma variable scopes are binding constraints, not hints.** A token scoped
away from the property (a radius-only token offered for a gap — even one
whose value matches exactly) is never suggested: not as the primary pick, not
as a `Dropdown` alternative, not in proximity ranking. When the value exists
only on scope-incompatible tokens, the row falls through to proximity
suggestions among scope-compatible tokens, or to an honest "No token match".

When **no token holds the raw value**, the ranking falls back to proximity
instead of a dead end (all of these are decision-only — never auto-bound, and
their `suggestedValue` shows the different value next to the token name in the
UI):

- **Near value (`near-value`):** numbers propose the nearest scale step
  (relative tolerance 30%, or ±2 units for non-opacity properties); colors
  propose the nearest shade by redmean distance. A color whose RGB matches
  and only paint opacity differs is the strongest case — medium confidence,
  because binding keeps the paint's own alpha and is visually identical.
- **Name match (`name-match`):** when nothing is value-close, tokens whose
  names share a word with the layer's own name are offered ("Primary Button"
  → `color/primary/600`). Property keywords alone never qualify — nearly
  every token name contains "color"/"bg" — so a name suggestion requires a
  real layer-name signal (generic words like "Frame"/"Rectangle" are
  stop-words).

`calculateTokenAuditSummary` is honest about emptiness: a selection with zero
auditable properties reports `audited: false` and `tokenCoveragePercent: 0`.
The UI shows "Nothing to audit" — never a success state for work that did not
happen.

## The Figma Adapter (`src/main/design-health-adapter.ts`)

### 1. In-Memory Token Discovery

To avoid unnecessary network requests and remain compatible with
document-access restrictions:

- Pulls local variables via `figma.variables.getLocalVariablesAsync()` — one
  call that already covers every local collection's tokens (a per-collection
  `variableIds` walk would only re-fetch the same variables).
- Scans `boundVariables` and `inferredVariables` across the inspected
  selection tree. For any referenced external collection, retrieves its
  sister tokens locally via `figma.variables.getVariableCollectionByIdAsync()`.
  Variable fetches run in parallel chunks (25 at a time); sequential
  per-variable awaits were the dominant scan cost once a library holds
  hundreds of tokens.
- Resolves candidates with `variable.resolveForConsumer(auditRoot)` **once per
  scan** (the full candidate list is then ranked purely in JS). Resolving
  every variable for every node would cost nodes × variables bridge calls.
  Because a mode switch inside the selection could make the root's context
  wrong for a nested layer, each emitted **exact-match** suggestion is
  verified with `resolveForConsumer(node)` for its actual consumer (at most 3
  candidates per issue); a suggestion that fails verification falls back to
  its near/name alternatives or renders as "No token match" instead of a
  binding that would change the layer's value. Inferred-variable matches skip
  verification — Figma resolved those for the exact node already — and so do
  near-value/name-match suggestions, which intentionally propose a different
  value.

### 2. Defensive Traversal

- **Instances are atomic:** the walk never descends into the internals of a
  component instance. Those layers belong to the main component, auditing
  them would only surface read-only rows, and skipping them keeps large
  frames inside the node budget. The audit root itself may be an instance —
  selecting one is an explicit request to audit that component's own layers
  (flagged `isEditableHere: false`). Library statistics still count every
  instance at its atomic position.
- **One bridge read per property group:** `fills`, `strokes`,
  `boundVariables`, and `inferredVariables` are each read once per node and
  reused by every paint index and padding edge evaluated on that node.
- **Node budget:** 800 nodes per scan. The result carries `nodesVisited` and
  `capReached` so the UI can label a partial audit instead of presenting it
  as complete.
- **Protected calls:** `getMainComponentAsync()` is wrapped in `try…catch`;
  per-node failures are isolated.
- **Stale scan cancellation:** every scan carries a monotonic `scanId`; stale
  completions are discarded, including between variable-fetch chunks.
- **Multi-selection honesty:** `selectionCount` reports how many layers were
  selected; only the first is audited and the UI says so.

### 3. Mutations & Single-Step Undo

- `applyTokenBindings`: carries an explicit binding target for every finding.
  Fill/stroke requests update one paint index; padding requests update one
  edge; radius, gap, and opacity update one node field. Each request is
  isolated, partial failures are counted, and `figma.commitUndo()` is called
  only when at least one binding changed.
- `focusNodeOnCanvas`: scrolls and zooms to a node **without re-pointing
  `figma.currentPage.selection`**. The audit is anchored to the user's
  selection; "focus" must not silently replace the audit subject with a child
  layer (focus clicks used to trigger a rescan of the clicked child,
  discarding the parent's audit the user was reading).

---

## The UI Layer (`src/views/DesignHealthView.tsx`)

Built strictly from `@create-figma-plugin/ui` inside a
`<main aria-labelledby>` + `h1` document skeleton (or `EmptyInspectState`
for empty/loading/error states):

1. **Header:** node name + type badge as the subject, and a truthful status
   line (`Auditing…` / `Binding tokens…` /
   `Up to date · relative time` / `Update failed — Retry`). There is no
   always-green "Auto-Audited" indicator.
2. **Honesty banners:** `Banner variant="warning"` for partial audits
   (800-node cap) and multi-selection; scan errors render through the
   `.field-error` + `role="alert"` pattern (`Banner` has no danger variant).
3. **Sub-navigation:** `SegmentedControl` (Tokens / Library), each label
   carrying a related library icon. Each tab's count is plain text in the
   option in the "Name (N)" format and has one fixed meaning: unbound issues
   in the selection, deprecated instances. Counts never change color to imply
   severity.
4. **Tokens tab:** a centered `role="meter"` coverage ring (72px circle, percentage
   centered inside; "X of Y properties bound" caption below; graded tone — success ≥80%, neutral ≥50%, warning ≥25%, danger
   below — so a decent score never renders as a failure), a property
   `Tabs` strip filter (content-width; the "Showing X of Y" line
   renders only while a filter is active), and four groups — **Ready to
   auto-fix** (high confidence, with the `Bind N` batch action living in the
   group header; its label follows the active filter, e.g. "Bind 9 in
   Fills"), **Review suggestions** (medium/low with a token `Dropdown`),
   **No token match**, and **Fix in the main component** (findings inside
   component instances — shown for visibility, never bindable here). Issues
   sharing one node (e.g. `itemSpacing` + four padding edges) cluster under
   a single node header with an unbound count instead of repeating the node
   name on every row. Confidence chips follow the silent-HIGH rule: only
   medium/low render a chip. Three distinct empty
   states: *Nothing to
   audit* (nothing scanned), *All properties bound* (only when every scanned
   property really is bound), and *No issues match the current filter* with a
   **Clear filter** action.
5. **Library tab:** instance composition stats in an auto-fit grid, and
   deprecated cards whose actions are canvas **Focus**. The empty state
   states plainly that Figma's plugin API does not expose native
   library update availability, so the tab must not claim that unmarked
   instances are up to date.

---

## Invariants

1. **Active-tab scanning:** opening Design Health, changing the selection
   while that tab is active, or a debounced document change (≥1.5 s,
   suppressed mid-mutation) triggers an audit. Selection changes elsewhere
   update shared selection state but do not run Design Health work. The UI
   subscribes via explicit sequences (`designHealthSelectionSequence` /
   `designHealthDocumentChangedSeq`) rather than piggybacking on unrelated
   state. The `documentchange` listener itself attaches lazily on the first
   scan — under `documentAccess: "dynamic-page"` registration requires
   `figma.loadAllPagesAsync()`, and files whose users never open the tab
   never pay that load.
2. **Cancellable scans with monotonic `scanId`:** any new scan supersedes
   older pending scans and suppresses stale emits across async bounds.
3. **Commit undo after mutation:** the binding batch calls
   `figma.commitUndo()` only after at least one binding succeeds, preserving
   a clean single-step rollback without creating empty history entries.
4. **Audit honesty:** no success/100% state renders unless
   `unboundPropertiesCount === 0` with a non-empty, uncapped scan; partial
   audits and multi-selections are labeled; every enum status value has a
   rendered state.
5. **Numbers reconcile:** every count on screen derives from the same full
   audit — nothing is hidden behind a scope filter, so the meter, the tab
   badge, and the group sums always agree. Findings inside component
   instances are shown and tagged ("Fix in the main component"), never
   silently dropped.
6. **Rescans preserve user state:** a rescan invalidates only what its
   changed data actually refers to. Chosen tokens survive while their issue
   exists and the property filter persists across scans.
5. **Focus ≠ selection:** focusing a layer never changes
   `figma.currentPage.selection`, so the audited subject stays stable.
7. **Instances are out of editing scope:** the scan flags findings inside a
   non-root component instance `isEditableHere: false` ("Fix in the main
   component") and never binds them from the panel — binding there would
   create a local override on the instance instead of fixing the main
   component, and overrides vanish on the next library update or instance
   reset. Batch bind respects the flag unconditionally.
8. **Consumer-mode token resolution:** candidate values are resolved once for
   the audit root with `Variable.resolveForConsumer`; every exact-match
   suggestion is then verified against its actual consuming node (max 3
   checks), so suggestions respect explicit and inherited variable modes.
   Near-value and name-match suggestions are exempt (their values differ from
   the raw value by design) and are decision-only — never auto-bound.
9. **Precise binding targets:** findings and mutation requests retain paint
   indices and individual padding edges; applying one suggestion must not
   overwrite sibling paints or asymmetric spacing.
11. **Resilient node traversal:** isolated node errors (e.g., inaccessible
    remote components, removed layers) are gracefully trapped without
    crashing the scan.

---

## UI guardrails (enforced)

- `eslint.config.js` bans raw hex/rgba literals in `src/views/**/*.tsx`
  (test fixtures exempt). Colors come from `var(--figma-color-*)` tokens;
  hex lives only in stylesheets, inside `var()` fallbacks.
- No new `@keyframes` without a `prefers-reduced-motion` guard; the view
  currently defines none.
- Custom tab/pill/select/banner classes are banned for **in-view
  sub-navigation** in favor of the library components above (`SegmentedControl`
  for the sub-tab bar, `Tabs` for the property filter); every custom control exposes a
  visible `:focus-visible` state.
- **Workbench tab bar exemption (permanent, recorded).** The `.reference-tabs`
  bar in `src/ui.tsx` is the one sanctioned custom tab implementation, and the
  library `Tabs` component must not be used for it. This is a design decision,
  not an interim one: the library component renders hidden radio inputs with
  no `role=tablist`/`tab`/`tabpanel` semantics and no arrow-key navigation
  (adopting it would regress accessibility from the full WAI-ARIA tabs pattern
  this bar implements), renders tab labels from `option.value` only, and wraps
  panel content in its own element — breaking the
  `.tabpanel { display: contents }` grid contract that keeps `.fields` /
  `.footer` as direct grid items of `.root`. Any future replacement of this
  bar must preserve all of: ARIA tabs semantics with roving tabindex,
  Arrow/Home/End keys, `aria-controls` ↔ `tabpanel` wiring, and the grid
  contract.
- **Reopen conditions for `Tabs` vs `SegmentedControl` (sub-tab bar).** The
  sub-tab bar stays on `SegmentedControl` inside the `.health-tabs-row`
  wrapper. Re-evaluate `Tabs` only when a library release satisfies **all**
  of: (1) tab labels can carry custom children (label content decoupled from
  `value`), so per-tab counts stay renderable; (2) the strip works standalone
  — panel content is rendered by the consumer, not swallowed into the
  component; (3) real ARIA tabs semantics ship (`role=tablist`/`tab`, roving
  tabindex, Arrow/Home/End). Until then this decision is locked, and this note
  is the recorded rationale.
- Any UI behavior change ships with an update to this file in the same PR
  (project rule #8).
- **Visual gate:** every UI change to this section is verified with a
  harness screenshot (`npm run harness` → Design Health tab, fixture data in
  `dev/harness/fake-bus.ts`) **plus** a manual check in the real Figma
  plugin. The capture must cover **both themes and both sub-tabs** (and
  the collapsed "No token match" group) — a light-theme Tokens-only capture
  is not a complete gate; that gap is how a fully-rendered-in-tests sub-tab
  bar shipped invisible in dark Figma while every jsdom test stayed green.

## Layout invariants of this view

- The view root (`.design-health-view`) is a scrolling column-flex
  container, and every direct child sets `flex-shrink: 0`. A flex child that
  carries its own `overflow: hidden` (the library SegmentedControl) has an
  automatic minimum size of **0**, so without this rule the flex algorithm
  crushes it to zero height as soon as the issue list overflows the panel —
  the bug that made the whole sub-tab bar disappear in Figma while every
  jsdom test stayed green.
- The sub-tab bar additionally lives in its own explicit wrapper
  (`.health-tabs-row`) — a bare structural container (no surface styling, so
  the control renders with its native geometry). It always stays
  in-flow inside the view's scroll container — it must never become a direct
  child of the `.root` grid, where auto-placement would drop it into the
  48px footer row beneath `.footer { overflow: hidden }`.
- **Confidence chip semantics:** HIGH is the silent default and renders no
  chip (inside "Ready to auto-fix" every row is high by definition — the
  chips carried zero information); only deviations (medium/low) render a
  chip.
