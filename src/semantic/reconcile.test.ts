import { describe, expect, it } from 'vitest';
import {
  applyProposal,
  isRemoveOnly,
  markRecipeReconciled,
  planReconciliation,
  type ReconciliationProposal,
} from './reconcile';
import { extractFigmaSemanticSnapshot } from './figma-extractor';
import { createDialogNode, createDialogRecipe } from './fixtures';
import { extractSourceContract, type SourceContract } from './source-contract';
import { formatTargetPath, type SemanticConnectionRecipe } from './types';

const DIALOG_SOURCE = `
export interface ConfirmationDialogProps {
  intent: 'danger' | 'default';
  title: string;
  description?: string;
  cancelAction: { label: string };
  confirmAction: { label: string };
  onConfirm: () => void;
}
`;

function dialogContract(source = DIALOG_SOURCE): SourceContract {
  const result = extractSourceContract([{ contents: source, fileName: 'dialog.tsx' }], 'ConfirmationDialog');
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.contract;
}

/** A recipe whose snapshot carries the extracted Dialog nested sources. */
function dialogRecipe(): SemanticConnectionRecipe {
  const recipe = createDialogRecipe();
  recipe.figmaSnapshot = extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot;
  return recipe;
}

function byId(proposals: ReconciliationProposal[], bindingId: string) {
  return proposals.find((p) => p.bindingId === bindingId);
}

describe('planReconciliation — no drift', () => {
  it('returns no proposals when design and source are unchanged', () => {
    const recipe = dialogRecipe();
    const proposals = planReconciliation(
      recipe,
      extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot,
      dialogContract(),
    );

    expect(proposals).toEqual([]);
  });

  it('does not invent drift when inputs are absent', () => {
    expect(planReconciliation(dialogRecipe())).toEqual([]);
  });
});

describe('planReconciliation — design drift', () => {
  it('proposes a locator remap when a nested instance keeps its identity but moves', () => {
    const recipe = dialogRecipe();
    const node = createDialogNode();
    // Rename the Footer frame: the Primary action instance keeps its component
    // key but its name path changes from Footer/... to Actions/...
    node.children![1]!.name = 'Actions';
    const moved = extractFigmaSemanticSnapshot(node, '1:23').snapshot;

    const proposals = planReconciliation(recipe, moved, dialogContract());
    const proposal = byId(proposals, 'binding-confirm-label');

    expect(proposal?.kind).toBe('locator-moved');
    if (proposal?.kind === 'locator-moved') {
      expect(proposal.newLocator.namePath).toEqual(['Actions', 'Primary action']);
      expect(proposal.newLocator.componentKey).toBe('button-main-key');
    }
  });

  it('applying a locator-moved proposal remaps the binding without touching others', () => {
    const recipe = dialogRecipe();
    const node = createDialogNode();
    node.children![1]!.name = 'Actions';
    const moved = extractFigmaSemanticSnapshot(node, '1:23').snapshot;
    const proposal = byId(planReconciliation(recipe, moved, dialogContract()), 'binding-confirm-label')!;

    const next = applyProposal(recipe, proposal, 'accept');

    const confirm = next.bindings.find((b) => b.id === 'binding-confirm-label')!;
    expect(confirm.source.kind === 'nested-property' && confirm.source.locator.namePath)
      .toEqual(['Actions', 'Primary action']);
    // cancel binding is untouched
    const cancel = next.bindings.find((b) => b.id === 'binding-cancel-label')!;
    expect(cancel.source.kind === 'nested-property' && cancel.source.locator.namePath)
      .toEqual(['Footer', 'Secondary action']);
    // revision not bumped by apply
    expect(next.revision).toBe(recipe.revision);
  });

  it('proposes remove-only when a nested text source disappears with no identity', () => {
    const recipe = dialogRecipe();
    const node = createDialogNode();
    node.children![0]!.children = node.children![0]!.children!.filter((c) => c.name !== 'Title');
    const design = extractFigmaSemanticSnapshot(node, '1:23').snapshot;

    const proposal = byId(planReconciliation(recipe, design, dialogContract()), 'binding-title');

    expect(proposal?.kind).toBe('design-removed');
    expect(isRemoveOnly(proposal!.kind)).toBe(true);
  });
});

