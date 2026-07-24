import { describe, expect, it } from 'vitest';
import type { FigmaComponentSnapshot } from '../types';
import {
  OPTION_OMITTED,
  OPTION_RUNTIME,
  OPTION_STATIC,
  buildTargetRows,
  buildValueOptions,
  createRecipeDraft,
  deriveTransform,
  getTargetSection,
  hasStructuralMismatch,
  setTargetOption,
  suggestOption,
  validateRecipeDraft,
} from './authoring';
import type { SourceTargetDescriptor } from './source-contract';
import { extractFigmaSemanticSnapshot } from './figma-extractor';
import { DIALOG_SOURCE_FIXTURE, createDialogNode } from './fixtures';
import { resolveSemanticUsage } from './resolver';
import { validateSemanticRecipe } from './schema';
import { extractSourceContract, type SourceContract } from './source-contract';

function createDialogContract(): SourceContract {
  const result = extractSourceContract([
    { contents: DIALOG_SOURCE_FIXTURE, fileName: 'confirmation-dialog.tsx' },
  ]);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.contract;
}

function createDialogFigmaSnapshot(): FigmaComponentSnapshot {
  return {
    componentId: '1:23',
    componentName: 'Dialog',
    properties: [
      {
        defaultValue: 'Danger',
        id: 'prop-intent',
        name: 'intent',
        options: ['Danger', 'Default'],
        rawKey: 'intent',
        type: 'VARIANT',
      },
    ],
  };
}

function createDialogInputs() {
  return {
    contract: createDialogContract(),
    figmaSnapshot: createDialogFigmaSnapshot(),
    semanticSnapshot: extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot,
  };
}

function visualTarget(path: string[], values: string[]): SourceTargetDescriptor {
  return { kind: 'visual', ownerProp: path[0], path, required: false, typeName: 'x', values };
}

describe('deriveTransform enum value-aliasing', () => {
  it('maps a Figma Size variant onto abbreviated source values', () => {
    const target = visualTarget(['size'], ['sm', 'md', 'lg', 'xl']);
    const property: FigmaComponentSnapshot['properties'][number] = {
      id: 'p-size',
      name: 'Size',
      options: ['Small', 'Medium', 'Large', 'xLarge'],
      rawKey: 'Size',
      type: 'VARIANT',
    };

    expect(deriveTransform(target, property)).toEqual({
      kind: 'enum',
      map: { Large: 'lg', Medium: 'md', Small: 'sm', xLarge: 'xl' },
    });
  });

  it('maps intent synonyms bidirectionally', () => {
    const target = visualTarget(['type'], ['error', 'success']);
    const property: FigmaComponentSnapshot['properties'][number] = {
      id: 'p-type',
      name: 'Type',
      options: ['Danger', 'Positive'],
      rawKey: 'Type',
      type: 'VARIANT',
    };

    expect(deriveTransform(target, property)).toEqual({
      kind: 'enum',
      map: { Danger: 'error', Positive: 'success' },
    });
  });

  it('leaves genuinely unrelated options unmapped for review', () => {
    const target = visualTarget(['tone'], ['calm']);
    const property: FigmaComponentSnapshot['properties'][number] = {
      id: 'p-tone',
      name: 'Tone',
      options: ['Loud'],
      rawKey: 'Tone',
      type: 'VARIANT',
    };

    expect(deriveTransform(target, property)).toBeUndefined();
  });
});

describe('getTargetSection', () => {
  it('groups the Dialog contract into the roadmap sections', () => {
    const { contract } = createDialogInputs();
    const sections = new Map(
      contract.targets.map((target) => [target.path.join('.'), getTargetSection(target)]),
    );

    expect(sections.get('title')).toBe('content');
    expect(sections.get('description')).toBe('content');
    expect(sections.get('intent')).toBe('variants');
    expect(sections.get('cancelAction.label')).toBe('actions');
    expect(sections.get('confirmAction.label')).toBe('actions');
    expect(sections.get('onConfirm')).toBe('behavior');
  });
});

