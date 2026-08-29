# Agent Instructions — Tashil Code

Tashil Code is a Figma Dev Mode plugin (TypeScript + Preact,
`@create-figma-plugin/build`). Single package, no monorepo. Before changing
code, read the matching section guide in [`docs/`](docs/sections-index.md).

### Keep documentation in sync

- Before editing `src/<section>/`, read the matching `docs/section-*.md`.
- If a change alters a module map, a section boundary, an invariant, or a
  "rule an editor must keep," update that section guide in the same change.
- See [Documentation changes](docs/development.md#documentation-changes) for the
  full list of which doc to update for which behavior.

## Project-wide rules (do not break these)

These are the load-bearing invariants. Full detail in
[Figma Editor Modes](docs/section-editor-modes.md) and
[Section guide index](docs/sections-index.md).

- **`manifest.json` is generated.** Never hand-edit. Change the `figma-plugin`
  field in `package.json`, run `npm run build`, commit the regenerated
  `manifest.json`. CI's `git diff --exit-code` fails on drift.
- **`*Async` Figma APIs only.** `documentAccess: "dynamic-page"` makes the
  deprecated sync APIs (`getLocalVariableCollections()`, `getVariableById()`,
  `getMainComponent()`, …) throw. Use the `*Async` variants.
- **Pure cores are Figma-free.** `src/sync-tokens/`, `src/semantic/` (except
  `figma-adapter.ts`), `src/layout/` IR, and `src/inspect/` must not import
  `@figma/plugin-typings` — they compile under the test project, which has none.
  The Figma API is reached only through `src/main.ts` (and the named adapters).
- **`figma.mode` gates the two surfaces.** Design mode (`figma.mode === 'default'`)
  runs the UI/message layer; Dev Mode returns early and only runs
  `figma.codegen.on('generate')`. Don't cross the gate.
- **One generation pipeline, three surfaces.** Dev Mode, Inspect Code, and
  Layout Composer resolve a connection through the same code path. Parity is a
  test invariant.

## Before handing off a change

```sh
npm run typecheck   # 4 tsconfig contexts
npm test            # vitest run
npm run lint        # eslint .
npm run build       # typecheck + build-figma-plugin --minify
```

Then verify the relevant `docs/section-*.md` guide is updated.
