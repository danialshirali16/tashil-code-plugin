# Project Brief: Tashil Code

Tashil Code is a Figma Dev Mode plugin that connects design-system components
in a Figma file to their production React APIs. A component owner creates and
saves a connection once; developers can then select an instance in Dev Mode to
copy a React/TSX usage snippet that reflects its active Figma properties.

The plugin is intentionally local-first:

- It runs in Figma and is built with TypeScript, Preact, and
  `@create-figma-plugin`.
- It has no network access. It does not fetch a repository, Storybook, or
  source code.
- Uploaded TypeScript source is parsed in the UI. The original source text is
  not persisted; only a derived props snapshot, file name, and content hash are
  saved.
- Connections are stored as Figma shared plugin data on the main component or
  component set, so the connection travels with the design file.

## The user-facing workflow

### 1. Connect a Figma component to React

Open **Connect component** in the development plugin. The UI scans the file for
local main components and component sets, so an owner can open a component from
the inventory instead of locating it on the canvas. Selecting a component on
the canvas also opens it as a connection target.

The owner supplies the React component name and import path, and may add a
Storybook URL, source path, and source URL. They can then either:

- upload the component's `.ts`/`.tsx` props source and map the discovered React
  props visually; or
- generate a starter mapping from Figma variant and instance-swap properties,
  then edit it.

The visual editor supports variant, boolean, text (`children`), and
instance-swap/icon relationships. It compiles those choices into a runtime
lookup table: an active Figma property and option resolve to a React prop and
value. Advanced mappings remain available for intentional cases the visual
editor cannot represent.

On save, the plugin validates the connection, snapshots the selected Figma
component schema, increments the mapping revision, and writes the metadata to
shared plugin data. Required data is deliberately small: component name and
import path. The rest is optional or derived.

### 2. Generate code from a selected instance

In Figma Dev Mode, select one connected instance, main component, or component
set and choose **Tashil UI** in the Code section. The plugin:

1. Resolves the component that owns the saved connection.
2. Reads the selected node's active component-property values, text, and
   available instance swaps.
3. Validates and migrates stored metadata when necessary.
4. Looks up the active Figma values in the saved mapping table.
5. Produces imports and TSX, plus separate mapping diagnostics and reference
   information when applicable.

For example, a Figma `Intent = Primary` option can map to
`intent={"primary"}`. If the source declares `children` and it is connected to
a Figma text property, the text is emitted as JSX children; otherwise the
component is self-closing. The generated code can add an `Icon` import when a
supported icon slot is driven by an instance swap.

The plugin's **Inspect Code** view mirrors this result in its UI, keeps
diagnostics outside the copyable TSX, and offers saved Storybook and source
references as separate actions.

### 3. Keep the connection healthy

Each source-backed connection records a source-props snapshot and a Figma
component-schema snapshot. When a component changes, the owner can re-upload
source and/or review the current Figma properties. The plugin classifies the
connection as healthy, needing review, broken, or requiring a source refresh.

Reconciliation is deliberately non-destructive: stale mappings stay visible
until the owner explicitly removes them and saves. Figma-only properties can
remain unmapped when they describe prototype or inspection states rather than
public React props.

## How the code is organized

```text
Figma plugin runtime                         Plugin UI
--------------------                         ---------
src/main.ts  <---- typed Figma messages ---> src/ui-controller.ts
     |                                                |
     | persistence, selection, codegen               | drafts, validation,
     | inventory, Figma API                           | uploads, reconciliation
     v                                                v
src/codegen.ts <---- mapping data ---- src/mapping-editor.ts / mapping-document.ts
     |
     +-- generated imports, TSX, and diagnostics
```

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin entry point; Figma selection and component-inventory reads; shared-plugin-data persistence; Dev Mode codegen registration. |
| `src/ui.tsx` | Preact views for the component inventory, connection editor, Inspect Code, and help. |
| `src/ui-controller.ts` / `src/ui-state.ts` | UI messages, per-component drafts, source uploads, mutation state, validation, and reconciliation. |
| `src/source-schema.ts` | Local TypeScript AST parsing for props interfaces, literal values, prop roles, and simple defaults. |
| `src/mapping-editor.ts` / `src/mapping-document.ts` | Visual-mapping suggestions and compilation into the stable `propMappings` lookup table. |
| `src/connection-health.ts` | Comparison of saved and current source/Figma snapshots. |
| `src/codegen.ts` | Metadata validation/migration, mapped-prop resolution, imports, JSX, and diagnostics. |
| `src/inspect/` | Dev-Mode-parity selected-layer CSS partitioning and connected-component enumeration. |
| `src/layout/` | Full selected-tree styled-components React generation with token-aware CSS, atomic component usages, deterministic naming, and traversal limits. |
| `src/types.ts` | Shared persisted schema, Figma-message contracts, and domain types. |

The plugin and UI communicate through typed messages rather than the UI calling
the Figma API directly. That separation keeps browser/UI concerns (uploads,
form state, rendering) independent from Figma concerns (selection, shared data,
and Dev Mode codegen), and makes the core code-generation functions testable.

## Mapping and generation rules at a glance

- Figma variants and booleans can map to React props with string, number, or
  boolean values.
- `children` maps to a Figma text property only when the uploaded source
  exposes a `children` prop.
- Supported icon render slots map to Figma instance swaps; the selected icon is
  resolved at generation time rather than being saved as a fixed component ID.
- Generated children and some icon-mode props are reserved. A conflicting
  mapping is omitted and reported instead of generating invalid duplicate JSX.
- Any active Figma property/value without a usable mapping produces a
  diagnostic rather than an invented React prop.
- A source-backed connection is rechecked only after its current source files
  are uploaded again, because raw source text is never retained.

Read [Visual prop mappings](prop-mapping.md) for the complete mapping contract
and examples, and [Maintain a connection](maintain-connections.md) for the
drift and reconciliation workflow.

## React layout generation and inspection

Selecting a frame, group, section, or text layer generates a complete
styled-components React module in both Dev Mode and Inspect Code. Visible
inner layout layers remain in document order; connected instances become their
production component usages and remain atomic. Auto-layout structure maps to
styled declarations, while unsupported or broken descendants surface as notes.

Dev Mode additionally shows the selected node's token-aware **Layout** and
**Style** CSS from Figma's `getCSSAsync()` output. See
[Generate and inspect a frame](inspect-frame.md) for the user guide,
[Styled-Components Layout Roadmap](styled-components-layout-roadmap.md) for the
active plan, and
[Layout Composer Architecture Decisions](layout-composer-decisions.md)
(ADRs D–F) for the decision history.

## Develop and verify

Use Node.js 22 or later.

```sh
npm install
npm run typecheck
npm test
npm run lint
npm run build
```

`npm run build` also generates `manifest.json` from the `figma-plugin` section
of `package.json`. Load that manifest through Figma's development-plugin import
flow. For iterative work, use `npm run watch` and reload the plugin after a
local rebuild.

For setup details, testing expectations, and the Figma import steps, see the
[Development guide](development.md).
