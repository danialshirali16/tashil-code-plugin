# Semantic Connect — How It Works (Developer Guide)

Status: Active (M1–M5 implemented on `main`)
Last updated: 2026-07-31
Companion: [decisions](semantic-connect-decisions.md) · [archived roadmap](archive/semantic-connect-roadmap.md) · [user guide](semantic-connect.md)

Semantic Connect is the code path used when a Figma component's structure does
**not** match its source code — e.g. the source exposes `confirmAction.label`
nested under a handler, but Figma has a flat `label` text property. Instead of
the visual prop-mapping table (see the core-connect section), the connection
carries a **recipe** that the resolver turns into a production `ComponentUsage`.

## At a glance

```text
Authoring (src/semantic-editor-view.tsx)
   │  createRecipeDraft / setTargetOption / validateRecipeDraft   (authoring.ts)
   ▼
Persisted as ConnectionMetadata.semanticRecipe   (schema-v4, schemaVersion 1)
   │
   ├──► Dev Mode + Inspect   createConnectedOutput   (src/main.ts:347)
   └──► Layout Composer      createConnectedUsage    (src/layout/figma-component-resolver.ts:183)
                │
                ▼
        resolveSemanticUsage(componentName, importPath, recipe, design)   (resolver.ts)
                │
                ▼
        ComponentUsage  →  JSX  (formatted in usage-ir.ts)
```

The single resolution entry point — `resolveSemanticUsage` — feeds all three
generation surfaces. **Parity across them is a test invariant.**

## Module map

| File | Role |
| --- | --- |
| `src/semantic/types.ts` | Pure domain model. `SEMANTIC_RECIPE_SCHEMA_VERSION = 1`, `SEMANTIC_LIMITS`, `SemanticConnectionRecipe`, `LOCATOR_KEY_SEPARATOR` (NUL). Zero Figma typings. |
| `src/semantic/schema.ts` | `validateSemanticRecipe` — runs on the connection **read** path before any recipe is trusted. Never throws; returns actionable messages. Rejects versions newer than supported without mutating data. |
| `src/semantic/resolver.ts` | `resolveSemanticUsage(...)` — the single resolution entry. Returns plain `ComponentUsage` so the connected component stays atomic in layout generation. |
| `src/semantic/authoring.ts` | Pure authoring model: `createRecipeDraft`, `setTargetOption`, `setTargetValueMapping`, `buildTargetRows`, `validateRecipeDraft`. "The editor state *is* the recipe." |
| `src/semantic/reconcile.ts` | `planReconciliation`, `applyProposal`, `markRecipeReconciled`. Turns drift into reviewable proposals; applied only on explicit user action. |
| `src/semantic/source-contract.ts` | `extractSourceContract` — describe a component's public API as code-prop targets via execution-free TS parsing. Source text never persisted; only the derived contract. |
| `src/semantic/figma-extractor.ts` | `extractFigmaSemanticSnapshot` — bounded extraction of nested design values for connect authoring and codegen **only**. Layout Composer never consumes these. |
| `src/semantic/figma-adapter.ts` | **The only semantic module that touches Figma plugin types.** `createSemanticNodeTree` adapts a live `SceneNode` tree to the pure `SemanticNodeLike`. |
| `src/semantic/migrate.ts` | Bidirectional: `migrateMappingDocumentToRecipe` (legacy → recipe) and `compileRecipeToPropMappings` (simple subset → legacy, byte-stable). |
| `src/semantic/health.ts` | `evaluateSemanticHealth` — drift detection, report-only, never mutates bindings. |
| `src/semantic/usage-ir.ts` | `UsageValue` IR + `formatUsageProp`. **JSX is produced only here**, with validated identifiers and escaped values. Throws `TypeError` on invalid JSX identifiers rather than emitting malformed code. |
| `src/semantic/debug-bundle.ts` | `createConnectionDebugBundle` — **redacted-by-construction** support bundle. Never copies source text, URLs, or design content. |
| `src/semantic/flags.ts` | `SEMANTIC_CONNECT_AUTHORING_ENABLED = true`. Gates only the authoring UI; reading saved recipes is always on. |
| `src/semantic-editor-view.tsx` | The Preact "Implementation mapping editor" — renders `buildTargetRows` + `validateRecipeDraft`, live-previews via `resolveSemanticUsage`. |

## Rules an editor must keep

1. **Pure core, one adapter.** Every module above is pure and Figma-free
   **except** `figma-adapter.ts`. Do not import `@figma/plugin-typings`
   anywhere else in `src/semantic/`. The test project compiles the pure core.
