import { describe, expect, it } from 'vitest';
import type { FigmaComponentSnapshot } from '../types';
import {
  setTargetValueMapping,
  OPTION_OMITTED,
  OPTION_RUNTIME,
  OPTION_STATIC,
  buildTargetRows,
  buildValueOptions,
  createRecipeDraft,
  deriveTransform,
  getTargetSection,
  hasStructuralMismatch,
  moveRepeatedTargetInstance,
  setRepeatedTargetInstances,
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

  it('suggests runtime for controlled state instead of mapping a design sample', () => {
    const { figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const controlled: SourceTargetDescriptor = {
      controlledBy: ['onChange'],
      kind: 'controlled',
      ownerProp: 'value',
      path: ['value'],
      required: true,
      typeName: 'string',
    };

    expect(suggestOption(controlled, figmaSnapshot, semanticSnapshot)?.optionId)
      .toBe(OPTION_RUNTIME);
  });

  it('suggests instance-swap properties for left and right icon slots', () => {
    const { figmaSnapshot, semanticSnapshot } = createDialogInputs();
    figmaSnapshot.properties.push(
      {
        id: 'leading-icon',
        name: 'leadingIcon',
        options: [],
        rawKey: 'leadingIcon#leading-icon',
        type: 'INSTANCE_SWAP',
      },
      {
        id: 'trailing-icon',
        name: 'trailingIcon',
        options: [],
        rawKey: 'trailingIcon#trailing-icon',
        type: 'INSTANCE_SWAP',
      },
    );

    expect(suggestOption(
      {
        kind: 'node',
        ownerProp: 'renderLeftIcon',
        path: ['renderLeftIcon'],
        required: false,
        typeName: 'ReactNode',
      },
      figmaSnapshot,
      semanticSnapshot,
    )?.optionId).toBe('prop:leading-icon');
    expect(suggestOption(
      {
        kind: 'node',
        ownerProp: 'renderRightIcon',
        path: ['renderRightIcon'],
        required: false,
        typeName: 'ReactNode',
      },
      figmaSnapshot,
      semanticSnapshot,
    )?.optionId).toBe('prop:trailing-icon');
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
    expect(result.usage.jsx).toContain('onConfirm={onConfirm /* Set in application. */}');
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

  it('defaults complex public API values to explicit application runtime bindings', () => {
    const { figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const complexTargets: SourceTargetDescriptor[] = [
      {
        kind: 'array',
        ownerProp: 'items',
        path: ['items'],
        required: true,
        typeName: 'Item[]',
      },
      {
        kind: 'record',
        ownerProp: 'metadata',
        path: ['metadata'],
        required: true,
        typeName: 'Record<string, unknown>',
      },
      {
        kind: 'date',
        ownerProp: 'selectedAt',
        path: ['selectedAt'],
        required: true,
        typeName: 'Date',
      },
      {
        kind: 'file',
        ownerProp: 'files',
        path: ['files'],
        required: true,
        typeName: 'FileList',
      },
      {
        kind: 'render',
        ownerProp: 'renderItem',
        path: ['renderItem'],
        required: true,
        typeName: '(item: Item) => ReactNode',
      },
      {
        kind: 'styling',
        ownerProp: 'sx',
        path: ['sx'],
        required: true,
        typeName: 'SxProps',
      },
    ];
    const contract: SourceContract = {
      componentName: 'DataView',
      contentHash: 'complex-contract',
      fileName: 'data-view.tsx',
      targets: complexTargets,
    };

    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    expect(recipe.bindings).toHaveLength(complexTargets.length);
    expect(recipe.bindings.every(
      (binding) => binding.requirement === 'runtime' && binding.source.kind === 'runtime',
    )).toBe(true);
    expect(buildTargetRows(recipe, figmaSnapshot).map((row) => row.section))
      .toEqual(['data', 'data', 'data', 'data', 'data', 'slots']);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const withoutItems = {
      ...recipe,
      bindings: recipe.bindings.filter((binding) => binding.target.path[0] !== 'items'),
    };
    expect(validateRecipeDraft(withoutItems).errors).toContain(
      'Mark the required array value "items" as set in application.',
    );
  });

  it('authors the standalone upload preview from design state and application callbacks', () => {
    const extracted = extractSourceContract([
      {
        contents: `
export type FileStatus = 'default' | 'uploaded' | 'uploading' | 'failed';
export interface SelectedItemProps {
  file?: File;
  fileId?: string;
  size?: 'medium' | 'small';
  disabled?: boolean;
  onRemove: (fileKey: number | string) => void;
  onRetry: (fileName: string) => void;
  status: FileStatus;
  uploadProgress?: number;
}
`,
        fileName: 'tashil-upload/types.ts',
      },
      {
        contents: `
export const SingleFilePreview: FunctionComponent<SelectedItemProps> = (props) => null;
`,
        fileName: 'tashil-upload/modules/single-preview/index.tsx',
      },
    ], 'SingleFilePreview');
    if (!extracted.ok) {
      throw new Error(extracted.message);
    }

    const uploadFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'upload-preview',
      componentName: 'SingleFilePreview',
      properties: [
        {
          defaultValue: 'Uploaded',
          id: 'status',
          name: 'status',
          options: ['Default', 'Uploaded', 'Uploading', 'Failed'],
          rawKey: 'status',
          type: 'VARIANT',
        },
        {
          defaultValue: 'Small',
          id: 'size',
          name: 'size',
          options: ['Medium', 'Small'],
          rawKey: 'size',
          type: 'VARIANT',
        },
        {
          defaultValue: 'invoice.pdf',
          id: 'file-id',
          name: 'fileId',
          options: [],
          rawKey: 'fileId',
          type: 'TEXT',
        },
      ],
    };
    const uploadSemanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'SingleFilePreview', type: 'INSTANCE' },
      'upload-preview',
    ).snapshot;
    let recipe = createRecipeDraft(
      extracted.contract,
      uploadFigmaSnapshot,
      uploadSemanticSnapshot,
    );

    expect(recipe.bindings.find((binding) => binding.target.path[0] === 'file')).toMatchObject({
      requirement: 'runtime',
      source: { kind: 'runtime' },
    });
    recipe = setTargetOption(recipe, uploadFigmaSnapshot, ['file'], OPTION_OMITTED);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'SingleFilePreview',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          fileId: 'invoice.pdf',
          size: 'Small',
          status: 'Uploaded',
        },
      },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toBe([
      '<SingleFilePreview',
      '  fileId={"invoice.pdf"}',
      '  size={"small"}',
      '  onRemove={onRemove /* Set in application. */}',
      '  onRetry={onRetry /* Set in application. */}',
      '  status={"uploaded"}',
      '/>',
    ].join('\n'));
    expect(result.runtimeRequirements).toEqual([
      {
        placeholder: 'onRemove',
        targetPath: 'onRemove',
        typeName: '(fileKey: number | string) => void',
      },
      {
        placeholder: 'onRetry',
        targetPath: 'onRetry',
        typeName: '(fileName: string) => void',
      },
    ]);
  });

  it('uses the declarative dropdown recipe to keep only essential runtime inputs', () => {
    const dropdownContract: SourceContract = {
      componentName: 'TashilDropdown',
      contentHash: 'dropdown-contract',
      fileName: 'tashil-dropdown/types.tsx',
      propsTypeName: 'DropdownProps',
      targets: [
        {
          kind: 'array',
          ownerProp: 'options',
          path: ['options'],
          required: true,
          typeName: 'Array<any>',
        },
        {
          kind: 'controlled',
          ownerProp: 'value',
          path: ['value'],
          required: false,
          typeName: 'any',
        },
        {
          kind: 'event',
          ownerProp: 'onChange',
          path: ['onChange'],
          required: false,
          typeName: '(event: SyntheticEvent, value: any) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onOpen',
          path: ['onOpen'],
          required: false,
          typeName: '(event: SyntheticEvent) => void',
        },
        {
          kind: 'render',
          ownerProp: 'filterOptions',
          path: ['filterOptions'],
          required: false,
          typeName: '(options: Array<any>) => Array<any>',
        },
        {
          kind: 'record',
          ownerProp: 'classes',
          path: ['classes'],
          required: false,
          typeName: 'object',
        },
        {
          kind: 'visual',
          ownerProp: 'size',
          path: ['size'],
          required: false,
          typeName: '"small" | "medium"',
          values: ['small', 'medium'],
        },
      ],
    };
    const dropdownFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'dropdown',
      componentName: 'TashilDropdown',
      properties: [{
        defaultValue: 'Medium',
        id: 'size',
        name: 'size',
        options: ['Small', 'Medium'],
        rawKey: 'size',
        type: 'VARIANT',
      }],
    };
    const dropdownSemanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilDropdown', type: 'INSTANCE' },
      'dropdown',
    ).snapshot;

    const recipe = createRecipeDraft(
      dropdownContract,
      dropdownFigmaSnapshot,
      dropdownSemanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['options', 'runtime'],
      ['value', 'runtime'],
      ['onChange', 'runtime'],
      ['onOpen', 'omitted'],
      ['filterOptions', 'omitted'],
      ['classes', 'omitted'],
      ['size', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilDropdown',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { size: 'Medium' } },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toBe([
      '<TashilDropdown',
      '  options={options /* Set in application. */}',
      '  value={value /* Set in application. */}',
      '  onChange={onChange /* Set in application. */}',
      '  size={"medium"}',
      '/>',
    ].join('\n'));
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

  it('honours Leave out on an event prop instead of emitting it', () => {
    // Reproduces a real debug bundle: onClick recorded as
    // { requirement: 'runtime', sourceKind: 'omitted' }. The runtime
    // requirement an event carries by default must not override the author's
    // explicit decision to leave the prop out.
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    // An optional callback, as `onClick?: MouseEventHandler` really is.
    contract.targets.push({
      kind: 'event',
      ownerProp: 'onClick',
      path: ['onClick'],
      required: false,
      typeName: '() => void',
    });
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    recipe = setTargetOption(recipe, figmaSnapshot, ['onClick'], OPTION_OMITTED);

    const binding = recipe.bindings.find((b) => b.target.path.join('.') === 'onClick');
    expect(binding?.source).toEqual({ kind: 'omitted' });
    // The stored requirement no longer contradicts the stored source.
    expect(binding?.requirement).toBe('optional');

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.usage.jsx).not.toContain('onClick');
    expect(result.runtimeRequirements.map((r) => r.targetPath)).not.toContain('onClick');
    expect(
      result.explanations.find((e) => e.targetPath === 'onClick'),
    ).toMatchObject({ outcome: 'omitted' });
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

describe('per-value mapping', () => {
  function sizeInputs() {
    const contract = {
      componentName: 'Button',
      contentHash: 'h',
      fileName: 'types.ts',
      targets: [{
        kind: 'visual' as const,
        ownerProp: 'size',
        path: ['size'],
        required: false,
        typeName: 'ButtonSizeType',
        values: ['small', 'medium', 'large'],
      }],
    };
    const figmaSnapshot: FigmaComponentSnapshot = {
      componentId: '1:1',
      componentName: 'Button',
      properties: [{
        id: 'p-size',
        name: 'size',
        // Design uses abbreviations the source spells out, and one option the
        // synonym dictionary cannot possibly know.
        options: ['sm', 'md', 'huge'],
        rawKey: 'size',
        type: 'VARIANT',
      }],
    };
    const semanticSnapshot = { componentId: '1:1', componentName: 'Button', nestedSources: [] };
    return { contract, figmaSnapshot, semanticSnapshot };
  }

  it('exposes one editable pair per source value', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = sizeInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    const row = buildTargetRows(recipe, figmaSnapshot)[0];
    expect(row.valueMappings?.map((v) => [v.sourceValue, v.figmaOption])).toEqual([
      ['small', 'sm'],
      ['medium', 'md'],
      // 'large' vs 'huge' is not guessable, so it starts unmapped for the user.
      ['large', ''],
    ]);
    expect(row.valueMappings?.[0].options).toEqual(['sm', 'md', 'huge']);
  });

  it('lets the user pair a value the dictionary cannot guess', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = sizeInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    recipe = setTargetValueMapping(recipe, ['size'], 'large', 'huge');

    const binding = recipe.bindings[0];
    expect(binding.transform).toEqual({
      kind: 'enum',
      map: { sm: 'small', md: 'medium', huge: 'large' },
    });
    expect(buildTargetRows(recipe, figmaSnapshot)[0].valueMappings?.[2].figmaOption).toBe('huge');
  });

  it('moves a value to a different option rather than duplicating it', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = sizeInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    recipe = setTargetValueMapping(recipe, ['size'], 'small', 'huge');

    const map = recipe.bindings[0].transform?.kind === 'enum'
      ? recipe.bindings[0].transform.map
      : {};
    expect(map).toEqual({ huge: 'small', md: 'medium' });
  });

  it('unmaps a pair when the option is cleared', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = sizeInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);

    recipe = setTargetValueMapping(recipe, ['size'], 'small', '');
    recipe = setTargetValueMapping(recipe, ['size'], 'medium', '');

    expect(recipe.bindings[0].transform).toBeUndefined();
  });
});

