/**
 * Reconciliation for semantic recipes: turn detected drift into concrete,
 * reviewable remap proposals and apply them only on explicit user action.
 *
 * Policy (roadmap M5 §"Reconciliation"):
 * - Match by stable identity (a nested instance's component key) before any
 *   rename heuristic.
 * - Never auto-delete a binding; removal is an explicit action.
 * - A remap is a *suggestion* — it is applied only when accepted.
 * - Revision and validation time advance only through `markRecipeReconciled`,
 *   called after a successful save, never during planning.
 *
 * This module is pure and Figma-independent; the authoring UI presents the
 * proposals and drives `applyProposal` / `markRecipeReconciled`, keeping a
 * pre-save snapshot so cancel restores the previous recipe.
 */

import { locatorKey, formatTargetPath } from './types';
import type {
  FigmaNestedSourceDescriptor,
  FigmaSemanticSnapshot,
  SemanticBinding,
  SemanticConnectionRecipe,
  SemanticLocator,
} from './types';
import type { SourceContract, SourceTargetDescriptor } from './source-contract';

export type ReconciliationProposal =
  /** A nested design source kept its component identity but moved in the tree. */
  | {
      kind: 'locator-moved';
      bindingId: string;
      targetPath: string;
      message: string;
      newLocator: SemanticLocator;
    }
  /** The source prop path is gone but exactly one type-compatible target fits. */
  | {
      kind: 'source-renamed';
      bindingId: string;
      targetPath: string;
      message: string;
      newTargetPath: string[];
      newTypeName: string;
    }
  /** The source prop still exists but changed type; the binding needs review. */
  | {
      kind: 'type-changed';
      bindingId: string;
      targetPath: string;
      message: string;
      newTypeName: string;
    }
  /** The bound design source is gone with no surviving identity. Remove only. */
  | {
      kind: 'design-removed';
      bindingId: string;
      targetPath: string;
      message: string;
    }
  /** The source prop is gone with no rename candidate. Remove only. */
  | {
      kind: 'source-removed';
      bindingId: string;
      targetPath: string;
      message: string;
    };

export type ReconciliationAction = 'accept' | 'remove';

/** Proposal kinds whose only valid action is removal. */
const REMOVE_ONLY: ReadonlySet<ReconciliationProposal['kind']> = new Set([
  'design-removed',
  'source-removed',
]);

export function isRemoveOnly(kind: ReconciliationProposal['kind']): boolean {
  return REMOVE_ONLY.has(kind);
}

/**
 * Compare a saved recipe against the freshly extracted design snapshot and the
 * freshly parsed source contract, producing reviewable proposals. Absent inputs
 * are not treated as drift, so passing only the contract reconciles source-side
 * changes without touching design locators, and vice versa.
 */
export function planReconciliation(
  recipe: SemanticConnectionRecipe,
  currentDesign?: FigmaSemanticSnapshot,
  currentContract?: SourceContract,
): ReconciliationProposal[] {
  const proposals: ReconciliationProposal[] = [];

  const designByKey = currentDesign === undefined
    ? undefined
    : new Map(currentDesign.nestedSources.map((source) => [descriptorKey(source), source]));
  const contractByPath = currentContract === undefined
    ? undefined
    : new Map(currentContract.targets.map((target) => [target.path.join('.'), target]));
  const boundTargetPaths = new Set(
    recipe.bindings.map((binding) => formatTargetPath(binding.target)),
  );

  for (const binding of recipe.bindings) {
    const targetPath = formatTargetPath(binding.target);

    if (designByKey !== undefined) {
      const proposal = planDesignProposal(binding, targetPath, currentDesign!, designByKey);
      if (proposal) {
        proposals.push(proposal);
      }
    }

    if (contractByPath !== undefined) {
      const proposal = planSourceProposal(
        binding,
        targetPath,
        contractByPath,
        currentContract!,
        boundTargetPaths,
      );
      if (proposal) {
        proposals.push(proposal);
      }
    }
  }

  return proposals;
}

