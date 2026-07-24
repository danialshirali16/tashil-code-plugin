/**
 * Semantic connection recipe domain model (schema-v5 foundation).
 *
 * A recipe maps a source component's public code API to semantic values found
 * anywhere inside a Figma component — independent of layer hierarchy. It sits
 * between design extraction and component-usage generation:
 *
 *     Figma component → semantic extraction → recipe → usage IR → TSX
 *
 * Everything here is serializable and Figma-independent so recipes can be
 * validated, migrated, and unit-tested without the plugin runtime.
 *
 * Spec: docs/semantic-connect-roadmap.md §"Target architecture".
 */

import type { SourcePropValue } from '../types';
import type { SourceContract } from './source-contract';

/**
 * Version of the recipe document itself, independent of the connection
 * metadata schema version so authoring changes do not force a bump of all
 * connection metadata.
 */
export const SEMANTIC_RECIPE_SCHEMA_VERSION = 1;

/** Bounded limits enforced by schema validation and extraction. */
export const SEMANTIC_LIMITS = {
  /** Maximum bindings per recipe. */
  maxBindings: 64,
  /** Maximum code prop path depth (v1 supports one nested level). */
  maxTargetPathDepth: 2,
  /** Maximum segments in a Figma name-path locator. */
  maxLocatorDepth: 8,
  /** Maximum nodes visited during semantic extraction. */
  maxExtractionNodes: 400,
  /** Maximum nested sources captured in one snapshot. */
  maxNestedSources: 64,
  /** Maximum persisted recipe size in JSON characters. */
  maxSerializedLength: 32_000,
  /** Maximum source contract targets persisted with a recipe. */
  maxContractTargets: 128,
} as const;

/**
 * A code prop target as validated path segments, e.g. `['confirmAction',
 * 'label']`. Never a dot-joined string internally; joining is display-only.
 */
export type CodePropTarget = {
  path: string[];
  typeName: string;
};

/**
 * Locates a semantic value inside the connected Figma component. A name path
 * is inherently fragile (renames break it); locators that resolve through a
 * nested main-component identity keep `componentKey` so health checks can
 * survive display renames.
 */
export type SemanticLocator = {
  /** Layer names from the component root (exclusive) to the node. */
  namePath: string[];
  /** Main-component key of the nested instance, when one anchors the path. */
  componentKey?: string;
  /** True when only the name path identifies the node. */
  fragile: boolean;
};

/** An exposed top-level Figma component property (stable property id). */
export type ComponentPropertySource = {
  kind: 'component-property';
  propertyId: string;
  propertyName: string;
};

/** Text characters of a nested text layer, confirmed by the owner. */
export type NestedTextSource = {
  kind: 'nested-text';
  locator: SemanticLocator;
};

/** A component property exposed on a nested instance. */
export type NestedPropertySource = {
  kind: 'nested-property';
  locator: SemanticLocator;
  propertyName: string;
};

/** A literal authored directly in the recipe. */
export type StaticValueSource = {
  kind: 'static';
  value: SourcePropValue;
};

/** Supplied by application code; never an error, always visible. */
export type RuntimeValueSource = {
  kind: 'runtime';
  note?: string;
};

/**
 * A separately connected nested instance used as a real component value, for
 * source props that genuinely expect a component (e.g. `renderLeftIcon`).
 * The child's own connection supplies the identity, so the parent never
 * invents a component name (binding-source policy 4).
 */
export type InstanceSource = {
  kind: 'instance';
  locator: SemanticLocator;
  componentName: string;
  importPath: string;
};

export type SemanticBindingSource =
  | ComponentPropertySource
  | NestedTextSource
  | NestedPropertySource
  | InstanceSource
  | StaticValueSource
  | RuntimeValueSource;

/** Map each Figma enum/variant option to a source literal. */
export type EnumTransform = {
  kind: 'enum';
  map: Record<string, SourcePropValue>;
};

/** Map a Figma boolean to source literals (omit side when undefined). */
export type BooleanTransform = {
  kind: 'boolean';
  whenTrue?: SourcePropValue;
  whenFalse?: SourcePropValue;
};

/** Omit the target entirely when the design value is empty or false. */
export type OmitWhenEmptyTransform = {
  kind: 'omit-when-empty';
};

export type SemanticTransform =
  | EnumTransform
  | BooleanTransform
  | OmitWhenEmptyTransform;

export type SemanticRequirement = 'optional' | 'required' | 'runtime';

export type SemanticBinding = {
  /** Stable across display-name changes; never derived from layer names. */
  id: string;
  target: CodePropTarget;
  source: SemanticBindingSource;
  transform?: SemanticTransform;
  requirement: SemanticRequirement;
};

/** A nested design value discovered by the semantic extractor. */
export type FigmaNestedSourceDescriptor = {
  kind: 'nested-property' | 'nested-text' | 'nested-instance';
  locator: SemanticLocator;
  /** Human-readable path for display and diagnostics, e.g. `Header / Title`. */
  displayPath: string;
  /** Property name for nested-property descriptors. */
  propertyName?: string;
  /** Sample value captured at extraction time, for suggestions/review only. */
  sampleValue?: string;
  /** Connected component identity, for `nested-instance` descriptors only. */
  connectedComponentName?: string;
  connectedImportPath?: string;
};

/**
 * Design-side snapshot used by authoring and health checks. Top-level
 * properties continue to live in `FigmaComponentSnapshot`; this adds the
 * nested semantic sources without changing Layout Composer's atomic boundary.
 */
export type FigmaSemanticSnapshot = {
  componentId: string;
  componentName: string;
  nestedSources: FigmaNestedSourceDescriptor[];
};

export type RecipeLifecycleState =
  | 'draft'
  | 'connected'
  | 'needs-review'
  | 'deprecated';

/**
 * Optional ownership and lifecycle metadata. All fields are advisory: a
 * `deprecated` state surfaces replacement guidance in Inspect but never blocks
 * code generation (roadmap M5 §"Ownership and lifecycle").
 */
export type RecipeLifecycle = {
  state?: RecipeLifecycleState;
  /** Team or person that owns this connection. */
  owner?: string;
  /** Source package identifier, e.g. `@tashilcar/ui`. */
  packageName?: string;
  /** Source package version this connection was authored against. */
  packageVersion?: string;
  /** Replacement guidance shown when the state is `deprecated`. */
  replacement?: string;
};

export type SemanticConnectionRecipe = {
  schemaVersion: typeof SEMANTIC_RECIPE_SCHEMA_VERSION;
  figmaSnapshot: FigmaSemanticSnapshot;
  /** Derived source API (never source text) so authoring can reopen later. */
  sourceContract?: SourceContract;
  bindings: SemanticBinding[];
  revision: number;
  lastValidatedAt?: string;
  lifecycle?: RecipeLifecycle;
};

/** Render a target path for humans (`confirmAction.label`). Display only. */
export function formatTargetPath(target: CodePropTarget): string {
  return target.path.join('.');
}

/** Separator for locator keys; layer names can never contain NUL (charCode 0). */
export const LOCATOR_KEY_SEPARATOR = String.fromCharCode(0);

/** Stable key for locator lookup tables. */
export function locatorKey(locator: SemanticLocator): string {
  return locator.namePath.join(LOCATOR_KEY_SEPARATOR);
}
