# Styled-Components Layout Generation Roadmap

Status: In progress — styled-components, color tokens, and freeform geometry implemented

Date: 2026-07-26

Related decisions: [`layout-composer-decisions.md`](layout-composer-decisions.md)

Replaces the generated CSS Module direction for selected-design React output.

## Objective

When a user selects a supported design root in Figma, Tashil Code generates a
complete React component that:

1. uses `styled-components`, never CSS Modules;
2. preserves visible inner layout layers in document order;
3. emits connected production components as atomic usages;
4. resolves live instance properties, semantic values, text overrides, and
   instance swaps;
5. references color variables through `colors` from `styles/colors`, while
   preserving CSS custom-property tokens for layout, typography, radius, and
   effect declarations;
6. imports every connected Tashil component from
   `@tashilcar/swiss-army-knife`;
7. preserves usable React output when selected-layer inspection fails.

The result appears in both Figma Dev Mode and **Tashil Code → Inspect Code**.
Both surfaces must consume the same generated result.

## Agreed product decisions

- [x] Generate one React `.tsx` module containing named styled components.
- [x] Do not generate `.module.css` files.
- [x] Do not generate CSS Module imports, class names, or
  `styles["class-name"]` expressions.
- [x] Import `styled` from `styled-components`.
- [x] Import connected Tashil components and icons from
  `@tashilcar/swiss-army-knife`.
- [x] Keep connected instances atomic: generate their production usage but
  never traverse their internal Figma layers.
- [x] Resolve connected instances from their live selected state, not only the
  snapshot stored with the connection.
- [ ] Generate ordinary frames, groups, sections, text, and supported visual
  leaves without placeholder comments.
- [x] Preserve an unconnected component or instance as a visible JSX comment
  marker and diagnostic.
- [x] Do not add a marker merely because an ordinary non-component layer is not
  connected; ordinary layers do not require a component connection.
- [x] Keep generation read-only and deterministic.
- [x] Keep React generation and selected-layer inspection in independent failure
  domains.

## Target output contract

### Connected components

All production components use one library import:

```tsx
import styled from "styled-components";
import {
  Button,
  CreditCardIcon,
  Dialog,
} from "@tashilcar/swiss-army-knife";
```

Repeated usages of the same export produce one import. If an imported name
conflicts with the generated root or a styled component, the generator assigns
one deterministic alias and reuses it everywhere:

```tsx
import styled from "styled-components";
import { Button as SwissArmyButton } from "@tashilcar/swiss-army-knife";

const ButtonLayoutRoot = styled.div`
  display: flex;
`;

export function ButtonLayout() {
  return (
    <ButtonLayoutRoot>
      <SwissArmyButton />
      <SwissArmyButton />
    </ButtonLayoutRoot>
  );
}
```

### Token-aware styled declarations

Tokens apply to the complete style surface, not only colors. The generator
should preserve or reconstruct token references for:

- layout: `gap`, row/column gap, padding, sizing, offsets, and dimensions;
- typography: font family, font size, font weight, line height, and letter
  spacing;
- visual styles: foreground, background, border, radius, and opacity;
- effects: box shadow, text shadow, blur, and related supported effects.

Target:

```tsx
import colors from 'styles/colors';

const PaymentCardRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--spacing-400, 1rem);
  padding: var(--spacing-600, 1.5rem);

  background: ${colors.background.neutral.default};
  border-color: ${colors.border.neutral.default};
  border-style: solid;
  border-width: var(--border-width-default, 1px);
  border-radius: var(--radius-large, 0.75rem);
  box-shadow: var(--shadow-card, 0 4px 12px rgb(0 0 0 / 8%));
`;

