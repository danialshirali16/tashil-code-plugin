# Semantic Connect — Architecture Decisions

Status: Implemented (M1–M8)
Companion: [`semantic-connect-roadmap.md`](semantic-connect-roadmap.md)
User guide: [`semantic-connect.md`](semantic-connect.md)

This records the decisions actually made while implementing semantic connect,
including how the roadmap's **Open decisions** were resolved. It is the source
of truth for those questions; update it when a decision changes.

## A. Persistence: an optional recipe on schema v4, not a schema v5 bump

The roadmap proposed bumping `CURRENT_SCHEMA_VERSION` from 4 to 5. **We did
not.** A semantic recipe is an optional `semanticRecipe` field on the existing
schema-v4 `ConnectionMetadata`, carrying its own independent
`SEMANTIC_RECIPE_SCHEMA_VERSION` (currently 2).

Why:

- Recipe authoring can evolve without invalidating every connection's metadata
  version — exactly the independence the roadmap asked for.
- Existing schema-v4 connections keep generating byte-identical output. Recipe
  migrations run in memory and are persisted only after an explicit save.
- The version bump can still happen later, once the recipe shape is stable.

Consequence: `CURRENT_SCHEMA_VERSION` stays **4**. Do not bump it until a
change genuinely breaks the connection envelope.

## B. Compatibility with older plugin builds

A semantic connection is valid schema-v4 metadata with one extra field. The
metadata validators check known fields and do not reject unknown keys, so an
older build is expected to **read the connection successfully and ignore the
recipe**, generating from `propMappings`.

For a semantic-only connection `propMappings` is empty, so an older build
produces a bare `<Component />` — **degraded output, not corruption, and not
data loss** (the recipe is only lost if that older build then saves over it).
This is the trade accepted in exchange for avoiding a v5 envelope bump.

## C. Legacy `propMappings` are not written for semantic connections

Semantic recipes do not compile back into legacy `propMappings`. The two paths
are independent: a connection either resolves through the semantic pipeline
(when `semanticRecipe` is present) or through `propMappings`. Legacy
connections are untouched and byte-stable.

*(Resolves: "Should schema-v5 continue writing legacy `propMappings`?")*

## D. One generation pipeline

Dev Mode, Inspect Code, **and** Layout Composer / frame inspection resolve a
connection through the same code path (`createConnectedOutput` in `main.ts`,
`createConnectedUsage` in the layout resolver). Parity is a test invariant, not
a convention.

Nested design values resolve differently by surface, deliberately:

| Surface | Top-level props | Nested values |
| --- | --- | --- |
| Dev Mode / Inspect (component selected) | live from the instance | live from the instance subtree (overrides win) |
| Layout Composer / frame inspection | live from the instance | from the recipe's captured snapshot |

The layout path uses captured samples so it never traverses a connected
component's internals — preserving the atomic-boundary invariant.

## E. Runtime props are emitted inline *and* listed separately

A runtime target emits `prop={undefined /* Set in application. */}` inside the
copyable TSX **and** appears in a separate **Set in application** section.

Why both: the inline comment keeps copied code valid and self-documenting at
the exact call site, while the separate section gives a checklist that does not
contaminate mapping diagnostics. A required callback marked runtime never
blocks saving.

