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
2. Confirm the read-only **Figma component name**, then enter the **Source
   component name** and **Import path**. These identities may differ: the Figma
   name references the design component, while the source name is emitted in
   imports and JSX.
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

### Complex component defaults

Components with large public APIs start from a curated minimum instead of
emitting every optional callback and framework override. For example:

- `TashilDropdown` starts with application-owned `options`, `value`, and
  `onChange`.
- `TashilMenu` starts with application-owned `options`, `handleClose`,
  `anchorEl`, and `open`.
- `TashilTab` starts with application-owned `items`. Choosing connected
  component tabs switches to `components` and automatically leaves `items`
  out because the source component treats those inputs as alternatives.
- `Sessions` keeps session collections, the active session, application name,
  and delete actions in application code while loading and display flags remain
  available for Figma mapping.
- `Pagination` keeps count, current page, and change handling in application
  code. Switching to `defaultPage` automatically leaves controlled `page` out.
- `TashilDataGrid` keeps required rows and columns in application code. Loading
  and selection appearance remain Figma-mapped, while optional MUI callbacks
  and render hooks begin as **Left out**. This default is based on the wrapper's
  inherited `@mui/x-data-grid@5.17.2` contract; controlled selection remains an
  explicit opt-in.
- `TashilDataGridPro` follows the same required rows-and-columns minimum using
  its inherited `@mui/x-data-grid-pro@6.9.1` contract. Pro-only selection,
  tree-data, detail-panel, pinning, and event APIs remain explicit opt-ins;
  visual flags can still be mapped from Figma.
- `TashilAuthentication` keeps the active challenge, its complete page-props
  union, and back navigation in application code. Figma supplies titles,
  descriptions, button text, logo visibility, and other presentation state.
  The page-props union stays whole because each authentication challenge has a
  different callback and validation shape.
- `TashilCheckout` keeps checkout rows, bank options, the initial bank, and
  submit/back actions in application code. Its optional `totalAmount` stays
  left out by default because the component derives it from checkout rows;
  logo and responsive presentation remain available for Figma mapping.
- `TashilOtpInput` keeps entered `values`, `onChange`, and `onComplete` in
  application code. Validation and presentation—including error variant,
  helper text, loading, disabled state, and size—remain Figma-derived;
  optional array/config overrides begin as left out.
- `TashilUpload` keeps controlled `files` plus change, retry, and remove actions
  in application code. Upload copy, helper/validation state, sending state,
  required state, and size remain Figma-derived. Optional rejection reporting
  starts left out because the component already renders rejection feedback.
- `TashilNewMessage` keeps attachment state/actions and message submission in
  application code while composer content and state remain Figma-derived.
  `textInputProps.value` and `textInputProps.onChange` always start left out
  because the component owns and overwrites both fields internally.
- `Drawer`, `TashilDesktopModal`, and `TashilMobileDrawer` keep visibility,
  close handling, and content in application code. Drawer/dialog appearance
  remains Figma-derived, while paper, modal, slide, and transition overrides
  begin as **Left out**.
- `TashilInfoModal` keeps visibility, submit/cancel behavior, and custom action
  collections in application code. Modal copy, mode, loading, button state,
  and sizes remain Figma-derived; advanced button-prop objects begin left out.
- `TashilPopover` keeps visibility, close handling, anchor element, and content
  in application code. Origin and transition objects begin left out.
- `TashilTooltip` keeps its required trigger and default content in application
  code. Optional controlled-open callbacks begin left out so normal hover and
  focus behavior remains intact; arrow and interaction appearance can still be
  mapped from Figma.
- `TashilDatePicker` and `TashilJalaliDatePicker` keep date/range callbacks and
  actions in application code while mode, copy, bounds, validation state, and
  appearance remain Figma-derived. Optional initial date objects begin left out
  so the generator does not invent serialized dates from design data.
- `TashilSlider` and `Slider` keep controlled `value` and `onChange` inputs in
  application code. Bounds and appearance remain Figma-derived; `defaultValue`
  and `marks` begin left out. Opting into `defaultValue` automatically leaves
  `value` out, preserving the source components' controlled/uncontrolled API.

Optional advanced inputs begin as **Left out**. They are not removed from the
editor: select **Set in code** to opt into a fixed value or application-owned
value when the implementation needs one. Figma-derived appearance and state
continue to use the normal property mapping controls.

### Fragile locators

A value pulled from a nested layer is located either by a **stable component
identity** (preferred) or by **layer name path** (fragile). Fragile locators
are flagged in the value list and in connection health, because renaming the
layer will break them. Prefer connecting to nested **instances** (which carry a
stable component key) over plain frames/text where you can.

## Source files and what is parsed

Source text stays local; only a derived, serializable contract is persisted.
The parser understands realistic production interfaces:

- Figma and source component names may differ. The parser first follows an
  exported source component to its props type; otherwise it selects the
  strongest exported props declaration. A name mismatch produces a warning,
  not a blocking validation error. Upload still stops when the source contains
  no usable props interface or type alias.
- Props inherited through `extends`, including `Omit<Base, …>` and
  `Pick<Base, …>`.
- Type aliases imported from sibling files (upload those files too).
- Unions of local object interfaces, preserved as one application-provided
  record rather than unsafely mixing fields from different branches.
- Nested object props one level deep (`confirmAction.label`), including
  `Omit<ButtonProps, …>` config objects.
- `string | ReactNode` props treated as free text.

Arrays and records preserve bounded item/key/value schemas. Application-data
collections remain explicit runtime inputs; arrays of connected React-node
slots can be selected and ordered in the editor. Object targets may expand to
eight safe path segments. Values beyond those bounds remain visible as runtime
or unsupported rather than being silently dropped. `className`, `style`,
`ref`, and similar are **excluded by policy**.

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
  identity, a nested instance swap changed, or a source prop was renamed to a
  single type-compatible target.
- **Remove mapping** — when a source or design value disappeared with no safe
  match.
- **Accept source update** — after prop, alias, inherited type, and structured
  schema changes have all been reviewed. Until this final acceptance, the
  previous recipe continues to generate the existing output.

Large Figma components show **Figma scan is partial** when bounded extraction
reaches a depth, node, or nested-source limit. The message identifies the exact
limit so incomplete candidate inventories are never mistaken for complete
coverage.

Nothing is auto-applied or auto-deleted, and changes persist only when you
**Save**. Re-uploading source over a saved connection asks for confirmation
first so you never lose mappings by accident. See
[Maintain a connection](maintain-connections.md) for the full lifecycle.