const Heading = styled.h2`
  color: ${colors.text.default};
  font-family: var(--font-family-body, Inter, sans-serif);
  font-size: var(--font-size-heading-small, 1.125rem);
  font-weight: var(--font-weight-semibold, 600);
  line-height: var(--line-height-heading-small, 1.5rem);
`;
```

Token resolution precedence:

1. For a color-related declaration whose complete value is a recognized Figma
   color variable, convert the variable path to the frontend token object:
   `var(--color-text-default, #111827)` becomes
   `${colors.text.default}`.
2. Add `import colors from 'styles/colors';` once, and only when at least one
   generated declaration uses that object.
3. Preserve non-color `var(--token, fallback)` values returned by
   `getCSSAsync()` exactly.
4. When structural CSS is derived from Figma layout properties, inspect the
   property's bound variable and emit its CSS token name plus the calculated
   literal fallback.
5. Reuse Sync Tokens' kebab-case naming contract so generated references match
   the custom properties exported by the plugin.
6. Emit a literal value only when no Figma variable is bound.
7. Never guess a token by comparing two equal literal values.

The initial color-token conversion supports whole-value variables on color,
background, border-color, outline, fill, stroke, caret, and related color
properties. Mixed shorthand values such as
`1px solid var(--color-border-default)` remain unchanged until the emitter can
represent literal and token-expression segments without guessing.

### Correct unconnected-component behavior

An unconnected component is an atomic boundary. It is not expanded, because
doing so would make generated code depend on the component's private design
layers.

If `Discount badge` is an unconnected component or instance:

```tsx
import styled from "styled-components";

const OfferCardRoot = styled.article`
  position: relative;
  width: var(--size-offer-card-width, 20rem);
  min-height: var(--size-offer-card-height, 11.25rem);
  padding: var(--spacing-600, 1.5rem);
`;

export function OfferCard() {
  return (
    <OfferCardRoot>
      <span>Special offer</span>
      {/* FRAME: Discount badge */}
    </OfferCardRoot>
  );
}
```

The marker must be accompanied by a generation diagnostic explaining that the
component needs a saved connection.

If `Discount badge` is an ordinary frame rather than a component, it does not
need a connection and must be generated normally:

```tsx
import styled from "styled-components";
import colors from 'styles/colors';

const OfferCardRoot = styled.article`
  position: relative;
  width: var(--size-offer-card-width, 20rem);
  min-height: var(--size-offer-card-height, 11.25rem);
  padding: var(--spacing-600, 1.5rem);
`;

const DiscountBadge = styled.div`
  position: absolute;
  top: var(--spacing-400, 1rem);
  right: var(--spacing-400, 1rem);
  padding: var(--spacing-100, 0.25rem) var(--spacing-300, 0.75rem);
  background: ${colors.background.positive.default};
  color: ${colors.text.positive.default};
  border-radius: var(--radius-pill, 999px);
`;

export function OfferCard() {
  return (
    <OfferCardRoot>
      <span>Special offer</span>
      <DiscountBadge>20% off</DiscountBadge>
    </OfferCardRoot>
  );
}
```

### Parent-aware fill sizing

Main-axis and cross-axis fill must be emitted differently:

```tsx
const PageRoot = styled.div`
  display: flex;
  flex-direction: row;
  gap: var(--spacing-400, 1rem);
`;

const Sidebar = styled.aside`
  flex: 0 0 var(--size-sidebar-width, 15rem);
  width: var(--size-sidebar-width, 15rem);
`;

const Content = styled.main`
  flex: 1 1 0;
  min-width: 0;
  align-self: stretch;
`;
```

- Main-axis `FILL` becomes flex growth.
- Cross-axis `FILL` becomes stretch or `100%`, according to the parent contract.
- Fixed main-axis sizing receives a fixed flex basis.
- Hug sizing remains intrinsic unless another Figma constraint requires CSS.

## Architecture changes

### Intermediate representation

Extend the layout IR so emitters do not need Figma nodes:

```ts
type CssDeclaration = {
  property: string;
  value: string;
  source: "figma-css" | "layout";
  token?: {
    cssName: string;
    fallback?: string;
    variableId: string;
  };
};

type StyledElement = {
  element: string;
  name: string;
  declarations: CssDeclaration[];
};
```

Each generated ordinary node carries:

- a deterministic styled-component name;
- its semantic HTML element;
- structural declarations;
- visual and typography declarations;
- parent-axis child sizing;
- optional asset information.

Component usages remain structured as imports plus JSX. Unconnected components
remain placeholders with a Figma type/name label and diagnostic.

### Extraction boundary

The Figma extraction layer is responsible for:

- node classification;
- live connected-instance resolution;
- `getCSSAsync()` calls;
- bound-variable lookup;
- geometry and parent-axis context;
- asset-export metadata;
- producing serializable IR.

The emitter must remain pure and Figma-independent.

### Emitter boundary

Replace the CSS Module output path with a styled-components emitter:

```text
Figma SceneNode
    ↓
Serializable layout IR
    ↓
TSX + styled-components emitter
    ↓
Generated .tsx + diagnostics
    ↓
Dev Mode / Inspect Code
```

Expected module changes:

| Module | Change |
| --- | --- |
| `src/layout/css-module-emitter.ts` | Retire from product generation |
| `src/layout/tsx-emitter.ts` | Emit styled declarations and styled JSX names |
| `src/layout/styled-components-emitter.ts` | Add pure styled declaration emitter |
| `src/layout/figma-layout-extractor.ts` | Collect CSS, tokens, geometry, and parent-axis context |
| `src/layout/figma-component-resolver.ts` | Resolve live semantic values and instance swaps |
| `src/layout/imports.ts` | Enforce the single Swiss Army Knife package and deterministic symbols |
| `src/layout/naming.ts` | Allocate root, import, styled-component, and asset names together |
| `src/layout/react-layout.ts` | Return one TSX module and diagnostics; remove CSS Module metadata |
| `src/main.ts` | Isolate React and inspection failures and reuse extraction caches |
| `src/ui.tsx` | Show one generated TSX block plus diagnostics |

## Implementation phases

### Phase 0 — Freeze the new contract

- [x] Add an architecture decision superseding generated CSS Modules.
- [x] Add golden fixtures for styled-components output.
- [x] Freeze the import path as `@tashilcar/swiss-army-knife`.
- [x] Define the connected/unconnected/ordinary-layer matrix.
- [x] Define the token precedence and fallback contract.
- [x] Record `styled-components` as a generated application runtime
  requirement.

Exit criteria: the target examples in this roadmap are represented by failing
golden tests before implementation begins.

### Phase 1 — Live connected-component parity

- [x] Reuse live selection semantics for nested
  generation.
- [x] Merge connection-target, main-component, and live instance properties
  using the existing precedence.
- [x] Resolve semantic recipes from the live selected instance subtree.
- [x] Resolve instance swaps and icons from live properties.
- [x] Keep instance internals atomic.
- [x] Add a parity test asserting nested output equals standalone output for the
  same instance.

Test matrix:

- [x] legacy property mappings;
- [ ] semantic recipes;
- [ ] text overrides;
- [x] variant overrides;
- [x] boolean overrides;
- [ ] instance swaps;
- [ ] invalid and missing connection metadata.

Exit criteria: every connected instance produces the same import and JSX usage
whether selected directly or nested in a generated layout.

### Phase 2 — Token-aware declaration extraction

- [x] Add `CssDeclaration` source metadata to the IR.
- [x] Collect each ordinary node's `getCSSAsync()` output.
- [x] Preserve non-color Figma-emitted `var()` expressions exactly.
- [x] Convert recognized whole-value color variables to references on the
  frontend `colors` object and import it only when used.
- [ ] Resolve bound variables for structural values rebuilt by the layout
  extractor.
- [ ] Reuse Sync Tokens' kebab-case CSS token naming.
- [ ] Add bounded concurrency and per-generation caches for CSS and variable
  lookups.
- [x] Produce a diagnostic when CSS cannot be read, while
  preserving the remaining declarations.

Test matrix:

- [ ] gap and row/column gap;
- [ ] four-sided and shorthand padding;
- [ ] width, height, and absolute offsets;
- [ ] font family, size, weight, line height, and letter spacing;
- [x] foreground and background color-token expressions;
- [ ] border width, color, and radius;
- [ ] opacity;
- [ ] box shadow, text shadow, and blur;
- [ ] token with fallback;
- [ ] token without a resolvable fallback;
- [ ] unbound literal value.

Exit criteria: every supported property preserves a bound token and emits a
literal only when no token exists.

### Phase 3 — Styled-components emitter

- [x] Add a pure `styled-components-emitter.ts`.
- [x] Generate `import styled from "styled-components";` only when styled
  declarations exist.
- [x] Emit one deterministic styled declaration per generated ordinary layer.
- [x] Replace CSS class references with styled JSX elements.
- [ ] Support intrinsic elements such as `div`, `section`, `article`, `span`,
  `h1`–`h6`, `main`, `aside`, `img`, and `svg` where the mapping is safe.
- [x] Escape template-literal-sensitive content.
- [x] Remove `.module.css` fields and CSS Module output blocks from the generated
  result.
- [ ] Keep an optional separate `.styles.ts` emitter out of scope until the
  single-file output is stable.

Exit criteria: generated output is one valid TSX module with no CSS Module
imports, class names, or `styles[...]` expressions.

### Phase 4 — Ordinary layers, unconnected components, and freeform geometry

- [x] Classify connected component instances as production usages.
- [x] Classify unconnected components and instances as atomic comment markers.
- [x] Use the agreed unconnected marker format `{/* FRAME: Layer name */}`.
- [x] Generate ordinary frames, groups, sections, and text without connection
  markers.
- [x] Generate freeform parents with `position: relative`.
- [x] Generate absolute ordinary descendants from Figma coordinates and size.
- [ ] Add supported rectangle/vector/image asset handling.
- [ ] Preserve a diagnostic when an asset cannot be exported safely.

Required golden cases:

- [ ] unconnected `Discount badge` component →
  `{/* FRAME: Discount badge */}`;
- [ ] ordinary `Discount badge` frame → generated `DiscountBadge` styled
  component;
- [ ] connected `Discount badge` instance → Swiss Army Knife import and
  production JSX;
- [x] absolute ordinary badge → positioned styled component;
- [x] unsupported asset → comment plus diagnostic.

Exit criteria: only component boundaries require connections; ordinary design
layers are generated normally.

### Phase 5 — Unified imports and symbol allocation

- [x] Normalize every production component import to
  `@tashilcar/swiss-army-knife`.
- [x] Group all production component imports into one declaration.
- [x] Deduplicate repeated exports.
- [x] Allocate one symbol table covering imports, root exports, and styled
  declarations.
- [x] Reuse the same alias for every repeated export.
- [x] Prevent invalid identifiers in generated layout and styled names.
- [x] Add a deterministic `Layout`, `Root`, or semantic suffix when the selected
  root conflicts with an imported component.

Exit criteria: generated modules parse and typecheck for all name-collision
fixtures and contain no unused duplicate aliases.

### Phase 6 — Parent-aware sizing and layout correctness

- [x] Carry parent-axis context into styled declaration generation.
- [x] Emit main-axis fill as flex growth.
- [x] Emit cross-axis fill as stretch or percentage sizing.
- [x] Emit fixed main-axis sizes with an appropriate flex basis.
- [x] Preserve hug sizing as intrinsic sizing.
- [x] Handle nested horizontal and vertical layouts.
- [x] Add overflow guards such as `min-width: 0` or `min-height: 0` when a
  growing flex child requires them.
- [ ] Preserve token references for sizing, gap, and padding declarations.

Exit criteria: horizontal, vertical, nested, wrapping, fixed, fill, and hug
fixtures match the expected styled-components output without avoidable
overflow.

### Phase 7 — Failure isolation, performance, and UI

- [ ] Share one generation context across React extraction and selected-layer
  inspection.
- [x] Cache main components and connection metadata per generation.
- [ ] Cache variable lookups and node CSS per generation.
- [ ] Use bounded sibling concurrency while preserving document order.
- [x] Isolate React generation and selected-layer inspection errors in Dev Mode.
- [x] Preserve successful React output when inspection fails.
- [x] Preserve selected-layer inspection when React generation fails.
- [x] Show one copyable `.tsx` block in Inspect Code.
- [x] Remove the generated CSS Module block and filename.
- [ ] Show runtime requirements and generation diagnostics separately.
- [ ] Add a fidelity summary for unresolved components, unsupported assets, and
  omitted declarations.

Exit criteria: a failure in one output never discards the other, and a
500-instance fixture remains within the agreed generation budget.

### Phase 8 — Validation and migration

- [ ] Replace syntax-only `transpileModule` checks with a real TypeScript program
  validation for generated modules.
- [ ] Parse every emitted styled template with a CSS parser.
- [ ] Add deterministic snapshot tests for every roadmap fixture.
- [ ] Add fuzz tests for layer names, token names, text, import names, and CSS
  values.
- [ ] Verify Dev Mode and Inspect Code return the same TSX.
- [ ] Remove production references to CSS Module generation.
- [ ] Update README, frame-generation documentation, development architecture,
  changelog, and architecture decisions.
- [ ] Manually verify Design mode and Dev Mode in Figma.

Exit criteria: tests, typecheck, build, documentation, and manual Figma
verification are complete.

## Acceptance criteria

- [x] Generated selected-design output imports `styled` from
  `styled-components`.
- [x] Generated output contains no `.module.css`, CSS Module import, generated
  class name, or `styles[...]` expression.
- [x] Every connected Tashil component import comes from
  `@tashilcar/swiss-army-knife`.
- [x] Repeated component exports are imported once and use one stable local
  name.
- [ ] Nested connected usage matches standalone connected usage for live props,
  semantic values, text, and instance swaps.
- [ ] Gap, padding, sizing, typography, color, borders, radius, opacity, and
  supported effects preserve Figma token references.
- [x] Whole-value color variables use `colors` from `styles/colors`.
- [x] Literal fallbacks remain present where Figma provides or the extractor can
  calculate them.
- [x] Unconnected components produce a JSX marker and actionable diagnostic.
- [x] Ordinary non-component layers do not receive connection markers.
- [x] Freeform and absolute ordinary layers preserve their supported geometry.
- [x] Parent-aware fill sizing does not create avoidable flex overflow.
- [x] Unexpected inspection failure does not remove successful React output.
- [ ] Generated TSX passes real parser and type validation.
- [ ] Generated styled declarations pass CSS parsing.
- [x] Generation remains deterministic and read-only.

## Non-goals

- Generating CSS Modules as an alternative format.
- Traversing the private internal layers of any component instance.
- Guessing tokens from literal-value similarity.
- Inventing production-component connections for ordinary layers.
- Mutating the selected Figma design to make it easier to generate.
- Adding responsive breakpoints that do not exist in the design contract.
- Automatically installing `styled-components` in the consuming application.

## Recommended delivery order

1. Freeze golden output and the Swiss Army Knife import contract.
2. Fix live connected-instance parity.
3. Add token-aware declaration extraction.
4. Replace CSS Modules with the styled-components emitter.
5. Correct component-marker and ordinary-layer behavior.
6. Implement freeform geometry and parent-aware sizing.
7. Consolidate naming/imports and add semantic validation.
8. Isolate failures, optimize traversal, update UI, and complete Figma
   verification.
