# Development Guide

This repository contains the Tashil Code Figma Dev Mode plugin. It is a
TypeScript/Preact project built with `@create-figma-plugin/build`.

## Requirements

- Node.js 22 or later
- npm
- A Figma account with permission to import a development plugin

## Install and build

```sh
npm install
npm run build
```

The build performs TypeScript checks and writes the plugin bundle to `build/`.
It also generates `manifest.json` from the `figma-plugin` field in
`package.json`.

For iterative work, run:

```sh
npm run watch
```

For browser-based visual QA of the real plugin UI and its local Figma-message
fixtures, run:

```sh
npm run harness
```

Then open `http://127.0.0.1:5178/dev/harness/index.html`. The harness includes a
connected Button, generated Inspect Code output, token collections, and output
settings. It is the source used for the README demo capture.

## Load the plugin in Figma

1. Build the project at least once.
2. In Figma, open **Plugins > Development > Import plugin from manifest…**.
3. Choose this repository's `manifest.json`.
4. Select a main component, component set, or instance and run
   **Plugins > Development > Tashil Code > Connect component**.
5. In Dev Mode, select a connected instance and choose **Tashil UI** in the
   Code section.

After a local rebuild, reload the development plugin in Figma before testing the
new bundle.

## Verify changes

Run these commands before handing off a change:

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

Tests use Vitest. UI interaction tests run with Preact Testing Library and
jsdom; plugin-side tests cover Figma API behavior with local test doubles.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/main.ts` | Plugin entry point, Figma selection handling, shared plugin-data persistence, and Dev Mode codegen registration. |
| `src/ui.tsx` | Connect Component, Inspect Code, and help views. |
| `src/ui-controller.ts` | Source upload, mapping edits, save/clear operations, reconciliation, and UI messaging. |
| `src/ui-state.ts` | Form state, validation, and pending mutation state. |
| `src/source-schema.ts` | Local parsing of TypeScript props and simple implementation defaults. |
| `src/mapping-editor.ts` | Compatible-property suggestions and visual mapping mutations. |
| `src/mapping-document.ts` | Compilation of editor state into runtime `propMappings` JSON. |
| `src/connection-health.ts` | Source and Figma drift analysis. |
| `src/ci-manifest.ts` / `scripts/review-connections.mjs` | Pure manifest drift review and its read-only Node CLI. |
| `src/code-connect.ts` | Downloadable Code Connect formatter. |
| `src/codegen.ts` | TSX generation, legacy metadata migration, and diagnostics. |
| `src/inspect/` | Dev-Mode-parity selected-layer CSS partitioning and connected-component enumeration. |
| `src/layout/` | Full selected-tree styled-components React generation, token-aware Figma CSS extraction, atomic component resolution, naming, per-request caches, and bounded traversal/concurrency. |
| `src/types.ts` | Shared messages, persisted schema, and domain types. |
| `docs/` | Product and contributor documentation. |

The plugin has a deliberate boundary between authoring and runtime code:

```txt
Source + Figma snapshots
        ↓
Visual mapping document
        ↓
Compiled propMappings JSON
        ↓
Dev Mode TSX codegen
```

`mappingDocument` preserves authoring snapshots and reconciliation state.
`propMappings` is the stable runtime table consumed by code generation.

Selected-tree generation and selected-layer inspection share one
`GenerationContext` per Dev Mode request. The context deduplicates component,
connection, variable, and node-CSS reads; each traversal retains an independent
node budget, and sibling async work is bounded while results remain in Figma
document order.

## Persisted data and compatibility

Connections are stored as shared plugin data on the selected Figma component
using the `tashil_storybook` namespace and `connection` key. The current schema
version is 5. Older supported connection shapes are read and migrated in memory;
the Figma document is updated only after the owner explicitly saves.

Do not manually edit shared plugin data while testing unless the change is part
of a migration test. Use the plugin UI to create or clear connections.

Review an exported connection manifest against repository source with:

```sh
npm run review:connections -- \
  --connections tashil-connections.json \
  --source-root /absolute/path/to/repository \
  --json
```

The command is read-only, rejects paths outside `--source-root`, and exits
non-zero for drift, missing source/snapshots, invalid paths, or invalid exports.

## Manifest changes

Do not edit `manifest.json` by hand. Change the `figma-plugin` configuration in
`package.json`, run `npm run build`, then commit the regenerated manifest with
the configuration change. This keeps the checked-in development manifest aligned
with the shipped plugin.

## Documentation changes

When a user-facing mapping or maintenance behavior changes, update the relevant
guide in the same change. When a section's module map, boundary, or invariants
change, update its section guide too:

- [Section guide index](sections-index.md) and the five `section-*.md` guides
  for module-level architecture and the rules each section enforces.

When a user-facing mapping or maintenance behavior changes, update the relevant
guide in the same change:

- [Connect a component](connect-component.md) for setup and Dev Mode behavior.
- [Visual prop mappings](prop-mapping.md) for mapping semantics and examples.
- [Maintain a connection](maintain-connections.md) for drift/reconciliation.
- `README.md` for repository-level onboarding and links.
- `PRIVACY.md` when stored, transient, downloaded, clipboard, or network data
  handling changes.
- [Community demo guide](community-demo.md) when onboarding or the companion
  quick-start flow changes.
- `CHANGELOG.md` for notable user-facing changes.

### Manual Storybook verification

After changing `src/storybook.ts` or mapped Storybook args, generate a story for
a connected single component and a component set, copy the resulting
`*.stories.tsx` files into the consuming library's Storybook project, and run
that project's normal static Storybook build. Large-set verification must also
confirm that generation stops for subset selection above 32 variants.
