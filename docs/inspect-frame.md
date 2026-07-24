# Inspect a frame

Tashil Code inspects any single selected layer the way Figma's own Dev Mode
inspect panel does — and adds the connected Tashil component code that panel
cannot show. The same result appears in two places:

- **Figma Dev Mode** — select the **Tashil UI** language in the Code section.
- **Tashil Code → Inspect Code** — inside the plugin, in Design mode, so
  teammates without a Dev Mode seat get the same inspection.

Selecting a **connected component instance** still produces the component's
usage snippet exactly as before. This guide covers every other selection:
frames, groups, sections, text, vectors — anything.

## What you see

### Layout

The node's structural CSS: `display`, `flex-direction`, `gap`, `padding`,
alignment, and sizing. The declarations come from Figma's own CSS engine
(`getCSSAsync`) and are passed through unmodified, so values backed by Figma
variables keep their token form:

```css
display: flex;
padding: 12px var(--spacer-2, 0.5rem);
justify-content: space-between;
align-items: center;
```

### Style

The node's visual CSS: background, border, radius, shadow, opacity,
typography. Shown only when the node has visual declarations:

```css
border-bottom: 1px solid var(--color-border);
```

Layout and Style are split with a fixed property table (structural properties
→ Layout; everything else → Style), and each section is copyable on its own.

### Connected components

For a frame, the plugin walks its visible layers and lists every **connected**
component instance inside it as ready-to-paste code — the same output you
would get selecting each instance individually, with imports deduplicated and
each usage labeled with a source comment relative to the selected frame:

```tsx
import { Button } from "@tashilcar/ui";

//./ Frame 1430105165 / Button
<Button variant={"primary"}>
  Submit
</Button>
```

Instances are **atomic**: the traversal never enters a component instance, so
component internals are never re-generated as layout code. Toggle the source
comments with the **Layer path comments** preference in Dev Mode's code panel
settings (next to the language dropdown).

### Notes

Anything the inspection could not turn into code becomes a note instead of
being silently dropped:

- an instance with **no saved connection** (`"Button" is not connected to a
  production component`) — connect it via **Connect component** and it will
  appear in the code list;
- an instance whose stored connection is broken or whose main component is
  missing;
- a very large frame truncated at the node budget;
- a runtime where Figma cannot produce CSS for the node.

## Why this shape

The plugin deliberately does **not** generate full TSX + CSS Modules for a
frame tree. Generated wrappers, invented class names, and scaffolded files
fight the conventions of the codebase they land in and usually get discarded.
What developers actually copy are the CSS values (with design tokens) and the
correct component usage — so that is exactly what the plugin produces, and
nothing else. The full rationale is recorded in
[Layout Composer Architecture Decisions](layout-composer-decisions.md), ADR D.

## Troubleshooting

- **A component I expect is missing from the list** — check the Notes
  section: it is almost always an unconnected instance. Open **Connect
  component**, save a connection on its main component, and reselect.
- **The Style section is empty** — the node has no visual declarations;
  that's normal for pure layout wrappers.
- **No CSS sections at all** — the running Figma surface could not produce
  CSS for this node (see the note shown). The connected-components list still
  works.
- **`background: --token-name;` without `var()`** — Figma's CSS engine emits
  the raw variable name when it cannot resolve a fallback value; the plugin
  passes Figma's output through unmodified.
