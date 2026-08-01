# Layout Composer — Architecture Decisions

Status: Phase 0 baseline
Companion: [`layout-composer-roadmap.md`](archive/layout-composer-roadmap.md)

This is the single source of truth that the layout-composer phases cite. It
records the supported-node matrix, the component-usage refactor decision, and
the intermediate-representation boundary rules. Update it when a phase changes
any of those.

## A. Version 1 supported-node matrix

| Figma node / property | Version 1 behavior | Notes |
| --- | --- | --- |
| `FRAME` with `layoutMode: HORIZONTAL` | ✅ Emits a flex-row container | Auto-layout only |
| `FRAME` with `layoutMode: VERTICAL` | ✅ Emits a flex-column container | Auto-layout only |
| Nested auto-layout frames | ✅ Recursed as nested containers | Visible children only |
| Connected `INSTANCE` | ✅ Emitted as one production component | Internals never visited (atomic) |
| Connected `COMPONENT` / `COMPONENT_SET` | ✅ Same atomic component usage | Existing component codegen path |
| Standalone `TEXT` node | ✅ Emits escaped JSX text | Outside component instances only |
| `GROUP` | ✅ Transparent container, no layout meaning | Does not change the layout contract |
| Auto-layout wrapping (`layoutWrap: WRAP`) | ✅ `flex-wrap: wrap` | Counter-axis spacing applies |
| `layoutMode: NONE` | ✅ Reconstructed as a freeform positioned container | Children retain Figma-local coordinates; no unsupported-layout warning |
| Grid auto layout | ⚠️ Detected → placeholder | Diagnostic `grid-layout` |
| Absolute-positioned child (`layoutPositioning: ABSOLUTE`) | ✅ Reconstructed from Figma-local coordinates | No diagnostic when coordinates and CSS are preserved |
| `SECTION` used as visual organization | ✅ Emits a semantic `section` container | Visible children only |
| `LINE` | ✅ Emits a styled divider when Figma CSS is available | Falls back to SVG export only when CSS is unavailable |
| Monochrome token-bound SVG asset | ✅ Emits a CSS mask with the token as its background color | Keeps the exported vector shape while allowing theme colors |
| Multicolor SVG asset | ✅ Emits an image with its exported paints intact | Ineffective external `fill`/`stroke` CSS is omitted |
| `VECTOR`, `STAR`, `POLYGON`, `BOOLEAN_OPERATION`, `RECTANGLE` | ✅ Exports a safe SVG image asset | Failed exports produce `unsupported-paint` |
| `VIDEO`, `EMBED` | ⚠️ Detected → placeholder | Diagnostic `unsupported-node` |
| Masks, blend modes, complex effects, rotations, transforms | ⚠️ Detected → placeholder | Reported, not approximated |
| Multiple selected roots | ⚠️ Detected → invalid selection | Diagnostic per root |
| Hidden layer | Excluded from traversal | Informational diagnostic only when omission is materially useful |

A connected or unconnected component instance is **never** expanded into its
internal layers. The traversal stops at every instance boundary.

### Detected-but-not-generated cases must

- produce a valid inline JSX comment placeholder;
- produce an actionable diagnostic; and
- never cause an empty result or expose component internals.

## B. Component-usage refactor decision

`createUsageSnippet` today combines import generation and JSX formatting into
one function. Layout composition needs those pieces separately so a layout can
collect and deduplicate imports across many descendant component usages.

**Decision:** introduce a pure `createComponentUsage()` that returns a
structured result, and keep `createUsageSnippet` as a thin byte-identical
compatibility wrapper.

```ts
type ComponentUsage = {
  imports: ComponentImport[];
  jsx: string;
  diagnostics: MappingDiagnostic[];
};
```

### Compatibility gate (frozen in Phase 0)

The exact connected-component output is the contract Phase 1 must not break.
The frozen baselines, captured from the current `createUsageSnippet`, are:

**One package, mapped prop, text children:**

