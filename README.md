![Tashil Code cover](assets/cover.png)

# Tashil Code

Tashil Code is a Figma Dev Mode plugin for connecting Figma components to their
production React components. It lets design-system owners map real source props
to Figma component properties, then gives developers a copyable TSX snippet and
reference links in Dev Mode.

## What it does

- Upload local `.ts` and `.tsx` source files to discover a component's props.
- Visually map source props and values to Figma variant, boolean, text, and
  instance-swap properties.
- Generate React/TSX for the Figma instance currently selected in Dev Mode.
- Store optional Storybook and source references alongside the connection.
- Detect source and Figma drift so mappings can be reviewed before they break.

The plugin has two workflows:

- **Connect component** — design-system owners select a main component or
  component set and save its code-generation metadata.
- **Tashil UI codegen** — developers select a connected instance in Dev Mode and
  copy the generated usage snippet.

Only **Component name** and **Import path** are required. Storybook and source
references are optional. Source parsing happens locally: the plugin saves the
extracted prop schema and a content hash, never the uploaded source text.

## Documentation

- [Connect a component](docs/connect-component.md) — setup from Figma selection
  to Dev Mode output.
- [Visual prop mappings](docs/prop-mapping.md) — source/Figma mapping rules,
  labels, icon slots, advanced mappings, and the Switch example.
- [Maintain a connection](docs/maintain-connections.md) — source and Figma drift,
  health states, and reconciliation.
- [Development guide](docs/development.md) — local setup, project structure,
  testing, and loading the plugin in Figma.
- [Changelog](CHANGELOG.md) — notable changes by release.

## Development

```sh
npm install
npm run build
```

For continuous builds while testing in Figma:

```sh
npm run watch
```

To run the full local verification suite:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Import `manifest.json` in Figma from:

`Plugins > Development > Import plugin from manifest...`

> **`manifest.json` is generated**, not hand-written. `npm run build` regenerates
> it from the `figma-plugin` field in `package.json`. Edit that field (then
> rebuild) to change the plugin name, menu, or capabilities — never edit
> `manifest.json` directly. It is checked in on purpose (like `package-lock.json`)
> so the shipped plugin matches committed source, and CI's `git diff --exit-code`
> step fails if it drifts — so after rebuilding, commit the regenerated
> `manifest.json` along with your `package.json` change.

## Project map

- `src/main.ts` — Figma plugin entry point, connection persistence, selection
  reads, and Dev Mode codegen registration.
- `src/ui.tsx` — Connect Component and Inspect Code screens.
- `src/ui-controller.ts` and `src/ui-state.ts` — UI state, source upload, saves,
  reconciliation, and form validation.
- `src/source-schema.ts` — local TypeScript prop extraction.
- `src/mapping-editor.ts` and `src/mapping-document.ts` — visual mapping
  authoring state and compilation to runtime JSON.
- `src/codegen.ts` — generated imports, TSX, and mapping diagnostics.
- `src/connection-health.ts` — source/Figma drift detection and health status.
