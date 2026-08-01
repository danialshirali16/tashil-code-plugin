# Generate and inspect a frame

Tashil Code generates a complete React component for a selected frame, group,
section, or text layer, including its visible inner layout layers and connected
Tashil components. The result appears in two places:

- **Figma Dev Mode** — select the **Tashil UI** language in the Code section.
- **Tashil Code → Inspect Code** — inside the plugin, in Design mode, so
  teammates without a Dev Mode seat get the same inspection.

Selecting a **connected component instance** still produces that component's
standalone usage snippet. Vector and other leaf selections retain selected-node
CSS inspection rather than pretending to reconstruct unavailable geometry.

## What you see

### React module

The `.tsx` output includes wrappers for visible layout layers and real usages
for connected instances:

```tsx
import styled from "styled-components";
import colors from 'styles/colors';
import { Button } from "@tashilcar/swiss-army-knife";

const PaymentFormRoot = styled.div`
  display: flex;
  flex-direction: column;
  color: ${colors.text.default};
  background: ${colors.background.neutral.default};
  gap: var(--spacing-400, 1rem);
  padding: var(--spacing-600, 1.5rem);
`;

export function PaymentForm() {
  return (
    <PaymentFormRoot>
      <Button variant={"primary"}>Submit</Button>
    </PaymentFormRoot>
  );
}
```

### Styled declarations

Auto-layout direction, wrapping, gaps, padding, alignment, sizing, typography,
color, borders, radii, opacity, and supported effects are emitted inside named
styled components. Recognized color variables use the frontend
`colors` object from `styles/colors`; other bound Figma variables retain their
`var(--token, fallback)` form.

When Figma CSS is unavailable, bindings on structural fields such as gap,
padding, width, and height are reconstructed with Sync Tokens' kebab-case name
and the measured value as a fallback.

### Connected components

Instances are **atomic**: the traversal never enters a component instance.
Instead, the saved connection produces its production import and JSX, including
mapped variants and semantic connections. Imports are deduplicated across the
whole selected design and consolidated into
`@tashilcar/swiss-army-knife`. Import, root, and styled-component name
collisions receive matching deterministic aliases.

### Selected-layer CSS in Dev Mode

Dev Mode also includes the selected node's **Layout** and **Style** CSS blocks
from `getCSSAsync()`. These are passed through unmodified, so bound values keep
their `var(--token, fallback)` form.

### Accessibility checks

Inspect Code shows advisory badges when the selected layer exposes enough CSS
for local analysis: WCAG AA/AAA contrast between resolved foreground and
background colors, the 24×24px minimum touch target, and a 12px minimum
font-size heuristic for text. Variable-based or unsupported colors are skipped
rather than guessed. Warnings never block copying generated code.

### Generation notes

Anything the generator could not safely turn into code becomes a note instead of
being silently dropped:

- an instance with **no saved connection** (`{/* FRAME: Button */}`) — connect
  it via **Connect component** and it will become a production component usage;
- an instance whose stored connection is broken or whose main component is
  missing;
- unsupported assets, preserved as JSX comments;
- non-auto-layout frames, emitted as relative positioning contexts with
  ordinary children placed from their Figma-local coordinates;
- a very large tree truncated at the node/depth budget.

Inspect Code keeps these notes separate from **Set in application**, which lists
runtime values required by semantic component recipes. The summary card reports
unresolved components, unsupported assets, and omitted declarations so the
fidelity of a generated module is visible before copying it.

## Troubleshooting

- **A component is a JSX marker** — open **Connect component**, save a valid
  connection on its main component, and reselect the frame.
- **An ordinary frame is not connected** — ordinary frames do not require
  connections and are generated as styled components.
- **No styled import** — the selected root has no generated styles, as with a
  standalone unstyled text node.
- **`background: --token-name;` without `var()`** — Figma's CSS engine emits
  the raw variable name when it cannot resolve a fallback value; the plugin
  passes Figma's output through unmodified.