describe('suggestOption', () => {
  it('suggests the intent variant property by exact name', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const intent = contract.targets.find((target) => target.path.join('.') === 'intent')!;

    expect(suggestOption(intent, figmaSnapshot, semanticSnapshot)).toEqual({
      optionId: 'prop:prop-intent',
      reason: 'Figma property "intent" matches "intent".',
    });
  });

  it('suggests nested text for title with a stated reason', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const title = contract.targets.find((target) => target.path.join('.') === 'title')!;

    const suggestion = suggestOption(title, figmaSnapshot, semanticSnapshot);
    expect(suggestion?.reason).toContain('Header / Title');
  });

  it('disambiguates cancelAction.label and confirmAction.label by region context', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const cancel = contract.targets.find(
      (target) => target.path.join('.') === 'cancelAction.label',
    )!;
    const confirm = contract.targets.find(
      (target) => target.path.join('.') === 'confirmAction.label',
    )!;

    const cancelSuggestion = suggestOption(cancel, figmaSnapshot, semanticSnapshot);
    const confirmSuggestion = suggestOption(confirm, figmaSnapshot, semanticSnapshot);

    expect(cancelSuggestion?.optionId).toContain('Secondary action');
    expect(confirmSuggestion?.optionId).toContain('Primary action');
  });

  it('suggests runtime for callbacks', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const onConfirm = contract.targets.find(
      (target) => target.path.join('.') === 'onConfirm',
    )!;

    expect(suggestOption(onConfirm, figmaSnapshot, semanticSnapshot)?.optionId)
      .toBe(OPTION_RUNTIME);
  });
});

describe('createRecipeDraft', () => {
  it('drafts a complete, valid, saveable Dialog recipe from suggestions alone', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();

    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const validation = validateRecipeDraft(recipe);

    expect(validateSemanticRecipe(JSON.parse(JSON.stringify(recipe)))).toMatchObject({
      ok: true,
    });
    expect(validation.saveable).toBe(true);
    expect(validation.progress).toEqual({ completed: 4, total: 4 });
    expect(hasStructuralMismatch(recipe)).toBe(true);
  });

  it('generates the approved TSX from the drafted recipe against the live tree', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('intent={"danger"}');
    expect(result.usage.jsx).toContain('title={"Delete account?"}');
    expect(result.usage.jsx).toContain('cancelAction={{ label: "Cancel" }}');
    expect(result.usage.jsx).toContain('confirmAction={{ label: "Delete" }}');
    expect(result.usage.jsx).toContain('onConfirm={undefined /* Set in application. */}');
  });

  it('keeps existing confirmed bindings over new suggestions', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const first = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const edited = setTargetOption(first, figmaSnapshot, ['title'], OPTION_STATIC, 'Fixed title');

    const second = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot, edited);
    const titleBinding = second.bindings.find(
      (binding) => binding.target.path.join('.') === 'title',
    );

    expect(titleBinding?.source).toEqual({ kind: 'static', value: 'Fixed title' });
  });

  it('derives the enum transform for the intent variant', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const intentBinding = recipe.bindings.find(
      (binding) => binding.target.path.join('.') === 'intent',
    );

    expect(intentBinding?.transform).toEqual({
      kind: 'enum',
      map: { Danger: 'danger', Default: 'default' },
    });
  });
});