```tsx
import { Button } from "@tashilcar/ui";

<Button variant={"primary"}>
  Continue
</Button>
```

**Duplicate component name across packages (one usage shown):**

```tsx
import { Card } from "@tashilcar/ui";

<Card>
  Primary card
</Card>
```

These literals are pinned in `src/layout/golden.test.ts`, and the broader
golden block in `src/codegen.test.ts` (`describe('createUsageSnippet', ...)`,
covering bare components, mapped props, icon swaps, icon-only, and
self-closing `none`) is the existing gate. Phase 1's refactor must keep all of
these green and unchanged.

### Aliasing rule for duplicate names

When two component usages share an imported name but come from different module
paths, resolve the conflict with deterministic local aliases (for example
`Card` from `@tashilcar/ui` vs `Card` from `@tashilcar/forms`). The aliased
local name must be used in the generated JSX. Sorting and aliasing are
deterministic so output is reproducible across repeated calls.

## C. Intermediate representation boundary rules

These boundaries must hold throughout development:

- **Figma-specific node types** stay in the extraction layer
  (`figma-layout-extractor.ts`, `figma-component-resolver.ts`). They are never
  imported by emitters or the IR.
- **The IR contains serializable values only** — strings, numbers, booleans,
  arrays, plain objects. No Figma node references, no class instances.
- **Emitters do not import or reference Figma types.** They accept an IR
  document and return strings.
- **UI and Dev Mode adapters** receive completed strings (`tsx`, `css`) plus
  diagnostics. They never traverse Figma or call the emitters directly.

```
Figma SceneNode
    ↓  (extraction layer — the only place that touches Figma types)
Layout document IR  (serializable)
    ↓
styled-components TSX emitter + diagnostics
    ↓
Dev Mode adapter / Inspect Code adapter  (strings only)
```

### Required invariants

- Connected component output stays backwards compatible (see Section B).
- A connected instance is emitted as one React component; its internal Figma
  children are never visited. Same for unconnected instances.
- Dev Mode and Inspect Code consume the same `GeneratedLayout` result.
- Generation is read-only and never mutates the canvas or plugin data.
- Output ordering, import ordering, class names, and diagnostics are
  deterministic.
- Unsupported nodes are reported, never silently omitted.
- A failure in one descendant does not discard otherwise usable layout code.
- Generated TSX and CSS are always syntactically valid.

## D. Dev-Mode-parity pivot (2026-07-24)

**Decision:** retire the tree codegen product path (TSX + CSS Modules for a
selected frame tree, Phases 0–5 of the original roadmap) and replace it with
Dev-Mode-parity inspection: the selected node's **Layout** and **Style** CSS
sections plus **Connected component** information. See the rewritten
[`layout-composer-roadmap.md`](archive/layout-composer-roadmap.md).

### Why

- Generated full-tree TSX over-commits the developer: invented wrappers,
  class names, and file scaffolding fight the target codebase's conventions
  and are usually discarded. The values developers actually copy are the CSS
  declarations (with design tokens) and the connected component usage.
- Tree-shaped generation carried the project's largest hardening surface
  (naming collisions, import aliasing, placeholder contracts, depth/node
  limits, fuzzing). Single-node inspection is O(1) and removes it.
- The plugin's differentiators are: Inspect Code brings Dev-Mode-like CSS to
  Design-mode seats; CSS and the Tashil snippet appear in one combined view;
  variable-backed values surface as `var(--token, fallback)`.

### CSS source of truth