function planDesignProposal(
  binding: SemanticBinding,
  targetPath: string,
  currentDesign: FigmaSemanticSnapshot,
  designByKey: ReadonlyMap<string, FigmaNestedSourceDescriptor>,
): ReconciliationProposal | undefined {
  const source = binding.source;
  if (source.kind !== 'nested-text' && source.kind !== 'nested-property') {
    return undefined;
  }

  const currentKey = `${source.kind}:${locatorKey(source.locator)}:${source.kind === 'nested-property' ? source.propertyName : ''}`;
  if (designByKey.has(currentKey)) {
    return undefined; // still present at the same locator
  }

  // Stable identity first: a nested instance that kept its component key but
  // moved in the layer tree is a safe, one-click rename migration. When several
  // instances share a component key (sibling buttons), disambiguate by the
  // instance's own leaf name, which survives an ancestor rename.
  const componentKey = source.locator.componentKey;
  if (componentKey !== undefined) {
    const identityMatches = currentDesign.nestedSources.filter((candidate) => (
      candidate.kind === source.kind
      && candidate.locator.componentKey === componentKey
      && (source.kind === 'nested-text' || candidate.propertyName === source.propertyName)
      && locatorKey(candidate.locator) !== locatorKey(source.locator)
    ));
    const sourceLeaf = leafSegment(source.locator.namePath);
    const sameLeaf = identityMatches.filter(
      (candidate) => leafSegment(candidate.locator.namePath) === sourceLeaf,
    );
    const moved = sameLeaf.length === 1
      ? sameLeaf[0]
      : identityMatches.length === 1 ? identityMatches[0] : undefined;

    if (moved) {
      return {
        bindingId: binding.id,
        kind: 'locator-moved',
        message: `The Figma source for ${JSON.stringify(targetPath)} moved to ${JSON.stringify(moved.displayPath)} but kept its component identity. Accept to remap it.`,
        newLocator: moved.locator,
        targetPath,
      };
    }
  }

  return {
    bindingId: binding.id,
    kind: 'design-removed',
    message: `The Figma source at ${JSON.stringify(source.locator.namePath.join(' / '))} for ${JSON.stringify(targetPath)} was not found and has no surviving identity. Remove the stale mapping or restore the layer.`,
    targetPath,
  };
}

function planSourceProposal(
  binding: SemanticBinding,
  targetPath: string,
  contractByPath: ReadonlyMap<string, SourceTargetDescriptor>,
  currentContract: SourceContract,
  boundTargetPaths: ReadonlySet<string>,
): ReconciliationProposal | undefined {
  const existing = contractByPath.get(targetPath);

  if (existing !== undefined) {
    if (existing.typeName !== binding.target.typeName) {
      return {
        bindingId: binding.id,
        kind: 'type-changed',
        message: `Source prop ${JSON.stringify(targetPath)} changed type from ${JSON.stringify(binding.target.typeName)} to ${JSON.stringify(existing.typeName)}. Accept to update the binding, then review its transform.`,
        newTypeName: existing.typeName,
        targetPath,
      };
    }
    return undefined;
  }

  // Rename heuristic: a single unbound target with the same type is the likely
  // new home. Ambiguity (zero or many) yields a remove-only proposal instead of
  // a guess.
  const candidates = currentContract.targets.filter((target) => (
    target.typeName === binding.target.typeName
    && !boundTargetPaths.has(target.path.join('.'))
    && !contractByPath.has(binding.target.path.join('.'))
  ));

  if (candidates.length === 1) {
    const candidate = candidates[0];
    return {
      bindingId: binding.id,
      kind: 'source-renamed',
      message: `Source prop ${JSON.stringify(targetPath)} is gone; ${JSON.stringify(candidate.path.join('.'))} has the same type. Accept to remap the binding.`,
      newTargetPath: [...candidate.path],
      newTypeName: candidate.typeName,
      targetPath,
    };
  }

  return {
    bindingId: binding.id,
    kind: 'source-removed',
    message: `Source prop ${JSON.stringify(targetPath)} no longer exists and no single type-compatible prop matches. Remove the stale mapping.`,
    targetPath,
  };
}

/**
 * Apply one proposal to the recipe, returning a new recipe. `remove` drops the
 * binding; `accept` applies the remap/update. `accept` on a remove-only
 * proposal is a no-op, so callers cannot silently accept an unmappable change.
 * Never mutates the input recipe or bumps the revision.
 */
export function applyProposal(
  recipe: SemanticConnectionRecipe,
  proposal: ReconciliationProposal,
  action: ReconciliationAction,
): SemanticConnectionRecipe {
  if (action === 'remove') {
    return {
      ...recipe,
      bindings: recipe.bindings.filter((binding) => binding.id !== proposal.bindingId),
    };
  }

  if (isRemoveOnly(proposal.kind)) {
    return recipe;
  }

  return {
    ...recipe,
    bindings: recipe.bindings.map((binding) => {
      if (binding.id !== proposal.bindingId) {
        return binding;
      }
      if (proposal.kind === 'locator-moved'
        && (binding.source.kind === 'nested-text' || binding.source.kind === 'nested-property')) {
        return { ...binding, source: { ...binding.source, locator: proposal.newLocator } };
      }
      if (proposal.kind === 'source-renamed') {
        return {
          ...binding,
          target: { path: [...proposal.newTargetPath], typeName: proposal.newTypeName },
        };
      }
      if (proposal.kind === 'type-changed') {
        return { ...binding, target: { ...binding.target, typeName: proposal.newTypeName } };
      }
      return binding;
    }),
  };
}

/**
 * Stamp a successful reconciliation save: advance the revision and record the
 * validation time. Call this only after the user confirms the save.
 */
export function markRecipeReconciled(
  recipe: SemanticConnectionRecipe,
  validatedAt: string,
): SemanticConnectionRecipe {
  return { ...recipe, lastValidatedAt: validatedAt, revision: recipe.revision + 1 };
}

function descriptorKey(source: FigmaNestedSourceDescriptor): string {
  return `${source.kind}:${locatorKey(source.locator)}:${source.propertyName ?? ''}`;
}

function leafSegment(namePath: readonly string[]): string | undefined {
  return namePath[namePath.length - 1];
}
