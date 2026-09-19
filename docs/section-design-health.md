# Design Health — How It Works (Developer Guide)

Status: Active  
Last updated: 2026-09-19  
See also: [Section guide index](sections-index.md) · [Figma Editor Modes](section-editor-modes.md)

Design Health provides canvas- and frame-level auditing, design token linting, one-click auto-binding, smart component replacement with property migration, and library deprecation inspection in Figma Design mode.

---

## At a glance

When the Design Health tab is active, selecting a frame, component, instance, or container causes the UI to request a fresh subtree audit. Selection changes on other tabs do not run this audit:

```text
User opens Design Health or changes selection while that tab is active
   │  ui.tsx emits SCAN_DESIGN_HEALTH with a monotonic scanId
   ▼
Backend (src/main/design-health-adapter.ts)
   │  1. In-memory variable harvest: local variables, collections, and referenced tree tokens
   │  2. Resolves each token with variable.resolveForConsumer(node), respecting the node's mode
   │  3. Traverses subtree (BFS with depth & node caps, isolated node try-catch guards)
   │  4. Evaluates individual fills/strokes, radius, gap, each padding edge, and opacity
   │  5. Identifies component candidates and library deprecation tags
   │  emit SCAN_DESIGN_HEALTH_RESULT (monotonic scanId drops stale refreshes)
   ▼
UI View (src/views/DesignHealthView.tsx)
   │  Presents live audit ring, coverage score, filterable issues, and tabbed inspection:
   │  ├── Tokens tab: unbound raw values, confidence badges, alternative token selector, batch bind
   │  ├── Replacement tab: source components, target component key, compatibility plan, batch swap
   │  └── Library tab: local vs remote instance counts, deprecated components warning cards
   ▼
User triggers Action:
   ├── Apply Tokens: emit APPLY_TOKEN_BINDINGS -> setBoundVariableForPaint / setBoundVariable -> commitUndo()
   └── Replace Component: emit EXECUTE_COMPONENT_REPLACEMENT -> import target -> swapComponent -> migrate props -> commitUndo()
```

---

## Module map

| File | Role |
| --- | --- |
| `src/design-health/types.ts` | **Pure domain model.** Zero `@figma/plugin-typings` imports. Defines `TokenPropertyIssue`, `TokenAuditSummary`, `TokenSuggestion`, `CompatibilityPlan`, `ComponentReplacementCandidate`, and `DesignHealthScanResult`. |
| `src/design-health/token-audit.ts` | **Pure token linting and ranking.** Compares raw layer values against available design tokens. Scores suggestions into High, Medium, and Low confidence based on exact value match, inferred variable alias, and property scope matching. |
| `src/design-health/replacement-plan.ts` | **Pure component compatibility analyzer.** Compares property definitions between source and target components, normalizes property names (stripping Figma internal IDs like `#123:45`), checks variant option sets, and produces preservation plans. |
| `src/design-health/token-audit.test.ts` | Unit tests for pure token ranking, scope matching, and confidence classification. |
| `src/design-health/replacement-plan.test.ts` | Unit tests for property normalization and compatibility plan generation. |
| `src/main/design-health-adapter.ts` | **The Figma runtime adapter.** The only place in this feature that interacts with the Figma Plugin API: walks nodes defensively, reads bound and inferred variables, resolves tokens for each consuming node, applies precise variable bindings, swaps component instances, and commits undo steps. |
| `src/views/DesignHealthView.tsx` | **Preact UI view.** Hosts the circular SVG score ring, sub-tab navigation (`Tokens`, `Replacement`, `Library`), property filter chips, alternative token selector dropdown, and action bars. |
| `src/views/DesignHealthView.test.tsx` | UI component test suite validating score rendering, issue filtering, badge count synchronization, and user interactions. |
| `src/styles/design-health.css` | Production Figma-native stylesheet matching the official Figma UI3 color tokens and spacing guidelines. |
| `src/ui-controller.ts` | State machine and message orchestrator for `designHealthScanResult`, `designHealthStatus`, `compatibilityPlan`, and mutation dispatches. |
| `src/types.ts` | Message contract pairs (`SCAN_DESIGN_HEALTH`, `APPLY_TOKEN_BINDINGS`, `BUILD_COMPATIBILITY_PLAN`, `EXECUTE_COMPONENT_REPLACEMENT`, `FOCUS_NODE`) and their result partners. |

---

## The Pure Core (`src/design-health/`)

### 1. Token Audit & Confidence Ranking (`token-audit.ts`)

Every supported visual property (fill, stroke, corner radius, gap, each padding edge, and opacity) is evaluated against the available design system tokens:
- **High Confidence:** A Figma inferred-variable match exists.
- **Medium Confidence:** An exact value match exists with a compatible property scope, or semantic naming disambiguates multiple exact matches.
- **Low Confidence:** Multiple exact-value candidates remain ambiguous.
- **Alternatives Ranking:** When multiple tokens share the same value (e.g., `surface/default` vs `color/neutral/white`), all candidates are retained and sorted so the user can select their preferred semantic token from a dropdown.

### 2. Component Replacement Planning (`replacement-plan.ts`)