2. **`semanticRecipe` is a field on schema-v4, NOT a v5 bump.** A semantic
   recipe is an optional `semanticRecipe` field on the existing schema-v4
   `ConnectionMetadata`, carrying its own independent
   `SEMANTIC_RECIPE_SCHEMA_VERSION` (1). `CURRENT_SCHEMA_VERSION` stays **4**.
   See [decision A](semantic-connect-decisions.md#a-persistence-an-optional-recipe-on-schema-v4-not-a-schema-v5-bump).
3. **One generation pipeline, three surfaces.** Dev Mode, Inspect, and Layout
   Composer all resolve through `resolveSemanticUsage`. If you change
   resolution, parity tests will fail unless all three follow.
4. **Recipes do not compile back to legacy `propMappings`** beyond a simple
   lowerable subset (direct `component-property` + `enum` transform + single
   segment path). The two paths are independent. Legacy connections are
   byte-stable.
5. **Validation never throws.** `validateSemanticRecipe` and the resolver
   return actionable messages; they surface problems as diagnostics, never as
   thrown exceptions that break generation.
6. **Reconciliation never auto-deletes a binding.** Removal is an explicit user
   action (`applyProposal(..., 'remove')`). Match by stable identity
   (`componentKey`) before any rename heuristic; ambiguity yields `source-removed`.
7. **`revision` advances only in `markRecipeReconciled`**, called after a
   successful save. `applyProposal` never mutates input and never bumps revision.
8. **`debug-bundle.ts` redaction is load-bearing.** Source text, reference
   URLs/paths, and design content (nested text, sample values, layer-name
   paths) are never copied — only their presence/depth/fragility. Public-API
   code identifiers (component name, import path, target paths) **are**
   included. Preserve this on every edit.

## Gotchas

- **Option-id grammar is load-bearing.** `authoring.ts` emits ids like
  `prop:<propertyId>`, `nested:nested-text:<locatorKey>:`,
  `nested:nested-property:<locatorKey>:<propertyName>`,
  `nested:nested-instance:<locatorKey>:`, plus constants `OPTION_UNSET=''`,
  `OPTION_RUNTIME='runtime'`, `OPTION_STATIC='static'`, `OPTION_OMITTED='omitted'`.
  `getTargetOptionId` / `getUsedSourceOptionIds` must round-trip this exact format.
- **`LOCATOR_KEY_SEPARATOR` is NUL** (`String.fromCharCode(0)`). Layer names
  can never contain NUL, so `locatorKey(locator) = namePath.join(NUL)` is a
  stable lookup key. Validators reject any segment containing NUL.
- **`CodePropTarget.path` is an array internally**, never a dot-joined string.
  Use `formatTargetPath(target)` for display only.
- **`OMITTED` is rejected for required targets.** An omitted event prop is
  restated as `optional` (not `runtime`) to avoid contradiction.
- **`source-contract.ts` must stay aligned with `source-schema.ts`.** Both use
  `selectSourcePropsInterface`, so the visual and semantic editors describe the
  same interface. The interface name must end in `Props`.
- **`figma-extractor.ts` is bounded by `SEMANTIC_LIMITS`.** On limit it returns
  **partial** results + diagnostics instead of failing. A separately connected
  nested instance is offered once as a `nested-instance` descriptor; its
  internals are **not** harvested.

## In progress (`GLM/Token-syncs` branch — not on `main`)

The editor-diagnostics and library-compatibility work lives on the
`GLM/Token-syncs` branch and is **not** in the working tree on `main`:

- **Editor diagnostics** — `validateRecipeDraft` returning a
  `RecipeValidationSummary`; the editor renders a `CompatibilitySummary` +
  per-message lists before save.
- **Audit report** — `createComponentAuditReport` (new `src/semantic/audit-report.ts`)
  deriving per-kind target counts + unsupported paths from a live
  `SourceContract`; exportable as Markdown/JSON.
- **Library compatibility** — `src/semantic/library-compatibility.ts` with the
  explicit `@tashilcar/swiss-army-knife` baseline table +
  `auditLibraryComponent` + `countTargetKinds`, plus the
  `scripts/audit-library-compatibility.mjs` CI runner (`npm run audit:library`).
- **Source parsing pipeline** — `src/source-props.ts`, `src/source-type-program.ts`
  feeding `source-contract.ts`.
- **Archived roadmap** — `docs/archive/full-library-support-roadmap.md` (M0–M8; M7 is the
  editor/diagnostics work).

When this merges, fold these into the module map above and remove this section.

## Related docs

- [Semantic Connect — Architecture Decisions](semantic-connect-decisions.md) (the source of truth for resolved open questions)
- [Semantic Connect archived roadmap](archive/semantic-connect-roadmap.md)
- [Semantic Connect user guide](semantic-connect.md)
- [Section guide index](sections-index.md) · [Development guide](development.md)
