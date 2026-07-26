# Connect components with a different structure

This guide explains how to connect a Figma component to a production React
component **when the Figma layer structure does not resemble the source code**.
It complements [How to connect a component](connect-component.md) (which covers
the simple, structurally-matched case) and [Visual prop mappings](prop-mapping.md).

## When you need this

Sometimes a Figma component is built from nested frames and sub-components that
look nothing like the flat, prop-driven API of the real component. The classic
example is a dialog:

```text
Figma "Dialog"                       Source <ConfirmationDialog>
├── Header                           intent:        'danger' | 'default'
│   ├── Title                        title:         string
│   └── Description                  description?:   string
└── Footer                           cancelAction:  { label }
    ├── Secondary action             confirmAction: { label }
    └── Primary action               onConfirm:     () => void
```

The Figma tree has a Header and a Footer; the source component has none of
that — it exposes flat and nested **props** instead. Semantic connect maps the
*values* found anywhere in the Figma component to the source component's public
API, and generates the real code:

```tsx
import { ConfirmationDialog } from "@tashilcar/swiss-army-knife";

<ConfirmationDialog
  intent={"danger"}
  title={"Delete account?"}
  description={"This action cannot be undone."}
  cancelAction={{ label: "Cancel" }}
  confirmAction={{ label: "Delete" }}
  onConfirm={undefined /* Set in application. */}
/>
```

The core rule never changes: **Inspect shows the real public code API.** The
plugin never invents compound components like `Dialog.Header` just because a
`Header` layer exists.

## Author a semantic connection

1. Select the Figma main component or component set and run
   **Plugins → Development → Tashil Code → Connect component**.
2. Enter the **Component name** and **Import path** as usual.
3. Upload the component's TypeScript source (props interface plus, if needed,
   the sibling files it imports types from — see
   [Source files](#source-files-and-what-is-parsed) below).
4. The **Implementation mapping** section appears. Code props are the primary
   column, grouped into:
   - **Content** — text such as `title`, `description`.
   - **Variants & states** — enum props such as `intent`, `size`.
   - **Actions** — nested action objects such as `confirmAction.label`.
   - **Slots** — React node slots.
   - **Application behavior** — callbacks such as `onConfirm`.
   - **Excluded by policy** — `className`, styles, refs (shown with a reason).
5. For each target, use the single value control to choose one of:
   - a **Figma value** (a top-level component property or a nested text /
     instance property);
   - **Static value…** — a literal you type in;
   - **Set in application** — supplied by application code (callbacks default
     here);
   - **Omitted** — leave an optional prop out.
6. Review the inline **Generated code preview**, then **Save**.

### Suggestions

When you upload source, the plugin proposes a starting mapping and marks each
suggested row. Suggestions are based on an explicit, testable dictionary — for
example `title` → `Header / Title`, and `confirmAction.label` →
`Footer / Primary action / label` (disambiguated from `cancelAction.label` by
region). Enum values are aliased across casing and abbreviation, so a Figma
`Size = Small | Medium | Large | xLarge` variant maps onto a source
`'sm' | 'md' | 'lg' | 'xl'` union. **Suggestions are never auto-saved** — review
each one before saving.

### Fragile locators

A value pulled from a nested layer is located either by a **stable component
identity** (preferred) or by **layer name path** (fragile). Fragile locators
are flagged in the value list and in connection health, because renaming the
layer will break them. Prefer connecting to nested **instances** (which carry a
stable component key) over plain frames/text where you can.

## Source files and what is parsed

Source text stays local; only a derived, serializable contract is persisted.
The parser understands realistic production interfaces:

- Props inherited through `extends`, including `Omit<Base, …>` and
  `Pick<Base, …>`.
- Type aliases imported from sibling files (upload those files too).
- Nested object props one level deep (`confirmAction.label`), including
  `Omit<ButtonProps, …>` config objects.
- `string | ReactNode` props treated as free text.

Not supported in this release (shown as **unsupported**, never silently
dropped): arrays of objects, objects nested more than one level deep, and props
whose value should be a whole component. `className`, `style`, `ref`, and
similar are **excluded by policy**.

## What developers see in Inspect

Selecting a connected instance shows:

- The production-shaped **TSX** as the copyable result.
- **Set in application** — the runtime props (callbacks, etc.) to wire up.
- **Why this structure?** — which design value produced each code prop.
- **⚠️ Deprecated** — replacement guidance when the connection is deprecated
  (the code is still shown; see [Deprecation](#deprecation)).

The same result appears in Figma Dev Mode's Code section and when the component
is nested inside an inspected frame.

## Deprecation

A connection can carry optional lifecycle metadata (owner, package
name/version, state, and replacement guidance). When a connection's state is
**deprecated**, Inspect and Dev Mode show a deprecation notice with the
replacement guidance — but never withhold the generated code, so existing
usages remain inspectable.

## Keeping a connection healthy

If the Figma component or the source changes after you connect, the editor
surfaces a **Changes need review** panel with explicit actions:

- **Accept remap** — when a nested source moved but kept its component
  identity, or a source prop was renamed to a single type-compatible target.
- **Remove mapping** — when a source or design value disappeared with no safe
  match.

Nothing is auto-applied or auto-deleted, and changes persist only when you
**Save**. Re-uploading source over a saved connection asks for confirmation
first so you never lose mappings by accident. See
[Maintain a connection](maintain-connections.md) for the full lifecycle.
