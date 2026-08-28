![Tashil Code cover](assets/cover.png)

# Tashil Code

> 📐 **[Install on Figma Community →](https://www.figma.com/community/plugin/1654920127584180700/tashil-code)**
>
> A local-first Figma plugin for connecting a design system to its production
> React code, synchronizing tokens, and publishing living documentation.

Tashil Code turns the decisions already present in a Figma design system into
useful production artifacts. Connect a component once and get source-accurate
React usage in Dev Mode. Inspect a layout before it is built. Export local
Variables in formats your codebase can use. Generate and maintain design-system
specification pages directly on the canvas.

The plugin runs in both Figma Design mode and Dev Mode. Design mode is where
owners configure connections, export tokens, and create documentation; Dev Mode
is where developers consume the generated code.

![Connect a component, inspect its generated TSX, and copy it](assets/demo.gif)

## What you can do

### Connect Figma components to React

Map Figma variants, booleans, text, and instance swaps to the props of a real
React component. Source-file upload can discover props locally and help with
the mapping; the original source text is never persisted. Connected instances
then generate pasteable TSX, imports, mapping diagnostics, and optional
Storybook output.

### Inspect components and layouts

Use **Inspect Code** in Design mode to preview the same connected-component
output available in Dev Mode. For frames, groups, sections, and text layers,
Tashil Code can generate a complete styled-components React module while
keeping connected instances as atomic production components. It also shows
Figma's token-aware Layout and Style CSS.

### Sync Figma Variables

Export local Variable collections as CSS custom properties, raw Markdown token
lists, flat JSON, W3C DTCG JSON, SCSS variables/maps, or a Tailwind theme
extension. Choose collections and modes, preview the exact files, control unit,
color, and naming options, and download one file or a ZIP bundle.

### Publish living documentation

The **Docs** library creates specification pages from either a Variable
Collection or a component. It uses separate search fields for **Design tokens**
and **Components**, and provides a lightweight preview before generating:

- Token sources show the number of documentation groups plus a few example
  group names, without resolving every value.
- Components show the number of variant properties and the total variant
  combinations, without building the complete matrix first.

Generate a token documentation page or a component variant matrix on the Figma
canvas. When you select a generated document later, Tashil Code reports source
drift and can update the frame in place. Selected token-documentation frames
also expose an **Export Markdown** action.

### Keep data in your file

Tashil Code makes no network requests and has no telemetry. Connections live in
Figma shared plugin data; user-specific formatting and export history live in
Figma `clientStorage`; source uploads exist only in memory while the plugin
window is open. Read the [Privacy policy](PRIVACY.md) for the full data model.

## Design-mode workspace

The plugin window has five workflows:

| Tab | Use it for |
| --- | --- |
| **Components** | Browse local main components and component sets, create or maintain their React connections, review health, manage connection imports/exports, scan coverage, and generate Storybook stories. |
| **Inspect Code** | Preview a connected component's code or generate a styled-components module from the selected design layer. |
| **Sync Tokens** | Export local Variable collections with live file previews and formatting controls. |
| **Docs** | Generate and maintain token documentation pages and component variant matrices. |
| **Settings** | Configure user-local output and copy preferences without changing the Figma document. |

## Five-minute quick start

1. [Install Tashil Code from Figma Community](https://www.figma.com/community/plugin/1654920127584180700/tashil-code), or import the local development build as described below.
2. Open a Figma file, select a main component or component set, then run
   **Plugins → Development → Tashil Code → Connect component**.
3. In **Components**, enter the exported React component name and its import
   path. Upload its `.ts` or `.tsx` props source if you want guided mappings,
   then save the connection.
4. Select an instance and open **Inspect Code**, or switch Figma to Dev Mode,
   select **Tashil UI** in the Code section, and copy the generated TSX.
5. To publish specifications, open **Docs**, choose a token collection or a
   component, review its lightweight preview, then generate the canvas page.

Only a component name and import path are required to save a connection.
Storybook and source references are optional.

## How the two Figma surfaces work

| Surface | Purpose |
| --- | --- |
| **Design mode** | Author connections, inspect output, sync tokens, create and update documentation, and change local preferences. |
| **Dev Mode** | Select an instance or a supported design layer, then choose **Tashil UI** in Figma's Code section to read generated code. Dev Mode never changes the Figma document. |

A connected instance yields its production React usage. A frame, group, section,
or text layer yields a styled-components module with connected child components
left intact. The Design-mode Inspect Code view and Dev Mode share the same
connection-resolution pipeline, so their connected-component output stays in
parity.

## Documentation workflow

Open **Docs** and choose one of its two scopes:

1. **Design tokens** — select a local Variable Collection, review the group
   summary, and choose **Generate page**. The generated frame keeps native
   Variable bindings for color swatches and can be reconciled in place after a
   token change.
2. **Components** — select a local component, review the expected variant
   combination count, and choose **Generate variants** to create its
   specification matrix.

Use **Refresh** to reload the active scope—Variable Collections for the token
scope or the component inventory for the component scope. Selecting a generated
documentation frame shows its status, source drift when present, and an
**Update in place** action. Token-documentation frames additionally offer
Markdown export from that status area.

For the detailed token flow, see [Token Documentation](docs/token-documentation.md).
For the renderer, in-place reconciliation, and editor constraints, see the
[Documentation section guide](docs/section-documentation.md).

## Local development

### Requirements

- Node.js 22 or later (see [`.nvmrc`](.nvmrc))
- npm
- A Figma account that can import development plugins

### Install and build

```sh
npm install
npm run build
```

`npm run build` type-checks the project, builds the plugin into `build/`, and
regenerates `manifest.json` from the `figma-plugin` configuration in
`package.json`.

For continuous rebuilding:

```sh
npm run watch
```

For browser-based visual QA of the real plugin UI with local Figma-message
fixtures:

```sh
npm run harness
```

Then open `http://127.0.0.1:5178/dev/harness/index.html`.

### Load the development plugin in Figma

1. Run `npm run build` at least once.
2. In the Figma desktop app, open **Plugins → Development → Import plugin from
   manifest…**.
3. Choose this repository's [`manifest.json`](manifest.json).
4. Run **Plugins → Development → Tashil Code → Connect component** from a
   design-system file.

Reload the development plugin in Figma after each rebuild; Figma otherwise
continues to use the previously loaded bundle.

> `manifest.json` is generated. Do not edit it by hand—change the
> `figma-plugin` section of `package.json`, run `npm run build`, and commit the
> regenerated manifest with the configuration change.

## Guides

| Guide | Use it when you need to… |
| --- | --- |
| [Connect a component](docs/connect-component.md) | Create a connection, map props, import/export connections, scan coverage, or generate Storybook stories. |
| [Visual prop mappings](docs/prop-mapping.md) | Understand mapping rules, slots, advanced mappings, and examples. |
| [Maintain a connection](docs/maintain-connections.md) | Review source/Figma drift and reconcile a saved connection. |
| [Generate and inspect a frame](docs/inspect-frame.md) | Work with full styled-components output and Figma CSS inspection. |
| [Sync Tokens](docs/sync-tokens.md) | Export Variable collections and understand formats, modes, and naming controls. |
| [Token Documentation](docs/token-documentation.md) | Generate, update, and export token documentation. |
| [Development guide](docs/development.md) | Set up the repository, use the harness, understand testing, and import the development plugin. |
| [Section guide index](docs/sections-index.md) | Navigate the project architecture and its editor invariants. |
| [Privacy policy](PRIVACY.md) | Understand stored, transient, downloaded, clipboard, and network data. |
| [Changelog](CHANGELOG.md) | Review notable product changes. |

## Verify a change

Run the complete local suite before handing off a change:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Tests use Vitest. UI interactions run through Preact Testing Library and jsdom;
plugin-side tests use local Figma API doubles.

## Project map

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Figma entry point, async Figma API adapter, selection handling, shared plugin-data persistence, Docs generation, and Dev Mode codegen registration. |
| `src/ui.tsx` / `src/ui-controller.ts` | Preact workflows, UI state, typed message handling, source uploads, reconciliation, and documentation previews. |
| `src/semantic/` | Recipe-based connections for components whose Figma structure differs from their source API. |
| `src/inspect/` | Dev-Mode-parity CSS partitioning and connected-component enumeration. |
| `src/layout/` | Selected-tree styled-components React generation. |
| `src/sync-tokens/` | Pure token serialization for the supported export formats. |
| `src/documentation/` | Pure document models plus Figma canvas writers and in-place reconcilers. |

The UI and Figma runtime communicate through typed messages. Pure model and
serialization code stays independent of Figma typings, keeping it testable
outside the Figma runtime.

## License

MIT. See [`package.json`](package.json) for the package metadata.