describe('boolean target driven by a variant', () => {
  function stateInputs() {
    const contract = {
      componentName: 'Button',
      contentHash: 'h',
      fileName: 'types.ts',
      targets: [{
        kind: 'visual' as const,
        ownerProp: 'disabled',
        path: ['disabled'],
        required: false,
        typeName: 'boolean',
        values: [false, true],
      }],
    };
    const figmaSnapshot: FigmaComponentSnapshot = {
      componentId: '1:1',
      componentName: 'Button',
      properties: [{
        id: 'p-state',
        name: 'State',
        // Four options — the old rule only accepted exactly two.
        options: ['Default', 'Hover', 'Pressed', 'Disabled'],
        rawKey: 'State',
        type: 'VARIANT',
      }],
    };
    const semanticSnapshot = { componentId: '1:1', componentName: 'Button', nestedSources: [] };
    return { contract, figmaSnapshot, semanticSnapshot };
  }

  it('offers a multi-option variant to a boolean prop', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = stateInputs();
    const target = contract.targets[0];

    expect(buildValueOptions(target, figmaSnapshot, semanticSnapshot).map((o) => o.label))
      .toEqual(['State']);
  });

  it('lets each option be paired with true or false', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = stateInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    recipe = setTargetOption(recipe, figmaSnapshot, ['disabled'], 'prop:p-state');

    const row = buildTargetRows(recipe, figmaSnapshot)[0];
    expect(row.valueMappings?.map((v) => v.sourceValue)).toEqual([false, true]);
    expect(row.valueMappings?.[0].options).toEqual(['Default', 'Hover', 'Pressed', 'Disabled']);

    recipe = setTargetValueMapping(recipe, ['disabled'], true, 'Disabled');
    recipe = setTargetValueMapping(recipe, ['disabled'], false, 'Default');

    expect(recipe.bindings[0].transform).toEqual({
      kind: 'enum',
      map: { Disabled: true, Default: false },
    });
  });

  it('emits a boolean once mapped, and refuses to emit a raw option string', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = stateInputs();
    let recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    recipe = setTargetOption(recipe, figmaSnapshot, ['disabled'], 'prop:p-state');

    // Unmapped: the raw option string must not become a boolean prop.
    const unmapped = resolveSemanticUsage('Button', '@tashilcar/ui', recipe, {
      componentProperties: { State: 'Disabled' },
    });
    expect(unmapped.usage.jsx).not.toContain('disabled={"Disabled"}');
    expect(
      unmapped.explanations.find((e) => e.targetPath === 'disabled')?.reason,
    ).toMatch(/not a boolean/);

    // Mapped: a real boolean is emitted.
    recipe = setTargetValueMapping(recipe, ['disabled'], true, 'Disabled');
    const mapped = resolveSemanticUsage('Button', '@tashilcar/ui', recipe, {
      componentProperties: { State: 'Disabled' },
    });
    expect(mapped.usage.jsx).toContain('disabled');
    expect(mapped.usage.jsx).not.toContain('"Disabled"');
  });
});

