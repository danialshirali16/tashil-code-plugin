/**
 * Exportable, redacted connection-debug bundle (roadmap M5 §"Recovery and
 * supportability").
 *
 * The bundle describes a connection's *structure and state* for support and
 * bug reports without leaking anything sensitive. It is redacted by
 * construction — the assembler only ever reads counts, kinds, hashes, code
 * identifiers, and severities. It never copies:
 *
 * - source text (only the pre-computed `contentHash`);
 * - reference URLs or paths (only booleans for their presence);
 * - design content — nested text characters, captured sample values, static
 *   literals, transform value maps, or layer-name paths (only depth/fragility);
 * - credentials (none are present in connection data).
 *
 * Code identifiers that are part of the public API — the component name, import
 * path, and source prop target paths (e.g. `confirmAction.label`) — are
 * included, because they are what a maintainer needs to reason about an issue
 * and are not customer content.
 */

import { SEMANTIC_RECIPE_SCHEMA_VERSION, formatTargetPath } from './types';
import type {
  RecipeLifecycleState,
  SemanticBinding,
  SemanticConnectionRecipe,
} from './types';
import type { SemanticHealthIssue, SemanticHealthSeverity } from './health';

export const DEBUG_BUNDLE_VERSION = 1;

export type DebugBundleBinding = {
  targetPath: string;
  sourceKind: SemanticBinding['source']['kind'];
  requirement: SemanticBinding['requirement'];
  transformKind?: 'enum' | 'boolean' | 'omit-when-empty';
  /** Present for nested sources: how deep the locator is and whether it is fragile. */
  locatorDepth?: number;
  fragileLocator?: boolean;
};

export type ConnectionDebugBundle = {
  bundleVersion: typeof DEBUG_BUNDLE_VERSION;
  connectionSchemaVersion: number;
  recipeSchemaVersion?: number;
  componentName: string;
  importPath: string;
  revision?: number;
  lastValidatedAt?: string;
  lifecycleState?: RecipeLifecycleState;
  /** Package identifiers only (no URLs). */
  packageName?: string;
  packageVersion?: string;
  figma?: {
    componentId: string;
    nestedSourceCount: number;
  };
  source?: {
    contentHash: string;
    targetCount: number;
    unsupportedTargetCount: number;
  };
  bindingCount: number;
  bindings: DebugBundleBinding[];
  /** True when any bound design value is located by layer name only. */
  hasFragileLocators: boolean;
  references: {
    hasStorybookUrl: boolean;
    hasSourceUrl: boolean;
    hasSourcePath: boolean;
  };
  health?: {
    total: number;
    bySeverity: Record<SemanticHealthSeverity, number>;
    /** Code prop paths with a non-warning issue; no free-text messages. */
    affectedTargets: string[];
  };
};

export type DebugBundleInput = {
  componentName: string;
  importPath: string;
  connectionSchemaVersion: number;
  recipe?: SemanticConnectionRecipe;
  references?: {
    storybookUrl?: string;
    sourceUrl?: string;
    sourcePath?: string;
  };
  healthIssues?: readonly SemanticHealthIssue[];
};

export function createConnectionDebugBundle(
  input: DebugBundleInput,
): ConnectionDebugBundle {
  const recipe = input.recipe;
  const bindings = (recipe?.bindings ?? []).map(summarizeBinding);

  const bundle: ConnectionDebugBundle = {
    bindingCount: bindings.length,
    bindings,
    bundleVersion: DEBUG_BUNDLE_VERSION,
    componentName: input.componentName,
    connectionSchemaVersion: input.connectionSchemaVersion,
    hasFragileLocators: bindings.some((binding) => binding.fragileLocator === true),
    importPath: input.importPath,
    references: {
      hasSourcePath: Boolean(input.references?.sourcePath),
      hasSourceUrl: Boolean(input.references?.sourceUrl),
      hasStorybookUrl: Boolean(input.references?.storybookUrl),
    },
  };

  if (recipe) {
    bundle.recipeSchemaVersion = recipe.schemaVersion;
    bundle.revision = recipe.revision;
    if (recipe.lastValidatedAt !== undefined) {
      bundle.lastValidatedAt = recipe.lastValidatedAt;
    }
    bundle.figma = {
      componentId: recipe.figmaSnapshot.componentId,
      nestedSourceCount: recipe.figmaSnapshot.nestedSources.length,
    };
    if (recipe.sourceContract) {
      bundle.source = {
        contentHash: recipe.sourceContract.contentHash,
        targetCount: recipe.sourceContract.targets.length,
        unsupportedTargetCount: recipe.sourceContract.targets.filter(
          (target) => target.kind === 'unsupported',
        ).length,
      };
    }
    if (recipe.lifecycle) {
      if (recipe.lifecycle.state !== undefined) {
        bundle.lifecycleState = recipe.lifecycle.state;
      }
      if (recipe.lifecycle.packageName !== undefined) {
        bundle.packageName = recipe.lifecycle.packageName;
      }
      if (recipe.lifecycle.packageVersion !== undefined) {
        bundle.packageVersion = recipe.lifecycle.packageVersion;
      }
    }
  }

  if (input.healthIssues) {
    bundle.health = summarizeHealth(input.healthIssues);
  }

  return bundle;
}

/** Deterministic pretty JSON for the exported bundle. */
export function serializeConnectionDebugBundle(bundle: ConnectionDebugBundle): string {
  return JSON.stringify(bundle, null, 2);
}

function summarizeBinding(binding: SemanticBinding): DebugBundleBinding {
  const source = binding.source;
  const summary: DebugBundleBinding = {
    requirement: binding.requirement,
    sourceKind: source.kind,
    targetPath: formatTargetPath(binding.target),
  };

  if (binding.transform) {
    summary.transformKind = binding.transform.kind;
  }

  if (source.kind === 'nested-text' || source.kind === 'nested-property') {
    // Redact the layer names themselves; keep only depth and fragility.
    summary.locatorDepth = source.locator.namePath.length;
    summary.fragileLocator = source.locator.fragile;
  }

  return summary;
}

function summarizeHealth(
  issues: readonly SemanticHealthIssue[],
): NonNullable<ConnectionDebugBundle['health']> {
  const bySeverity: Record<SemanticHealthSeverity, number> = {
    broken: 0,
    'needs-review': 0,
    warning: 0,
  };
  const affectedTargets = new Set<string>();

  for (const issue of issues) {
    bySeverity[issue.severity] += 1;
    if (issue.severity !== 'warning') {
      affectedTargets.add(issue.targetPath);
    }
  }

  return {
    affectedTargets: Array.from(affectedTargets),
    bySeverity,
    total: issues.length,
  };
}

/** Exposed for tests and validation of the current recipe schema version. */
export const SUPPORTED_RECIPE_SCHEMA_VERSION = SEMANTIC_RECIPE_SCHEMA_VERSION;
