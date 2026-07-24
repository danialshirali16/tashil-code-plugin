import { describe, expect, it } from 'vitest';
import {
  createConnectionDebugBundle,
  serializeConnectionDebugBundle,
} from './debug-bundle';
import { evaluateSemanticHealth } from './health';
import { extractFigmaSemanticSnapshot } from './figma-extractor';
import { createDialogNode, createDialogRecipe } from './fixtures';
import { extractSourceContract } from './source-contract';
import type { SemanticConnectionRecipe } from './types';

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

/** A recipe carrying captured samples, a source contract, and lifecycle. */
function richDialogRecipe(): SemanticConnectionRecipe {
  const recipe = createDialogRecipe();
  recipe.figmaSnapshot = extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot;
  const contract = extractSourceContract([{ contents: DIALOG_SOURCE, fileName: 'dialog.tsx' }], 'ConfirmationDialog');
  if (contract.ok) {
    recipe.sourceContract = contract.contract;
  }
  recipe.lifecycle = { owner: 'Design systems', packageName: '@tashilcar/ui', packageVersion: '3.2.0', state: 'deprecated' };
  return recipe;
}

function bundleFor(recipe = richDialogRecipe()) {
  return createConnectionDebugBundle({
    componentName: 'ConfirmationDialog',
    connectionSchemaVersion: 4,
    importPath: '@tashilcar/ui',
    recipe,
    references: {
      sourcePath: 'src/ConfirmationDialog.tsx',
      sourceUrl: 'https://internal.example/secret/ConfirmationDialog.tsx',
      storybookUrl: 'https://internal.example/storybook?token=abc123',
    },
  });
}

describe('createConnectionDebugBundle — structure', () => {
  it('captures schema versions, counts, hashes, and code identifiers', () => {
    const bundle = bundleFor();

    expect(bundle.componentName).toBe('ConfirmationDialog');
    expect(bundle.importPath).toBe('@tashilcar/ui');
    expect(bundle.connectionSchemaVersion).toBe(4);
    expect(bundle.recipeSchemaVersion).toBe(1);
    expect(bundle.bindingCount).toBe(6);
    expect(bundle.figma).toEqual({ componentId: '1:23', nestedSourceCount: 4 });
    expect(bundle.source?.contentHash).toMatch(/^fnv1a-/);
    expect(bundle.source?.targetCount).toBeGreaterThan(0);
    expect(bundle.lifecycleState).toBe('deprecated');
    expect(bundle.packageName).toBe('@tashilcar/ui');
    expect(bundle.packageVersion).toBe('3.2.0');
  });

  it('summarizes each binding by kind/requirement without values', () => {
    const bundle = bundleFor();
    const confirm = bundle.bindings.find((b) => b.targetPath === 'confirmAction.label');

    expect(confirm).toEqual({
      fragileLocator: false,
      locatorDepth: 2,
      requirement: 'required',
      sourceKind: 'nested-property',
      targetPath: 'confirmAction.label',
    });
    const intent = bundle.bindings.find((b) => b.targetPath === 'intent');
    expect(intent).toMatchObject({ sourceKind: 'component-property', transformKind: 'enum' });
  });

  it('records reference presence as booleans only', () => {
    const bundle = bundleFor();
    expect(bundle.references).toEqual({
      hasSourcePath: true,
      hasSourceUrl: true,
      hasStorybookUrl: true,
    });
  });

  it('summarizes health by severity with affected code targets only', () => {
    const recipe = richDialogRecipe();
    const node = createDialogNode();
    node.children = node.children!.filter((child) => child.name !== 'Footer');
    const design = extractFigmaSemanticSnapshot(node, '1:23').snapshot;
    const issues = evaluateSemanticHealth(recipe, design, undefined);

    const bundle = createConnectionDebugBundle({
      componentName: 'ConfirmationDialog',
      connectionSchemaVersion: 4,
      healthIssues: issues,
      importPath: '@tashilcar/ui',
      recipe,
    });

    expect(bundle.health?.bySeverity.broken).toBeGreaterThan(0);
    expect(bundle.health?.affectedTargets).toContain('cancelAction.label');
  });
});

describe('createConnectionDebugBundle — redaction guarantees', () => {
  it('never leaks source text, URLs, or design content', () => {
    const serialized = serializeConnectionDebugBundle(bundleFor());

    // Reference URLs (and any embedded tokens) are excluded.
    expect(serialized).not.toContain('internal.example');
    expect(serialized).not.toContain('token=abc123');
    expect(serialized).not.toContain('src/ConfirmationDialog.tsx');

    // Design content — captured sample values, nested text, static literals,
    // and layer names — is excluded.
    expect(serialized).not.toContain('Delete account?');
    expect(serialized).not.toContain('This action cannot be undone.');
    expect(serialized).not.toContain('Header');
    expect(serialized).not.toContain('Primary action');

    // Owner (potentially internal) is not copied into the bundle.
    expect(serialized).not.toContain('Design systems');
  });

  it('keeps only whitelisted top-level keys', () => {
    const bundle = bundleFor();
    // Deep scan: no property anywhere should be a locator namePath array or
    // a raw design value. Assert the binding shape has no `locator`/`value`.
    for (const binding of bundle.bindings) {
      expect(binding).not.toHaveProperty('locator');
      expect(binding).not.toHaveProperty('value');
      expect(binding).not.toHaveProperty('source.locator');
    }
    expect(bundle.figma).not.toHaveProperty('nestedSources');
    expect(bundle.source).not.toHaveProperty('targets');
  });

  it('produces a bundle even with no recipe (unconnected diagnostics)', () => {
    const bundle = createConnectionDebugBundle({
      componentName: 'Button',
      connectionSchemaVersion: 4,
      importPath: '@tashilcar/ui',
    });

    expect(bundle.bindingCount).toBe(0);
    expect(bundle.recipeSchemaVersion).toBeUndefined();
    expect(bundle.figma).toBeUndefined();
  });

  it('round-trips through JSON deterministically', () => {
    const first = serializeConnectionDebugBundle(bundleFor());
    const second = serializeConnectionDebugBundle(bundleFor());
    expect(first).toBe(second);
    expect(() => JSON.parse(first)).not.toThrow();
  });
});