describe('setTargetOption', () => {
  it('marks a target runtime, static, and unset through the single control', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    recipe = setTargetOption(recipe, figmaSnapshot, ['description'], OPTION_RUNTIME);
    expect(recipe.bindings.find((binding) => binding.target.path[0] === 'description')?.source)
      .toEqual({ kind: 'runtime' });

    recipe = setTargetOption(recipe, figmaSnapshot, ['description'], OPTION_STATIC, 'Fixed');
    expect(recipe.bindings.find((binding) => binding.target.path[0] === 'description')?.source)
      .toEqual({ kind: 'static', value: 'Fixed' });

    recipe = setTargetOption(recipe, figmaSnapshot, ['description'], '');
    expect(recipe.bindings.some((binding) => binding.target.path[0] === 'description'))
      .toBe(false);
  });

  it('remembers Omitted as a decision instead of reverting to Not mapped', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    // `description` is optional, so it may be intentionally omitted.
    recipe = setTargetOption(recipe, figmaSnapshot, ['description'], OPTION_OMITTED);

    const binding = recipe.bindings.find((b) => b.target.path.join('.') === 'description');
    expect(binding?.source).toEqual({ kind: 'omitted' });

    // The control reads the decision back rather than showing "Not mapped".
    const row = buildTargetRows(recipe, figmaSnapshot)
      .find((r) => r.targetPath === 'description');
    expect(row?.optionId).toBe(OPTION_OMITTED);

    // And it stays saveable.
    expect(validateRecipeDraft(recipe).saveable).toBe(true);
  });

  it('omits the prop from generated code and says so', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    recipe = setTargetOption(recipe, figmaSnapshot, ['description'], OPTION_OMITTED);

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.usage.jsx).not.toContain('description=');
    expect(result.issues).toEqual([]);
    expect(
      result.explanations.find((e) => e.targetPath === 'description'),
    ).toMatchObject({ outcome: 'omitted', reason: 'Intentionally omitted.' });
  });

  it('refuses to omit a required target', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    // `title` is required, so Omitted must not produce a binding.
    const next = setTargetOption(recipe, figmaSnapshot, ['title'], OPTION_OMITTED);

    expect(next.bindings.some((b) => b.target.path.join('.') === 'title')).toBe(false);
    expect(validateRecipeDraft(next).saveable).toBe(false);
  });

  it('blocks save when a required visual target is unset', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    recipe = setTargetOption(recipe, figmaSnapshot, ['title'], '');

    const validation = validateRecipeDraft(recipe);

    expect(validation.saveable).toBe(false);
    expect(validation.errors.some((error) => error.includes('"title"'))).toBe(true);
  });

  it('stays saveable when the required callback is marked runtime', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    const onConfirm = recipe.bindings.find(
      (binding) => binding.target.path.join('.') === 'onConfirm',
    );
    expect(onConfirm?.requirement).toBe('runtime');
    expect(validateRecipeDraft(recipe).saveable).toBe(true);
  });
});

describe('buildValueOptions and rows', () => {
  it('offers only type-compatible design values per target', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const intent = contract.targets.find((target) => target.path.join('.') === 'intent')!;
    const title = contract.targets.find((target) => target.path.join('.') === 'title')!;

    const intentOptions = buildValueOptions(intent, figmaSnapshot, semanticSnapshot);
    expect(intentOptions.map((option) => option.label)).toEqual(['intent']);

    const titleOptions = buildValueOptions(title, figmaSnapshot, semanticSnapshot);
    expect(titleOptions.some((option) => option.label === 'Header / Title')).toBe(true);
    expect(titleOptions.some((option) => option.label === 'intent')).toBe(false);
  });

  it('flags fragile locators on their options', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const title = contract.targets.find((target) => target.path.join('.') === 'title')!;

    const option = buildValueOptions(title, figmaSnapshot, semanticSnapshot)
      .find((candidate) => candidate.label === 'Header / Title');

    expect(option?.fragile).toBe(true);
  });

  it('orders rows by section and shows nested targets as single rows', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const rows = buildTargetRows(recipe, figmaSnapshot);

    const sections = rows.map((row) => row.section);
    expect(sections).toEqual([...sections].sort((first, second) => (
      ['content', 'variants', 'actions', 'slots', 'behavior', 'excluded']
        .indexOf(first)
      - ['content', 'variants', 'actions', 'slots', 'behavior', 'excluded']
        .indexOf(second)
    )));
    expect(rows.some((row) => row.targetPath === 'confirmAction.label')).toBe(true);
  });
});

describe('preview via samples', () => {
  it('resolves the drafted recipe from captured samples without a live tree', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      samples: recipe.figmaSnapshot,
    });

    expect(result.usage.jsx).toContain('title={"Delete account?"}');
    expect(result.usage.jsx).toContain('confirmAction={{ label: "Delete" }}');
  });
});
