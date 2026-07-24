import { describe, expect, it } from 'vitest';
import { renderImportLines } from '../layout/imports';
import { createDialogNode, createDialogRecipe } from './fixtures';
import { resolveSemanticUsage } from './resolver';
import { validateSemanticRecipe } from './schema';
import type { SemanticConnectionRecipe } from './types';

function resolveDialog() {
  return resolveSemanticUsage(
    'ConfirmationDialog',
    '@tashilcar/ui',
    createDialogRecipe(),
    {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    },
  );
}

describe('resolveSemanticUsage', () => {
  it('generates the approved ConfirmationDialog usage from a mismatched Figma structure', () => {
    const result = resolveDialog();

    expect(result.issues).toEqual([]);
    expect([
      renderImportLines(result.usage.imports),
      '',
      result.usage.jsx,
    ].join('\n')).toBe(
      [
        'import { ConfirmationDialog } from "@tashilcar/ui";',
        '',
        '<ConfirmationDialog',
        '  intent={"danger"}',
        '  title={"Delete account?"}',
        '  description={"This action cannot be undone."}',
        '  cancelAction={{ label: "Cancel" }}',
        '  confirmAction={{ label: "Delete" }}',
        '  onConfirm={undefined /* Set in application. */}',
        '/>',
      ].join('\n'),
    );
  });

  it('never invents fictional compound components', () => {
    const result = resolveDialog();

    expect(result.usage.jsx).not.toContain('Dialog.Header');
    expect(result.usage.jsx).not.toContain('Dialog.Footer');
    expect(result.usage.imports).toHaveLength(1);
  });

  it('lists runtime requirements separately from design issues', () => {
    const result = resolveDialog();

    expect(result.runtimeRequirements).toEqual([
      { targetPath: 'onConfirm', typeName: '() => void' },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('explains every target', () => {
    const result = resolveDialog();
    const outcomes = new Map(
      result.explanations.map((explanation) => [explanation.targetPath, explanation.outcome]),
    );

    expect(outcomes).toEqual(new Map([
      ['intent', 'emitted'],
      ['title', 'emitted'],
      ['description', 'emitted'],
      ['cancelAction.label', 'emitted'],
      ['confirmAction.label', 'emitted'],
      ['onConfirm', 'runtime'],
    ]));
  });

  it('reports a broken required locator as an issue and returns partial output', () => {
    const recipe = createDialogRecipe();
    const root = createDialogNode();
    root.children = root.children!.filter((child) => child.name !== 'Header');

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root,
    });

    expect(result.issues.some((issue) => issue.includes('"title"'))).toBe(true);
    expect(result.usage.jsx).toContain('cancelAction={{ label: "Cancel" }}');
    expect(result.usage.jsx).not.toContain('title=');
  });

  it('omits optional values quietly when their source is missing', () => {
    const recipe = createDialogRecipe();
    const root = createDialogNode();
    root.children = [
      {
        children: [{ characters: 'Delete account?', name: 'Title', type: 'TEXT' }],
        name: 'Header',
        type: 'FRAME',
      },
      ...root.children!.filter((child) => child.name !== 'Header'),
    ];

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root,
    });

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).not.toContain('description=');
    expect(
      result.explanations.find((explanation) => explanation.targetPath === 'description')
        ?.outcome,
    ).toBe('unresolved');
  });

  it('rejects duplicate ownership of one code prop target', () => {
    const recipe = createDialogRecipe();
    recipe.bindings.push({
      id: 'binding-title-duplicate',
      requirement: 'optional',
      source: { kind: 'static', value: 'Other title' },
      target: { path: ['title'], typeName: 'string' },
    });

    const result = resolveDialogWith(recipe);

    expect(result.issues.some((issue) => issue.includes('"title"'))).toBe(true);
    expect(result.usage.jsx).toContain('title={"Delete account?"}');
  });

  it('supports static values and boolean transforms', () => {
    const recipe = createDialogRecipe();
    recipe.bindings.push(
      {
        id: 'binding-size',
        requirement: 'optional',
        source: { kind: 'static', value: 'medium' },
        target: { path: ['size'], typeName: 'string' },
      },
      {
        id: 'binding-dismissable',
        requirement: 'optional',
        source: {
          kind: 'component-property',
          propertyId: 'prop-closable',
          propertyName: 'closable',
        },
        target: { path: ['dismissable'], typeName: 'boolean' },
        transform: { kind: 'boolean', whenTrue: true },
      },
    );

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { closable: true, intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.usage.jsx).toContain('size={"medium"}');
    expect(result.usage.jsx).toContain('dismissable');
  });

  it('produces a recipe that passes schema validation after a JSON round trip', () => {
    const roundTripped: unknown = JSON.parse(JSON.stringify(createDialogRecipe()));

    expect(validateSemanticRecipe(roundTripped)).toMatchObject({ ok: true });
  });
});

function resolveDialogWith(recipe: SemanticConnectionRecipe) {
  return resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
    componentProperties: { intent: 'Danger' },
    root: createDialogNode(),
  });
}
