# Agent Instructions — Tashil Code

Tashil Code is a Figma Dev Mode plugin (TypeScript + Preact,
`@create-figma-plugin/build`). Single package, no monorepo. Before changing
code, read the matching section guide in [`docs/`](docs/sections-index.md).

## Roles every change must fulfill

### Update `CHANGELOG.md`

Every notable, user-facing change gets a `CHANGELOG.md` entry **in the same
change that ships the code** — not as a follow-up.

- Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions
  track the marketplace publish; there are no git tags, so `package.json` is
  the version of record.
- **Merged to `main`** → add under `## [Unreleased]` in the right category
  (`Added` / `Changed` / `Fixed` / `Compatibility`). When a marketplace publish
  is cut, move `## [Unreleased]` contents into a dated `## [1.x.0] - YYYY-MM-DD`
  section and start a fresh empty `## [Unreleased]`.
- **Still on a feature branch, not on `main`** → it does **not** belong in the
  changelog yet. The changelog describes what has shipped, not what is in
  development. (Verify with `git log main..HEAD` before claiming something is
  released.)
- Write user-facing prose: what changed and why it matters to a plugin user,
  not internal refactor detail. Link the matching `docs/*.md` guide when one
  exists.

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

Then verify `CHANGELOG.md` and the relevant `docs/section-*.md` are updated.
