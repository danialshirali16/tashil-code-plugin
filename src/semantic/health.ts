/**
 * Connection health for semantic recipes: detect drift between a saved
 * recipe, the current Figma component, and the current source contract.
 *
 * Evaluation only reports; it never mutates or deletes bindings. Confirmed
 * runtime values are healthy by definition. Reconciliation (remap, remove
 * stale) stays an explicit user action in the authoring UI.
 */

import { locatorKey, type SemanticBinding, type SemanticConnectionRecipe, formatTargetPath } from './types';
import type { FigmaSemanticSnapshot } from './types';
import type { SourceContract } from './source-contract';

export type SemanticHealthSeverity = 'broken' | 'needs-review' | 'warning';

export type SemanticHealthIssue = {
  bindingId: string;
  targetPath: string;
  severity: SemanticHealthSeverity;
  message: string;
};

/**
 * Compare each binding against the freshly extracted design snapshot and the
 * freshly parsed source contract. Either input may be omitted when it is not
 * available (for example, no source re-upload yet); absent inputs are not
 * treated as drift.
 */
export function evaluateSemanticHealth(
  recipe: SemanticConnectionRecipe,
  currentDesign?: FigmaSemanticSnapshot,
  currentContract?: SourceContract,
): SemanticHealthIssue[] {
  const issues: SemanticHealthIssue[] = [];

  const designKeys = currentDesign === undefined
    ? undefined
    : new Set(
        currentDesign.nestedSources.map(
          (source) => `${source.kind}:${locatorKey(source.locator)}:${source.propertyName ?? ''}`,
        ),
      );
  const contractTargets = currentContract === undefined
    ? undefined
    : new Map(currentContract.targets.map((target) => [target.path.join('.'), target]));

  for (const binding of recipe.bindings) {
    const targetPath = formatTargetPath(binding.target);

    if (binding.requirement !== 'runtime' && binding.source.kind !== 'runtime') {
      checkDesignSource(binding, targetPath, designKeys, issues);
    }

    if (contractTargets !== undefined) {
      const contractTarget = contractTargets.get(targetPath);
      if (contractTarget === undefined) {
        issues.push({
          bindingId: binding.id,
          message: `Source prop ${JSON.stringify(targetPath)} no longer exists in the uploaded source. It may have been renamed or removed; review the binding.`,
          severity: binding.requirement === 'required' ? 'broken' : 'needs-review',
          targetPath,
        });
      } else if (contractTarget.typeName !== binding.target.typeName) {
        issues.push({
          bindingId: binding.id,
          message: `Source prop ${JSON.stringify(targetPath)} changed type from ${JSON.stringify(binding.target.typeName)} to ${JSON.stringify(contractTarget.typeName)}.`,
          severity: 'needs-review',
          targetPath,
        });
      }
    }
  }

  return issues;
}

function checkDesignSource(
  binding: SemanticBinding,
  targetPath: string,
  designKeys: ReadonlySet<string> | undefined,
  issues: SemanticHealthIssue[],
): void {
  const source = binding.source;

  if (source.kind === 'nested-text' || source.kind === 'nested-property') {
    if (source.locator.fragile) {
      issues.push({
        bindingId: binding.id,
        message: `The Figma source for ${JSON.stringify(targetPath)} is located by layer names only; renaming a layer will break it.`,
        severity: 'warning',
        targetPath,
      });
    }

    if (designKeys !== undefined) {
      const key = `${source.kind}:${locatorKey(source.locator)}:${source.kind === 'nested-property' ? source.propertyName : ''}`;
      if (!designKeys.has(key)) {
        issues.push({
          bindingId: binding.id,
          message: `The nested Figma source at ${JSON.stringify(source.locator.namePath.join(' / '))} was not found in the current component.`,
          severity: binding.requirement === 'required' ? 'broken' : 'needs-review',
          targetPath,
        });
      }
    }
  }
}