`node.getCSSAsync()` — the same CSS Figma's native inspect panel shows,
including bound variables. The plugin partitions its output into Layout and
Style buckets with an explicit property table (roadmap §"Layout / Style
partition") and otherwise passes it through unmodified. We do not rebuild
Figma's CSS serializer.

Desk verification (2026-07-24, `@figma/plugin-typings` 1.130.0):
`getCSSAsync()` is declared on `SceneNodeMixin` — every scene node — as a
stable API (no `enableProposedApi`), and the manifest's `editorType` already
includes both `figma` and `dev`. Remaining in-Figma spike items: confirm
Design-mode output matches Dev Mode per node type, and confirm
variable-backed values emit `var(--name, fallback)` in this file setup.

### What survives / what is retired

Kept: `codegen.ts` component usage (byte-compatible contract in Section B),
`figma-component-resolver.ts`, `generation-context.ts` caches and limits, and
the extractor's traversal + instance-boundary rules (trimmed into a
connected-instance enumerator). Retired from the product: `tsx-emitter.ts`,
`css-module-emitter.ts`, `imports.ts`, `naming.ts`, the composition-node IR,
and `GeneratedLayout` (replaced by `FrameInspection`). Section A's matrix and
Section C's `GeneratedLayout`-era invariants describe the retired path and
are kept for historical context; the roadmap's "Required invariants" section
is now authoritative.

Instance atomicity is unchanged and non-negotiable: connected and unconnected
instance internals are never traversed or emitted.

## E. Restore full-tree React generation (2026-07-26)

**Decision:** restore the selected-tree React/TSX and CSS Modules path as an
additive capability. A frame, group, section, or text selection now produces a
complete React module in Dev Mode and Inspect Code. Dev Mode keeps the
selected-layer Layout/Style inspection blocks introduced by ADR D.

The restored path reuses the current semantic/legacy component resolver, so a
connected instance becomes its real production usage and remains an atomic
boundary. The extractor, naming, TSX emitter, CSS Module emitter, and
orchestrator were recovered from git history and updated to:

- emit valid bracket access for kebab-case CSS Module names;
- keep same-name imports from different packages synchronized with JSX aliases;
- carry flex-child grow/stretch/fill/fixed sizing into CSS;
- traverse non-auto-layout frames in document order with an explicit warning;
- keep stale-result, depth, and node-budget guards.

Unsupported leaves and absolute positioning are never silently discarded:
they become JSX comments plus actionable generation notes. Figma geometry that
cannot be represented safely is not invented.

## F. Styled-components output and unified component library (2026-07-26)

**Decision:** selected-tree generation emits one styled-components `.tsx`
module. Generated CSS Modules, class-name references, and separate
`.module.css` blocks are retired.

Ordinary layers receive named styled declarations. Figma's `getCSSAsync()`
values are carried into the layout IR so bound variables remain
`var(--token, fallback)` references for spacing, sizing, typography, colors,
borders, radii, opacity, and effects. Structural fallbacks are used only for
properties Figma CSS did not provide.

All connected production components in a composed layout are imported from
`@tashilcar/swiss-army-knife`. Imports, the generated root export, styled
declarations, and assets share a deterministic symbol namespace.

Unconnected component instances remain atomic and render as a visible
`{/* FRAME: Layer name */}` marker plus a diagnostic. Ordinary non-component
frames do not require a connection and are generated normally.

## G. Shared generation context and validation (2026-07-26)

**Decision:** one request-scoped `GenerationContext` is shared by full React
extraction and selected-layer inspection. Component metadata, Figma variables,
and node CSS are cached as in-flight promises. Each consumer receives its own
node traversal budget, so concurrent generation cannot truncate the other
consumer. Sibling work uses bounded concurrency and merges results in document
order.

Generated modules are validated with a real TypeScript program, and every
styled template is parsed with PostCSS. The fixture suite has deterministic
snapshots, adversarial name/text/token/CSS coverage, and an adapter test that
requires Dev Mode and Inspect Code to return byte-identical TSX.

## Phase 0 artifacts

- This document (Sections A–C) — supported matrix + refactor decision + IR
  boundaries.
- `src/layout/fixtures.ts` — the 12 mocked Figma fixtures (inputs for every
  later phase).
- `src/layout/golden.test.ts` — frozen current-state expectations. Today most
  fixtures assert the pre-feature reality (frames are not yet supported); the
  connected-instance fixtures pin the exact TSX from Section B. Later phases
  flip the unsupported cases from "records current limitation" to "matches
  golden output".