describe('planReconciliation — source drift', () => {
  it('proposes a source rename when one type-compatible prop matches', () => {
    const recipe = dialogRecipe();
    const renamed = dialogContract(DIALOG_SOURCE.replace('title: string;', 'heading: string;'));

    const proposals = planReconciliation(recipe, undefined, renamed);
    const proposal = byId(proposals, 'binding-title');

    expect(proposal?.kind).toBe('source-renamed');
    if (proposal?.kind === 'source-renamed') {
      expect(proposal.newTargetPath).toEqual(['heading']);
      expect(proposal.newTypeName).toBe('string');
    }
  });

  it('applying a source-renamed proposal updates the binding target path', () => {
    const recipe = dialogRecipe();
    const renamed = dialogContract(DIALOG_SOURCE.replace('title: string;', 'heading: string;'));
    const proposal = byId(planReconciliation(recipe, undefined, renamed), 'binding-title')!;

    const next = applyProposal(recipe, proposal, 'accept');

    expect(next.bindings.map((b) => formatTargetPath(b.target))).toContain('heading');
    expect(next.bindings.map((b) => formatTargetPath(b.target))).not.toContain('title');
  });

  it('proposes remove-only when the prop is gone and no single match exists', () => {
    const recipe = dialogRecipe();
    // Remove title entirely; the two `string` action labels are already bound,
    // so no single unbound `string` target remains → ambiguous/none → remove.
    const removed = dialogContract(DIALOG_SOURCE.replace('title: string;', ''));

    const proposal = byId(planReconciliation(recipe, undefined, removed), 'binding-title');

    expect(proposal?.kind).toBe('source-removed');
  });

  it('proposes a type-change review when a bound prop changes type', () => {
    const recipe = dialogRecipe();
    const changed = dialogContract(
      DIALOG_SOURCE.replace("intent: 'danger' | 'default';", "intent: 'danger' | 'default' | 'info';"),
    );

    const proposal = byId(planReconciliation(recipe, undefined, changed), 'binding-intent');

    expect(proposal?.kind).toBe('type-changed');
    if (proposal?.kind === 'type-changed') {
      expect(proposal.newTypeName).toContain('info');
    }

    const next = applyProposal(recipe, proposal!, 'accept');
    expect(next.bindings.find((b) => b.id === 'binding-intent')!.target.typeName).toContain('info');
  });
});

describe('applyProposal and markRecipeReconciled', () => {
  it('removes a binding on the remove action', () => {
    const recipe = dialogRecipe();
    const proposal: ReconciliationProposal = {
      bindingId: 'binding-description',
      kind: 'design-removed',
      message: 'gone',
      targetPath: 'description',
    };

    const next = applyProposal(recipe, proposal, 'remove');

    expect(next.bindings.some((b) => b.id === 'binding-description')).toBe(false);
    expect(next.bindings.length).toBe(recipe.bindings.length - 1);
  });

  it('treats accept on a remove-only proposal as a no-op (never a silent guess)', () => {
    const recipe = dialogRecipe();
    const proposal: ReconciliationProposal = {
      bindingId: 'binding-title',
      kind: 'design-removed',
      message: 'gone',
      targetPath: 'title',
    };

    expect(applyProposal(recipe, proposal, 'accept')).toEqual(recipe);
  });

  it('advances revision and validation time only through markRecipeReconciled', () => {
    const recipe = dialogRecipe();
    const stamped = markRecipeReconciled(recipe, '2026-07-24T00:00:00.000Z');

    expect(stamped.revision).toBe(recipe.revision + 1);
    expect(stamped.lastValidatedAt).toBe('2026-07-24T00:00:00.000Z');
    // input unchanged
    expect(recipe.lastValidatedAt).toBeUndefined();
  });

  it('does not mutate the input recipe', () => {
    const recipe = dialogRecipe();
    const snapshot = JSON.stringify(recipe);
    const proposal: ReconciliationProposal = {
      bindingId: 'binding-title',
      kind: 'source-renamed',
      message: 'x',
      newTargetPath: ['heading'],
      newTypeName: 'string',
      targetPath: 'title',
    };

    applyProposal(recipe, proposal, 'accept');
    markRecipeReconciled(recipe, 'now');

    expect(JSON.stringify(recipe)).toBe(snapshot);
  });
});