*(Resolves: "Should a runtime prop be copied as a comment, omitted, or
represented in a second non-copyable requirements section?")*

## F. Static values are first-class in M3

Every design-bindable target offers **Static value…** alongside Figma values,
Set in application, and Omitted, in the same single control.

*(Resolves: "Should static values be first-class in M3 or deferred?")*

## G. Bounded traversal and limits

| Limit | Value | Rationale |
| --- | --- | --- |
| `maxTargetPathDepth` | 8 | Bounded recursive object paths |
| `maxLocatorDepth` | 16 | Bounded descendant search for authoring |
| `maxExtractionNodes` | 2 000 | Hard traversal budget per component scan |
| `maxNestedSources` | 256 | Keeps the value list and metadata bounded |
| `maxBindings` | 256 | Bounds persisted recipe size |
| `maxSerializedLength` | 128 000 chars | Hard cap on persisted metadata |
| `maxContractTargets` | 512 | Bounds extracted public APIs |
| `maxRepeatedSlotItems` | 64 | Bounds connected children in a repeated slot |

Extraction callers may request lower per-scan traversal limits for constrained
surfaces. Invalid or higher overrides fall back/clamp to the safe hard limits.
When a depth, node, or nested-source limit truncates a scan, the snapshot stores
structured diagnostics and the Connect editor reports that its candidates are
partial. Deeper object nesting stays **visible as runtime/unsupported**, never
silently dropped.

*(Resolves: "What is the maximum supported nested code prop depth?" — two path
segments.)*

## H. Source/target multiplicity

- **One Figma source may feed several code targets.** Nothing prevents reusing
  the same property or nested value for more than one target; this is a real
  pattern (one label feeding both a visible string and an `aria-label`).
- **One code target has exactly one binding.** Setting a target's value
  replaces its previous binding, so a target can never be doubly owned.
- **Object assembly conflicts are detected**: binding a whole object prop and
  also binding one of its leaves produces an explicit diagnostic rather than
  silently losing one of them.
- **Arrays preserve a bounded item schema.** Application-data collections stay
  runtime inputs; arrays of connected React-node slots can be authored and
  ordered explicitly.

*(Resolves: "Can one Figma source feed multiple code prop targets?" — yes.
"Can multiple Figma sources assemble one array prop in version 1?" — no.)*

## I. A separately connected nested instance: values *and* component value

When a nested instance has its own Tashil connection, the extractor records its
**exposed component properties as semantic value sources** for the parent, then
**stops descending** into it (its internals are never harvested).

The owning decision sits with the *parent* recipe, which may:

- consume the child's **values** (e.g. its `label`);
- use the child **as a whole component value** for a target that expects one
  (`renderLeftIcon={<TrashIcon />}`) via the `instance` binding source; or
- ignore it.

The component-value path (added 2026-07-24) exists because the legacy pipeline
already emitted icon instance swaps as JSX, so semantic connections would
otherwise regress on real icon props. Safety rules:

- The child's identity comes **only from its own saved connection** — the
  parent never invents a component name.
- The component name is validated against the JSX identifier pattern both at
  save time (schema) and at format time (usage IR), so a persisted recipe can
  never inject text into generated JSX.
- The child's import is merged into the parent's import list, deduplicated.
- Only targets classified `node` (React node slots) may take a component value.

*(Resolves: "When a nested component has its own connection, who owns the
decision to inline it versus consume its values?")*

## J. Semantic roles live in the recipe only

Explicit semantic roles and locators are stored **only in the recipe** on the
connection target. No plugin data is written onto descendant layers.

Why: descendant plugin data is invisible to the owner, hard to clean up, and
would make a design file carry connection state in many places. Keeping the
recipe as the single record makes export, diffing, and removal trivial.

*(Resolves: "Where should explicit semantic roles live?")*

## K. Locator precedence and fragility

Binding sources are preferred in this order:

1. Exposed top-level Figma component property (stable property ID).
2. Nested component property reached through a stable component identity.
3. Nested text/property confirmed by the connection owner.
4. Static value authored in the recipe.
5. Runtime placeholder.

A locator anchored to a nested instance's **component key** is stable; a
locator that can only be expressed as a **layer-name path** is marked
`fragile: true`, surfaced in the value list and in connection health, and
called out in reconciliation.

## L. Transforms are declarative only

Only bounded, declarative transforms are persisted: enum option → source
literal, boolean mapping, omit-when-empty, object assembly, static literal, and
runtime. **No arbitrary JavaScript is ever persisted or evaluated** — no
`eval`, no `Function`, no user-authored code.

Enum equivalence uses explicit alias groups (`VALUE_ALIAS_GROUPS`), including
the size scale (`sm↔small`, `xl↔xlarge`). An unlisted pairing stays unmapped
and surfaces as a review warning rather than being fuzzily guessed.

## M. Suggestions never auto-save

Suggestions are proposed with a stated reason and require confirmation. Ties
produce **no** suggestion rather than a guess. The same rule governs
reconciliation: proposals are never auto-applied and bindings are never
auto-deleted.

## O. Source replacement uses a pending contract

Replacing source on an existing semantic connection does not overwrite the
accepted `sourceContract`. The new contract is stored as
`pendingSourceContract`; authoring can inspect it, but resolution continues to
use the accepted contract and bindings. Renames, exported aliases, inherited
dependency changes, and array/object schema drift become explicit proposals.
After every binding proposal is resolved, **Accept source update** promotes the
pending contract. **Keep current source** discards only the pending contract.

Recipe schema v2 introduced this pending state, extraction diagnostics, and
nested `INSTANCE_SWAP` identity. The v1→v2 migration is output-preserving and
does not promote pending source or alter bindings.

## N. Discriminated unions — deferred

Discriminated-union prop objects have no authoring affordance in v1; they
surface as `unsupported` with an explanation. Revisit once the Dialog-class
patterns are proven in real use.

*(Open decision "How should discriminated-union prop objects be authored?"
remains open by choice.)*