When migrating from an older or deprecated component to a new design-system component:
- Normalizes property names: `Label#123:45` $\rightarrow$ `label`.
- Maps matching properties by normalized name and checks whether the target component accepts every source variant value.
- Flags unmapped properties so users know what overrides will be lost or preserved before executing the replacement.

---

## The Figma Adapter (`src/main/design-health-adapter.ts`)

### 1. In-Memory Token Discovery
To avoid unnecessary network requests and remain compatible with document-access restrictions:
- Pulls local variables via `figma.variables.getLocalVariablesAsync()`.
- Pulls local variable collections via `figma.variables.getLocalVariableCollectionsAsync()`.
- Scans `boundVariables` and `inferredVariables` across the inspected selection tree. For any referenced external collection, retrieves its sister tokens locally via `figma.variables.getVariableCollectionByIdAsync()`.
- Resolves every candidate with `variable.resolveForConsumer(node)`, so explicit and inherited collection modes are evaluated in the context of the layer that will consume the token.

### 2. Defensive Traversal
- **Node Budget:** Bounded to 800 nodes per scan to safeguard against document freezing on massive multi-page artboards.
- **Protected Calls:** `n.getMainComponentAsync()` is wrapped in `try...catch` to prevent inaccessible remote components or broken library links from aborting the scan.
- **Node Isolation:** Property evaluations on individual nodes are wrapped in `try...catch` so that an issue on a single non-standard layer (e.g., unusual boolean operation) never crashes the remaining audit.
- **Stale Scan Cancellation:** Every scan tracks a monotonic `scanId`. Stale scans that complete after a newer selection has already started are discarded silently without emitting stale UI updates.

### 3. Mutations & Single-Step Undo
- `applyTokenBindings`: Carries an explicit binding target for every finding. Fill/stroke requests update one paint index; padding requests update one edge; radius, gap, and opacity update one node field. Each request is isolated, partial failures are counted, and `figma.commitUndo()` is called only when at least one binding changed.
- `executeComponentReplacement`: Imports the target component (or looks it up locally), revalidates that every instance still belongs to the analyzed source, calls `instance.swapComponent(targetComp)`, and reapplies only type-compatible property values. Failures and post-swap override warnings are reported separately; an undo checkpoint is committed only if at least one instance was replaced.

---

## The UI Layer (`src/views/DesignHealthView.tsx`)

1. **Circular SVG Health Ring:** Displays the percentage of design token coverage with dynamic threshold coloring ($\ge 80\%$ green `#14ae5c`, $50-79\%$ amber `#ffaa00`, $<50\%$ red `#f24822`).
2. **Tabbed Workflow:**
   - **Tokens Tab:** Shows unbound properties with layer name, exact binding field, current raw value, and recommended token. Offers property filter chips (`All`, `Fills`, `Strokes`, `Radius`, `Spacing`, `Opacity`), an `Editable layers only` toggle to hide non-overridable nested instance properties, an alternative token dropdown selector, and a single-click **Bind High Confidence (N)** button.
   - **Replacement Tab:** Lists unique components present in the selection, count of instances, and lets the user enter the key/ID of a target replacement component to generate and inspect a live compatibility report before swapping.
   - **Library Tab:** Summarizes instance composition (local vs remote) and lists components explicitly marked as deprecated with a **Focus** button. Figma's public Plugin API does not expose native library update availability, so this tab must not claim that unmarked instances are up to date.
3. **Reactive States:**
   - **Empty Selection:** Clean `EmptyInspectState` prompt when nothing is selected.
   - **In Flight:** Inline loading indicator with non-blocking UI.
   - **Error Banner:** Explicit error card with error message and a **Retry Audit** button.

---

## Invariants

1. **Active-tab scanning:** Opening Design Health and changing selection while that tab is active triggers an audit. Selection changes elsewhere update shared selection state but do not run Design Health work.
2. **Cancellable scans with monotonic `scanId`:** Any new scan supersedes older pending scans and suppresses stale emits across async bounds.
3. **Commit undo after mutation:** A batch mutation calls `figma.commitUndo()` only after at least one binding or replacement succeeds, preserving a clean single-step rollback without creating empty history entries.
4. **Safe property mapping:** Component property names are matched and persisted by normalized name (stripping unique hash IDs), verified against type and variant option sets, and revalidated against the instance's current source immediately before swapping.
5. **Editable scope distinction:** Properties inside non-root component instances are flagged as `isEditableHere: false` (`In Component`) to avoid creating unintended local instance overrides.
6. **Consumer-mode token resolution:** Candidate values are resolved with `Variable.resolveForConsumer` for the inspected node, so suggestions respect explicit and inherited variable modes.
7. **Precise binding targets:** Findings and mutation requests retain paint indices and individual padding edges; applying one suggestion must not overwrite sibling paints or asymmetric spacing.
8. **Resilient node traversal:** Isolated node errors (e.g., inaccessible remote components, removed layers) are gracefully trapped without crashing the scan.
9. **Stale result suppression:** Scan, compatibility-plan, and mutation results carry request/operation IDs. The UI ignores any result that no longer matches the latest request.
