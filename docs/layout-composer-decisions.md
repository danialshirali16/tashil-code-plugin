# Layout Composer — Architecture Decisions

Status: Phase 0 baseline
Companion: [`layout-composer-roadmap.md`](layout-composer-roadmap.md)

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
| `layoutMode: NONE` | ⚠️ Detected, not generated → placeholder | Diagnostic `unsupported-layout-mode` |
| Grid auto layout | ⚠️ Detected → placeholder | Diagnostic `grid-layout` |
| Absolute-positioned child (`layoutPositioning: ABSOLUTE`) | ⚠️ Detected → placeholder | Diagnostic `absolute-positioning` |
| `SECTION` used as visual organization | ⚠️ Detected → placeholder | Diagnostic `unsupported-node` |
| `VECTOR`, `STAR`, `POLYGON`, `LINE`, `BOOLEAN_OPERATION`, `RECTANGLE`, `VIDEO`, `EMBED` | ⚠️ Detected → placeholder | Diagnostic `unsupported-node` |
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
TSX emitter + CSS Modules emitter + diagnostics
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