describe('buildValueOptions and rows', () => {
  it('offers every design value, fitting ones first and the rest flagged', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const intent = contract.targets.find((target) => target.path.join('.') === 'intent')!;
    const title = contract.targets.find((target) => target.path.join('.') === 'title')!;

    // Hiding a real Figma property makes it look unavailable, so everything is
    // listed; only the ordering and the flag differ.
    const intentOptions = buildValueOptions(intent, figmaSnapshot, semanticSnapshot);
    expect(intentOptions[0]).toMatchObject({ label: 'intent' });
    expect(intentOptions[0].needsCheck).toBeUndefined();
    expect(intentOptions.length).toBeGreaterThan(1);
    expect(intentOptions.slice(1).every((option) => option.needsCheck === true)).toBe(true);

    const titleOptions = buildValueOptions(title, figmaSnapshot, semanticSnapshot);
    expect(titleOptions.find((option) => option.label === 'Header / Title')?.needsCheck)
      .toBeUndefined();
    expect(titleOptions.find((option) => option.label === 'intent')?.needsCheck).toBe(true);
  });

  it('treats instance swaps as the fitting source for ReactNode icon slots', () => {
    const { figmaSnapshot, semanticSnapshot } = createDialogInputs();
    figmaSnapshot.properties.push(
      {
        id: 'has-leading-icon',
        name: 'hasLeadingIcon',
        options: [],
        rawKey: 'hasLeadingIcon#has-leading-icon',
        type: 'BOOLEAN',
      },
      {
        id: 'leading-icon',
        name: 'leadingIcon',
        options: [],
        rawKey: 'leadingIcon#leading-icon',
        type: 'INSTANCE_SWAP',
      },
    );
    const options = buildValueOptions(
      {
        kind: 'node',
        ownerProp: 'renderLeftIcon',
        path: ['renderLeftIcon'],
        required: false,
        typeName: 'ReactNode',
      },
      figmaSnapshot,
      semanticSnapshot,
    );

    expect(options.find((option) => option.label === 'leadingIcon')?.needsCheck)
      .toBeUndefined();
    expect(options.find((option) => option.label === 'hasLeadingIcon')?.needsCheck)
      .toBe(true);
  });

  it('flags and blocks a connected child that violates an explicit ReactElement type', () => {
    const semanticSnapshot = extractFigmaSemanticSnapshot({
      children: [
        {
          connectedComponentName: 'Button',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'button-key',
          name: 'Action',
          type: 'INSTANCE',
        },
        {
          connectedComponentName: 'Avatar',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'avatar-key',
          name: 'Avatar',
          type: 'INSTANCE',
        },
      ],
      name: 'Card',
      type: 'COMPONENT',
    }, 'card-id').snapshot;
    const target: SourceTargetDescriptor = {
      kind: 'node',
      ownerProp: 'action',
      path: ['action'],
      required: true,
      typeName: 'ReactElement<ButtonProps, typeof Button>',
    };

    const options = buildValueOptions(target, undefined, semanticSnapshot);
    expect(options.find((option) => option.label === 'Action')?.needsCheck).toBeUndefined();
    expect(options.find((option) => option.label === 'Avatar')?.needsCheck).toBe(true);

    const recipe = createRecipeDraft({
      componentName: 'Card',
      contentHash: 'hash',
      fileName: 'card.tsx',
      targets: [target],
    }, undefined, semanticSnapshot);
    const avatarOption = options.find((option) => option.label === 'Avatar')!;
    const incompatible = setTargetOption(
      recipe,
      undefined,
      target.path,
      avatarOption.id,
    );
    expect(validateRecipeDraft(incompatible).errors).toContain(
      '"action" accepts Button, not Avatar.',
    );
  });

  it('stores and reorders repeated connected children by stable locator ids', () => {
    const semanticSnapshot = extractFigmaSemanticSnapshot({
      children: [
        {
          connectedComponentName: 'Tab',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'tab-one',
          name: 'First tab',
          type: 'INSTANCE',
        },
        {
          connectedComponentName: 'Tab',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'tab-two',
          name: 'Second tab',
          type: 'INSTANCE',
        },
      ],
      name: 'Tabs',
      type: 'COMPONENT',
    }, 'tabs-id').snapshot;
    const target: SourceTargetDescriptor = {
      itemSchemas: [{
        kind: 'node',
        path: ['component'],
        role: 'item',
        typeName: 'ReactNode',
      }],
      kind: 'array',
      ownerProp: 'components',
      path: ['components'],
      required: true,
      typeName: '{ component: ReactNode }[]',
    };
    const recipe = createRecipeDraft({
      componentName: 'Tabs',
      contentHash: 'hash',
      fileName: 'tabs.tsx',
      targets: [target],
    }, undefined, semanticSnapshot);
    const options = buildValueOptions(target, undefined, semanticSnapshot);
    const first = options.find((option) => option.label === 'First tab')!;
    const second = options.find((option) => option.label === 'Second tab')!;

    const ordered = setRepeatedTargetInstances(
      recipe,
      target.path,
      [second.id, first.id],
    );
    expect(ordered.bindings[0]?.source).toMatchObject({
      items: [
        { componentName: 'Tab', locator: { componentKey: 'tab-two' } },
        { componentName: 'Tab', locator: { componentKey: 'tab-one' } },
      ],
      itemPath: ['component'],
      kind: 'instances',
    });

    const moved = moveRepeatedTargetInstance(ordered, target.path, 1, 0);
    expect(
      moved.bindings[0]?.source.kind === 'instances'
        ? moved.bindings[0].source.items.map((item) => item.locator.componentKey)
        : [],
    ).toEqual(['tab-one', 'tab-two']);
    expect(validateRecipeDraft(moved).saveable).toBe(true);
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
