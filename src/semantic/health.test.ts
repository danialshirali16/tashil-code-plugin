import { describe, expect, it } from 'vitest';
import { evaluateSemanticHealth } from './health';
import { extractFigmaSemanticSnapshot } from './figma-extractor';
import { createDialogNode, createDialogRecipe, DIALOG_SOURCE_FIXTURE } from './fixtures';
import { extractSourceContract } from './source-contract';

function extractDialogInputs() {
  const design = extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot;
  const contractResult = extractSourceContract([
    { contents: DIALOG_SOURCE_FIXTURE, fileName: 'confirmation-dialog.tsx' },
  ]);
  if (!contractResult.ok) {
    throw new Error(contractResult.message);
  }
  return { contract: contractResult.contract, design };
}

describe('evaluateSemanticHealth', () => {
  it('reports only fragile-locator warnings for a healthy recipe', () => {
    const { contract, design } = extractDialogInputs();

    const issues = evaluateSemanticHealth(createDialogRecipe(), design, contract);

    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
    expect(issues.map((issue) => issue.targetPath)).toEqual(['title', 'description']);
  });

  it('treats confirmed runtime values as healthy', () => {
    const { contract, design } = extractDialogInputs();

    const issues = evaluateSemanticHealth(createDialogRecipe(), design, contract);

    expect(issues.some((issue) => issue.targetPath === 'onConfirm')).toBe(false);
  });

  it('reports a removed nested Figma source as broken for required bindings', () => {
    const { contract } = extractDialogInputs();
    const node = createDialogNode();
    node.children = node.children!.filter((child) => child.name !== 'Footer');
    const design = extractFigmaSemanticSnapshot(node, '1:23').snapshot;

    const issues = evaluateSemanticHealth(createDialogRecipe(), design, contract);

    const broken = issues.filter((issue) => issue.severity === 'broken');
    expect(broken.map((issue) => issue.targetPath)).toEqual([
      'cancelAction.label',
      'confirmAction.label',
    ]);
    expect(broken[0].message).toContain('was not found in the current component');
  });

  it('reports a renamed source prop without deleting the binding', () => {
    const { design } = extractDialogInputs();
    const renamedResult = extractSourceContract([
      {
        contents: DIALOG_SOURCE_FIXTURE.replace('title: string;', 'heading: string;'),
        fileName: 'confirmation-dialog.tsx',
      },
    ]);
    if (!renamedResult.ok) {
      throw new Error(renamedResult.message);
    }

    const recipe = createDialogRecipe();
    const issues = evaluateSemanticHealth(recipe, design, renamedResult.contract);

    const titleIssue = issues.find(
      (issue) => issue.targetPath === 'title' && issue.severity !== 'warning',
    );
    expect(titleIssue).toMatchObject({ bindingId: 'binding-title', severity: 'broken' });
    expect(titleIssue?.message).toContain('renamed or removed');
    expect(recipe.bindings.some((binding) => binding.id === 'binding-title')).toBe(true);
  });

  it('reports source prop type changes for review', () => {
    const { design } = extractDialogInputs();
    const changedResult = extractSourceContract([
      {
        contents: DIALOG_SOURCE_FIXTURE.replace(
          "intent: 'danger' | 'default';",
          "intent: 'danger' | 'default' | 'info';",
        ),
        fileName: 'confirmation-dialog.tsx',
      },
    ]);
    if (!changedResult.ok) {
      throw new Error(changedResult.message);
    }

    const issues = evaluateSemanticHealth(createDialogRecipe(), design, changedResult.contract);

    expect(
      issues.find((issue) => issue.targetPath === 'intent'),
    ).toMatchObject({ severity: 'needs-review' });
  });

  it('does not invent drift when fresh inputs are unavailable', () => {
    const issues = evaluateSemanticHealth(createDialogRecipe());

    expect(issues.every((issue) => issue.severity === 'warning')).toBe(true);
  });
});
