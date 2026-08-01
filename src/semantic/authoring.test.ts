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

  it('suggests a Button label text property for React children', () => {
    const figmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'button',
      componentName: 'Button',
      properties: [{
        defaultValue: 'متن دکمه',
        id: 'label',
        name: 'label',
        options: [],
        rawKey: 'label',
        type: 'TEXT',
      }],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'Button', type: 'INSTANCE' },
      'button',
    ).snapshot;

    expect(suggestOption(
      {
        kind: 'node',
        ownerProp: 'children',
        path: ['children'],
        required: false,
        typeName: 'ReactNode',
      },
      figmaSnapshot,
      semanticSnapshot,
    )?.optionId).toBe('prop:label');
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

  it('keeps the accepted recipe active while replacement source is pending review', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const accepted = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const changedResult = extractSourceContract([{
      contents: DIALOG_SOURCE_FIXTURE.replace('title: string;', 'heading: string;'),
      fileName: 'confirmation-dialog.tsx',
    }]);
    if (!changedResult.ok) {
      throw new Error(changedResult.message);
    }
    const before = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', accepted, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    const pending = createRecipeDraft(
      changedResult.contract,
      figmaSnapshot,
      semanticSnapshot,
      accepted,
    );
    const after = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', pending, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(pending.sourceContract).toEqual(accepted.sourceContract);
    expect(pending.pendingSourceContract).toEqual(changedResult.contract);
    expect(pending.bindings).toEqual(accepted.bindings);
    expect(after.usage).toEqual(before.usage);
    expect(validateRecipeDraft(pending).errors).toContain(
      'Review and accept the uploaded source update before saving.',
    );
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

  it('uses the declarative menu recipe for items, anchor, state, and close handling', () => {
    const menuContract: SourceContract = {
      componentName: 'TashilMenu',
      contentHash: 'menu-contract',
      fileName: 'tashil-menu/types.tsx',
      propsTypeName: 'TashilMenuProps',
      targets: [
        {
          kind: 'array',
          ownerProp: 'options',
          path: ['options'],
          required: true,
          typeName: 'OptionsProps[]',
        },
        {
          kind: 'event',
          ownerProp: 'handleClose',
          path: ['handleClose'],
          required: true,
          typeName: '(event: MouseEventHandler<HTMLElement>) => void',
        },
        {
          kind: 'environment',
          ownerProp: 'anchorEl',
          path: ['anchorEl'],
          required: false,
          typeName: 'Element | (() => Element) | null',
        },
        {
          kind: 'controlled',
          ownerProp: 'open',
          path: ['open'],
          required: true,
          typeName: 'boolean',
        },
        {
          kind: 'record',
          ownerProp: 'MenuListProps',
          path: ['MenuListProps'],
          required: false,
          typeName: 'Partial<MenuListProps>',
        },
        {
          kind: 'record',
          ownerProp: 'anchorOrigin',
          path: ['anchorOrigin'],
          required: false,
          typeName: 'PopoverOrigin',
        },
        {
          kind: 'event',
          ownerProp: 'onKeyDown',
          path: ['onKeyDown'],
          required: false,
          typeName: 'KeyboardEventHandler<HTMLDivElement>',
        },
        {
          kind: 'visual',
          ownerProp: 'searchBox',
          path: ['searchBox'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    };
    const menuFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'menu',
      componentName: 'TashilMenu',
      properties: [{
        defaultValue: true,
        id: 'search-box',
        name: 'searchBox',
        options: [],
        rawKey: 'searchBox',
        type: 'BOOLEAN',
      }],
    };
    const menuSemanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilMenu', type: 'INSTANCE' },
      'menu',
    ).snapshot;

    const recipe = createRecipeDraft(
      menuContract,
      menuFigmaSnapshot,
      menuSemanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['options', 'runtime'],
      ['handleClose', 'runtime'],
      ['anchorEl', 'runtime'],
      ['open', 'runtime'],
      ['MenuListProps', 'omitted'],
      ['anchorOrigin', 'omitted'],
      ['onKeyDown', 'omitted'],
      ['searchBox', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilMenu',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { searchBox: true } },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toBe([
      '<TashilMenu',
      '  options={options /* Set in application. */}',
      '  handleClose={handleClose /* Set in application. */}',
      '  anchorEl={anchorEl /* Set in application. */}',
      '  open={open /* Set in application. */}',
      '  searchBox',
      '/>',
    ].join('\n'));
  });

  it('keeps TashilTab runtime items exclusive from connected component tabs', () => {
    const root = {
      children: [
        {
          connectedComponentName: 'SecurityPanel',
          connectedImportPath: '@tashilcar/swiss-army-knife',
          hasOwnConnection: true,
          mainComponentKey: 'security-panel',
          name: 'Security',
          type: 'INSTANCE' as const,
        },
        {
          connectedComponentName: 'AccountPanel',
          connectedImportPath: '@tashilcar/swiss-army-knife',
          hasOwnConnection: true,
          mainComponentKey: 'account-panel',
          name: 'Account',
          type: 'INSTANCE' as const,
        },
      ],
      name: 'Tabs',
      type: 'COMPONENT' as const,
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(root, 'tabs').snapshot;
    const itemsTarget: SourceTargetDescriptor = {
      kind: 'array',
      ownerProp: 'items',
      path: ['items'],
      required: false,
      typeName: '{ text: string; isSelected?: boolean; onClick?: () => any }[]',
    };
    const componentsTarget: SourceTargetDescriptor = {
      itemSchemas: [{
        kind: 'node',
        path: ['component'],
        role: 'item',
        typeName: 'ReactNode',
      }],
      kind: 'array',
      ownerProp: 'components',
      path: ['components'],
      required: false,
      typeName: '{ component: ReactNode; isSelected?: boolean }[]',
    };
    const recipe = createRecipeDraft({
      componentName: 'TashilTab',
      contentHash: 'tab-contract',
      fileName: 'tashil-tab/types.tsx',
      propsTypeName: 'TabProps',
      targets: [itemsTarget, componentsTarget],
    }, undefined, semanticSnapshot);

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['items', 'runtime'],
      ['components', 'omitted'],
    ]);

    const options = buildValueOptions(componentsTarget, undefined, semanticSnapshot);
    const security = options.find((option) => option.label === 'Security')!;
    const account = options.find((option) => option.label === 'Account')!;
    const connectedRecipe = setRepeatedTargetInstances(
      recipe,
      componentsTarget.path,
      [security.id, account.id],
    );

    expect(connectedRecipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['items', 'omitted'],
      ['components', 'instances'],
    ]);

    const result = resolveSemanticUsage(
      'TashilTab',
      '@tashilcar/swiss-army-knife',
      connectedRecipe,
      { componentProperties: {}, root },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain(
      'components={[{ component: <SecurityPanel /> }, { component: <AccountPanel /> }]}',
    );
    expect(result.usage.jsx).not.toContain('items=');
  });

  it('uses the Sessions recipe for data, application context, and delete actions', () => {
    const sessionsContract: SourceContract = {
      componentName: 'Sessions',
      contentHash: 'sessions-contract',
      fileName: 'sessions/type.ts',
      propsTypeName: 'ISessionsProps',
      targets: [
        {
          kind: 'event',
          ownerProp: 'onDeleteSession',
          path: ['onDeleteSession'],
          required: false,
          typeName: '(sessionId: number | string) => Promise<void>',
        },
        {
          kind: 'event',
          ownerProp: 'onDeleteAllSessions',
          path: ['onDeleteAllSessions'],
          required: false,
          typeName: '() => Promise<void>',
        },
        {
          kind: 'array',
          ownerProp: 'sessions',
          path: ['sessions'],
          required: true,
          typeName: "Omit<ISession, 'onClick'>[]",
        },
        {
          kind: 'record',
          ownerProp: 'activeSession',
          path: ['activeSession'],
          required: false,
          typeName: "Omit<ISession, 'onClick' | 'isOnline'> & { isOnline: true }",
        },
        {
          kind: 'visual',
          ownerProp: 'appName',
          path: ['appName'],
          required: true,
          typeName: 'string',
        },
        {
          kind: 'visual',
          ownerProp: 'isLoadingDeleteSessions',
          path: ['isLoadingDeleteSessions'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'showOtherSessionsTitle',
          path: ['showOtherSessionsTitle'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    };
    const sessionsFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'sessions',
      componentName: 'Sessions',
      properties: [
        {
          defaultValue: true,
          id: 'loading',
          name: 'isLoadingDeleteSessions',
          options: [],
          rawKey: 'isLoadingDeleteSessions',
          type: 'BOOLEAN',
        },
        {
          defaultValue: true,
          id: 'other-title',
          name: 'showOtherSessionsTitle',
          options: [],
          rawKey: 'showOtherSessionsTitle',
          type: 'BOOLEAN',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'Sessions', type: 'INSTANCE' },
      'sessions',
    ).snapshot;

    const recipe = createRecipeDraft(
      sessionsContract,
      sessionsFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['onDeleteSession', 'runtime'],
      ['onDeleteAllSessions', 'runtime'],
      ['sessions', 'runtime'],
      ['activeSession', 'runtime'],
      ['appName', 'runtime'],
      ['isLoadingDeleteSessions', 'component-property'],
      ['showOtherSessionsTitle', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'Sessions',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          isLoadingDeleteSessions: true,
          showOtherSessionsTitle: true,
        },
      },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain(
      'sessions={sessions /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'activeSession={activeSession /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'appName={appName /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('isLoadingDeleteSessions');
    expect(result.usage.jsx).toContain('showOtherSessionsTitle');
  });

  it('uses the Pagination recipe without mixing controlled and default page state', () => {
    const paginationContract: SourceContract = {
      componentName: 'Pagination',
      contentHash: 'pagination-contract',
      fileName: 'pagination/types.tsx',
      propsTypeName: 'TashilPaginationProps',
      targets: [
        {
          kind: 'visual',
          ownerProp: 'count',
          path: ['count'],
          required: false,
          typeName: 'number',
        },
        {
          kind: 'controlled',
          ownerProp: 'page',
          path: ['page'],
          required: false,
          typeName: 'number',
        },
        {
          kind: 'controlled',
          ownerProp: 'defaultPage',
          path: ['defaultPage'],
          required: false,
          typeName: 'number',
        },
        {
          kind: 'event',
          ownerProp: 'onChange',
          path: ['onChange'],
          required: false,
          typeName: '(event: ChangeEvent<unknown>, page: number) => void',
        },
        {
          kind: 'render',
          ownerProp: 'renderItem',
          path: ['renderItem'],
          required: false,
          typeName: '(params: PaginationRenderItemParams) => ReactNode',
        },
        {
          kind: 'visual',
          ownerProp: 'shape',
          path: ['shape'],
          required: false,
          typeName: "'circular' | 'rounded'",
          values: ['circular', 'rounded'],
        },
      ],
    };
    const paginationFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'pagination',
      componentName: 'Pagination',
      properties: [{
        defaultValue: 'Rounded',
        id: 'shape',
        name: 'shape',
        options: ['Circular', 'Rounded'],
        rawKey: 'shape',
        type: 'VARIANT',
      }],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'Pagination', type: 'INSTANCE' },
      'pagination',
    ).snapshot;
    const recipe = createRecipeDraft(
      paginationContract,
      paginationFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['count', 'runtime'],
      ['page', 'runtime'],
      ['defaultPage', 'omitted'],
      ['onChange', 'runtime'],
      ['renderItem', 'omitted'],
      ['shape', 'component-property'],
    ]);

    const uncontrolledRecipe = setTargetOption(
      recipe,
      paginationFigmaSnapshot,
      ['defaultPage'],
      OPTION_RUNTIME,
    );
    expect(uncontrolledRecipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['count', 'runtime'],
      ['onChange', 'runtime'],
      ['renderItem', 'omitted'],
      ['shape', 'component-property'],
      ['page', 'omitted'],
      ['defaultPage', 'runtime'],
    ]);
    expect(validateRecipeDraft(uncontrolledRecipe)).toMatchObject({
      errors: [],
      saveable: true,
    });

    const result = resolveSemanticUsage(
      'Pagination',
      '@tashilcar/swiss-army-knife',
      uncontrolledRecipe,
      { componentProperties: { shape: 'Rounded' } },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('count={count /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'defaultPage={defaultPage /* Set in application. */}',
    );
    expect(result.usage.jsx).not.toContain(' page={page');
    expect(result.usage.jsx).toContain('shape={"rounded"}');
  });

  it('uses the TashilDataGrid recipe for rows and columns without advanced overrides', () => {
    const dataGridContract: SourceContract = {
      componentName: 'TashilDataGrid',
      contentHash: 'data-grid-contract',
      fileName: 'tashil-data-grid/index.tsx',
      propsTypeName: 'Props',
      targets: [
        {
          kind: 'array',
          ownerProp: 'rows',
          path: ['rows'],
          required: true,
          typeName: 'GridRowsProp',
        },
        {
          kind: 'array',
          ownerProp: 'columns',
          path: ['columns'],
          required: true,
          typeName: 'GridColumns',
        },
        {
          kind: 'render',
          ownerProp: 'getRowId',
          path: ['getRowId'],
          required: false,
          typeName: 'GridRowIdGetter',
        },
        {
          kind: 'event',
          ownerProp: 'onRowClick',
          path: ['onRowClick'],
          required: false,
          typeName: 'GridEventListener<"rowClick">',
        },
        {
          kind: 'controlled',
          ownerProp: 'selectionModel',
          path: ['selectionModel'],
          required: false,
          typeName: 'GridInputSelectionModel',
        },
        {
          kind: 'event',
          ownerProp: 'onSelectionModelChange',
          path: ['onSelectionModelChange'],
          required: false,
          typeName: '(selectionModel: GridSelectionModel, details: GridCallbackDetails) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'loading',
          path: ['loading'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'checkboxSelection',
          path: ['checkboxSelection'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    };
    const dataGridFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'data-grid',
      componentName: 'TashilDataGrid',
      properties: [
        {
          defaultValue: true,
          id: 'loading',
          name: 'loading',
          options: [],
          rawKey: 'loading',
          type: 'BOOLEAN',
        },
        {
          defaultValue: true,
          id: 'checkbox-selection',
          name: 'checkboxSelection',
          options: [],
          rawKey: 'checkboxSelection',
          type: 'BOOLEAN',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilDataGrid', type: 'INSTANCE' },
      'data-grid',
    ).snapshot;
    const recipe = createRecipeDraft(
      dataGridContract,
      dataGridFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['rows', 'runtime'],
      ['columns', 'runtime'],
      ['getRowId', 'omitted'],
      ['onRowClick', 'omitted'],
      ['selectionModel', 'omitted'],
      ['onSelectionModelChange', 'omitted'],
      ['loading', 'component-property'],
      ['checkboxSelection', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilDataGrid',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          checkboxSelection: true,
          loading: true,
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('rows={rows /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'columns={columns /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('loading');
    expect(result.usage.jsx).toContain('checkboxSelection');
    expect(result.usage.jsx).not.toContain('getRowId=');
    expect(result.usage.jsx).not.toContain('onRowClick=');
    expect(result.usage.jsx).not.toContain('onSelectionModelChange=');
  });

  it('uses the TashilDataGridPro recipe without emitting optional Pro controls', () => {
    const dataGridProContract: SourceContract = {
      componentName: 'TashilDataGridPro',
      contentHash: 'data-grid-pro-contract',
      fileName: 'tashil-data-grid-pro/types.ts',
      propsTypeName: 'TashilDataGridProProps',
      targets: [
        {
          kind: 'array',
          ownerProp: 'rows',
          path: ['rows'],
          required: true,
          typeName: 'GridRowsProp',
        },
        {
          kind: 'array',
          ownerProp: 'columns',
          path: ['columns'],
          required: true,
          typeName: 'GridColDef[]',
        },
        {
          kind: 'render',
          ownerProp: 'getRowId',
          path: ['getRowId'],
          required: false,
          typeName: 'GridRowIdGetter',
        },
        {
          kind: 'event',
          ownerProp: 'onRowClick',
          path: ['onRowClick'],
          required: false,
          typeName: 'GridEventListener<"rowClick">',
        },
        {
          kind: 'controlled',
          ownerProp: 'rowSelectionModel',
          path: ['rowSelectionModel'],
          required: false,
          typeName: 'GridInputRowSelectionModel',
        },
        {
          kind: 'event',
          ownerProp: 'onRowSelectionModelChange',
          path: ['onRowSelectionModelChange'],
          required: false,
          typeName: '(rowSelectionModel: GridRowSelectionModel) => void',
        },
        {
          kind: 'render',
          ownerProp: 'getTreeDataPath',
          path: ['getTreeDataPath'],
          required: false,
          typeName: '(row: GridValidRowModel) => string[]',
        },
        {
          kind: 'visual',
          ownerProp: 'loading',
          path: ['loading'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'checkboxSelection',
          path: ['checkboxSelection'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'treeData',
          path: ['treeData'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    };
    const dataGridProFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'data-grid-pro',
      componentName: 'TashilDataGridPro',
      properties: [
        {
          defaultValue: true,
          id: 'loading',
          name: 'loading',
          options: [],
          rawKey: 'loading',
          type: 'BOOLEAN',
        },
        {
          defaultValue: true,
          id: 'checkbox-selection',
          name: 'checkboxSelection',
          options: [],
          rawKey: 'checkboxSelection',
          type: 'BOOLEAN',
        },
        {
          defaultValue: true,
          id: 'tree-data',
          name: 'treeData',
          options: [],
          rawKey: 'treeData',
          type: 'BOOLEAN',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilDataGridPro', type: 'INSTANCE' },
      'data-grid-pro',
    ).snapshot;
    const recipe = createRecipeDraft(
      dataGridProContract,
      dataGridProFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['rows', 'runtime'],
      ['columns', 'runtime'],
      ['getRowId', 'omitted'],
      ['onRowClick', 'omitted'],
      ['rowSelectionModel', 'omitted'],
      ['onRowSelectionModelChange', 'omitted'],
      ['getTreeDataPath', 'omitted'],
      ['loading', 'component-property'],
      ['checkboxSelection', 'component-property'],
      ['treeData', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilDataGridPro',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          checkboxSelection: true,
          loading: true,
          treeData: true,
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('rows={rows /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'columns={columns /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('loading');
    expect(result.usage.jsx).toContain('checkboxSelection');
    expect(result.usage.jsx).toContain('treeData');
    expect(result.usage.jsx).not.toContain('getRowId=');
    expect(result.usage.jsx).not.toContain('onRowClick=');
    expect(result.usage.jsx).not.toContain('rowSelectionModel=');
    expect(result.usage.jsx).not.toContain('onRowSelectionModelChange=');
    expect(result.usage.jsx).not.toContain('getTreeDataPath=');
  });

  it('uses the TashilAuthentication recipe for workflow state and page behavior', () => {
    const authenticationContract: SourceContract = {
      componentName: 'TashilAuthentication',
      contentHash: 'authentication-contract',
      fileName: 'tashil-authentication/type.ts',
      propsTypeName: 'TashilAuthenticationProps',
      targets: [
        {
          kind: 'visual',
          ownerProp: 'title',
          path: ['title'],
          required: true,
          typeName: 'string | JSX.Element',
        },
        {
          kind: 'visual',
          ownerProp: 'description',
          path: ['description'],
          required: true,
          typeName: 'string | JSX.Element',
        },
        {
          kind: 'visual',
          ownerProp: 'pageState',
          path: ['pageState'],
          required: true,
          typeName: 'LoginChallenges',
          values: ['Login', 'OneTimePassword', 'MobileOwnership'],
        },
        {
          kind: 'event',
          ownerProp: 'onBack',
          path: ['onBack'],
          required: false,
          typeName: '(pageState: string) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'hideBackButton',
          path: ['hideBackButton'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'showLogo',
          path: ['showLogo'],
          required: true,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'record',
          ownerProp: 'childProps',
          path: ['childProps'],
          required: true,
          typeName: 'PagesProps',
        },
        {
          kind: 'node',
          ownerProp: 'logo',
          path: ['logo'],
          required: false,
          typeName: 'JSX.Element',
        },
      ],
    };
    const authenticationFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'authentication',
      componentName: 'TashilAuthentication',
      properties: [
        {
          defaultValue: 'Sign in',
          id: 'title',
          name: 'title',
          options: [],
          rawKey: 'title',
          type: 'TEXT',
        },
        {
          defaultValue: 'Enter your mobile number',
          id: 'description',
          name: 'description',
          options: [],
          rawKey: 'description',
          type: 'TEXT',
        },
        {
          defaultValue: 'Login',
          id: 'page-state',
          name: 'pageState',
          options: ['Login', 'OneTimePassword', 'MobileOwnership'],
          rawKey: 'pageState',
          type: 'VARIANT',
        },
        {
          defaultValue: false,
          id: 'hide-back-button',
          name: 'hideBackButton',
          options: [],
          rawKey: 'hideBackButton',
          type: 'BOOLEAN',
        },
        {
          defaultValue: true,
          id: 'show-logo',
          name: 'showLogo',
          options: [],
          rawKey: 'showLogo',
          type: 'BOOLEAN',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilAuthentication', type: 'INSTANCE' },
      'authentication',
    ).snapshot;
    const recipe = createRecipeDraft(
      authenticationContract,
      authenticationFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['title', 'component-property'],
      ['description', 'component-property'],
      ['pageState', 'runtime'],
      ['onBack', 'runtime'],
      ['hideBackButton', 'component-property'],
      ['showLogo', 'component-property'],
      ['childProps', 'runtime'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilAuthentication',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          description: 'Enter your mobile number',
          hideBackButton: false,
          pageState: 'Login',
          showLogo: true,
          title: 'Sign in',
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('title={"Sign in"}');
    expect(result.usage.jsx).toContain(
      'pageState={pageState /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'childProps={childProps /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onBack={onBack /* Set in application. */}',
    );
    expect(result.usage.jsx).not.toContain('logo=');
  });

  it('uses the TashilCheckout recipe for payment data and actions', () => {
    const checkoutContract: SourceContract = {
      componentName: 'TashilCheckout',
      contentHash: 'checkout-contract',
      fileName: 'tashil-checkout/types.ts',
      propsTypeName: 'TashilCheckoutProps',
      targets: [
        {
          kind: 'visual',
          ownerProp: 'tabletSize',
          path: ['tabletSize'],
          required: false,
          typeName: 'number',
        },
        {
          kind: 'node',
          ownerProp: 'logo',
          path: ['logo'],
          required: false,
          typeName: 'React.ReactNode',
        },
        {
          kind: 'array',
          ownerProp: 'checkoutData',
          path: ['checkoutData'],
          required: true,
          typeName: '{ title: string; amount: number; subtitle?: string | React.ReactNode }[]',
        },
        {
          kind: 'array',
          ownerProp: 'banks',
          path: ['banks'],
          required: true,
          typeName: '{ name: string; logo: React.ReactNode; id: string }[]',
        },
        {
          kind: 'visual',
          ownerProp: 'defaultBank',
          path: ['defaultBank'],
          required: false,
          typeName: 'string',
        },
        {
          kind: 'event',
          ownerProp: 'onBack',
          path: ['onBack'],
          required: true,
          typeName: '() => void',
        },
        {
          kind: 'event',
          ownerProp: 'onSubmit',
          path: ['onSubmit'],
          required: true,
          typeName: '(bank: string) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'totalAmount',
          path: ['totalAmount'],
          required: false,
          typeName: 'number',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilCheckout', type: 'INSTANCE' },
      'checkout',
    ).snapshot;
    const recipe = createRecipeDraft(
      checkoutContract,
      {
        componentId: 'checkout',
        componentName: 'TashilCheckout',
        properties: [],
      },
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['checkoutData', 'runtime'],
      ['banks', 'runtime'],
      ['defaultBank', 'runtime'],
      ['onBack', 'runtime'],
      ['onSubmit', 'runtime'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilCheckout',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: {} },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain(
      'checkoutData={checkoutData /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('banks={banks /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'defaultBank={defaultBank /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onBack={onBack /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onSubmit={onSubmit /* Set in application. */}',
    );
    expect(result.usage.jsx).not.toContain('totalAmount=');
    expect(result.usage.jsx).not.toContain('logo=');
  });

  it('uses the TashilOtpInput recipe for entered values and callbacks', () => {
    const otpContract: SourceContract = {
      componentName: 'TashilOtpInput',
      contentHash: 'otp-input-contract',
      fileName: 'tashil-otp-input/types.ts',
      propsTypeName: 'TashilOtpInputProps',
      targets: [
        {
          kind: 'event',
          ownerProp: 'onChange',
          path: ['onChange'],
          required: true,
          typeName: '(val: string) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onComplete',
          path: ['onComplete'],
          required: false,
          typeName: '(val: string) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'fields',
          path: ['fields'],
          required: false,
          typeName: 'number',
        },
        {
          kind: 'visual',
          ownerProp: 'loading',
          path: ['loading'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'array',
          ownerProp: 'values',
          path: ['values'],
          required: false,
          typeName: 'string[]',
        },
        {
          kind: 'visual',
          ownerProp: 'disabled',
          path: ['disabled'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'array',
          ownerProp: 'placeholder',
          path: ['placeholder'],
          required: false,
          typeName: 'string[]',
        },
        {
          kind: 'visual',
          ownerProp: 'size',
          path: ['size'],
          required: false,
          typeName: "'medium' | 'small'",
          values: ['medium', 'small'],
        },
        {
          kind: 'visual',
          ownerProp: 'helperText',
          path: ['helperText'],
          required: false,
          typeName: 'string',
        },
        {
          kind: 'visual',
          ownerProp: 'variant',
          path: ['variant'],
          required: false,
          typeName: "'error' | 'default'",
          values: ['error', 'default'],
        },
      ],
    };
    const otpFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'otp-input',
      componentName: 'TashilOtpInput',
      properties: [
        {
          defaultValue: false,
          id: 'loading',
          name: 'loading',
          options: [],
          rawKey: 'loading',
          type: 'BOOLEAN',
        },
        {
          defaultValue: false,
          id: 'disabled',
          name: 'disabled',
          options: [],
          rawKey: 'disabled',
          type: 'BOOLEAN',
        },
        {
          defaultValue: 'Medium',
          id: 'size',
          name: 'size',
          options: ['Medium', 'Small'],
          rawKey: 'size',
          type: 'VARIANT',
        },
        {
          defaultValue: '',
          id: 'helper-text',
          name: 'helperText',
          options: [],
          rawKey: 'helperText',
          type: 'TEXT',
        },
        {
          defaultValue: 'Default',
          id: 'variant',
          name: 'variant',
          options: ['Default', 'Error'],
          rawKey: 'variant',
          type: 'VARIANT',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilOtpInput', type: 'INSTANCE' },
      'otp-input',
    ).snapshot;
    const recipe = createRecipeDraft(
      otpContract,
      otpFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['onChange', 'runtime'],
      ['onComplete', 'runtime'],
      ['loading', 'component-property'],
      ['values', 'runtime'],
      ['disabled', 'component-property'],
      ['placeholder', 'omitted'],
      ['size', 'component-property'],
      ['helperText', 'component-property'],
      ['variant', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilOtpInput',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          disabled: false,
          helperText: '',
          loading: false,
          size: 'Medium',
          variant: 'Default',
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('values={values /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'onChange={onChange /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onComplete={onComplete /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('size={"medium"}');
    expect(result.usage.jsx).toContain('variant={"default"}');
    expect(result.usage.jsx).not.toContain('placeholder=');
  });

  it('uses the TashilUpload recipe for controlled files and lifecycle actions', () => {
    const uploadContract: SourceContract = {
      componentName: 'TashilUpload',
      contentHash: 'upload-contract',
      fileName: 'tashil-upload/types.ts',
      propsTypeName: 'TashilUploadProps',
      targets: [
        {
          kind: 'array',
          ownerProp: 'files',
          path: ['files'],
          required: true,
          typeName: 'SelectedFile[]',
        },
        {
          kind: 'event',
          ownerProp: 'onChangeFiles',
          path: ['onChangeFiles'],
          required: true,
          typeName: '(files: SelectedFile[]) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRetry',
          path: ['onRetry'],
          required: true,
          typeName: '(file: SelectedFile) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRemove',
          path: ['onRemove'],
          required: false,
          typeName: '(file: SelectedFile) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRejectFiles',
          path: ['onRejectFiles'],
          required: false,
          typeName: '(err: FileError[][], firstError: string) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'isSending',
          path: ['isSending'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'uploadText',
          path: ['uploadText'],
          required: false,
          typeName: 'string',
        },
        {
          kind: 'visual',
          ownerProp: 'size',
          path: ['size'],
          required: true,
          typeName: "'medium' | 'small'",
          values: ['medium', 'small'],
        },
        {
          kind: 'visual',
          ownerProp: 'helperText',
          path: ['helperText', 'helperText'],
          required: false,
          typeName: 'string',
        },
        {
          kind: 'visual',
          ownerProp: 'helperText',
          path: ['helperText', 'type'],
          required: false,
          typeName: "'error' | 'default' | 'success'",
          values: ['error', 'default', 'success'],
        },
        {
          kind: 'visual',
          ownerProp: 'required',
          path: ['required'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    };
    const uploadFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'upload',
      componentName: 'TashilUpload',
      properties: [
        {
          defaultValue: false,
          id: 'is-sending',
          name: 'isSending',
          options: [],
          rawKey: 'isSending',
          type: 'BOOLEAN',
        },
        {
          defaultValue: 'Upload file',
          id: 'upload-text',
          name: 'uploadText',
          options: [],
          rawKey: 'uploadText',
          type: 'TEXT',
        },
        {
          defaultValue: 'Medium',
          id: 'size',
          name: 'size',
          options: ['Medium', 'Small'],
          rawKey: 'size',
          type: 'VARIANT',
        },
        {
          defaultValue: '',
          id: 'helper-text',
          name: 'helperText',
          options: [],
          rawKey: 'helperText',
          type: 'TEXT',
        },
        {
          defaultValue: 'Default',
          id: 'helper-type',
          name: 'type',
          options: ['Default', 'Error', 'Success'],
          rawKey: 'type',
          type: 'VARIANT',
        },
        {
          defaultValue: false,
          id: 'required',
          name: 'required',
          options: [],
          rawKey: 'required',
          type: 'BOOLEAN',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilUpload', type: 'INSTANCE' },
      'upload',
    ).snapshot;
    const recipe = createRecipeDraft(
      uploadContract,
      uploadFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['files', 'runtime'],
      ['onChangeFiles', 'runtime'],
      ['onRetry', 'runtime'],
      ['onRemove', 'runtime'],
      ['onRejectFiles', 'omitted'],
      ['isSending', 'component-property'],
      ['uploadText', 'component-property'],
      ['size', 'component-property'],
      ['helperText.helperText', 'component-property'],
      ['helperText.type', 'component-property'],
      ['required', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilUpload',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          helperText: '',
          isSending: false,
          required: false,
          size: 'Medium',
          type: 'Default',
          uploadText: 'Upload file',
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('files={files /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'onChangeFiles={onChangeFiles /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onRetry={onRetry /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'onRemove={onRemove /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('size={"medium"}');
    expect(result.usage.jsx).not.toContain('onRejectFiles=');
  });

  it('uses the TashilNewMessage recipe without emitting overridden input state', () => {
    const newMessageContract: SourceContract = {
      componentName: 'TashilNewMessage',
      contentHash: 'new-message-contract',
      fileName: 'tashil-new-message/types.ts',
      propsTypeName: 'NewMessageProps',
      targets: [
        {
          kind: 'array',
          ownerProp: 'files',
          path: ['files'],
          required: true,
          typeName: 'SelectedFile[]',
        },
        {
          kind: 'event',
          ownerProp: 'onChangeFiles',
          path: ['onChangeFiles'],
          required: true,
          typeName: '(files: SelectedFile[]) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRetry',
          path: ['onRetry'],
          required: true,
          typeName: '(file: SelectedFile) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRemove',
          path: ['onRemove'],
          required: false,
          typeName: '(file: SelectedFile) => void',
        },
        {
          kind: 'event',
          ownerProp: 'onRejectFiles',
          path: ['onRejectFiles'],
          required: false,
          typeName: '(err: FileError[][], firstError: string) => void',
        },
        {
          kind: 'visual',
          ownerProp: 'size',
          path: ['size'],
          required: true,
          typeName: "'medium' | 'small'",
          values: ['medium', 'small'],
        },
        {
          kind: 'visual',
          ownerProp: 'allowToAttach',
          path: ['allowToAttach'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'event',
          ownerProp: 'onSubmit',
          path: ['onSubmit'],
          required: true,
          typeName: '(data: NewMessageData, actions: NewMessageActions) => any',
        },
        {
          kind: 'visual',
          ownerProp: 'textInputProps',
          path: ['textInputProps', 'label'],
          required: false,
          typeName: 'React.ReactNode',
        },
        {
          kind: 'visual',
          ownerProp: 'textInputProps',
          path: ['textInputProps', 'value'],
          required: false,
          typeName: 'unknown',
        },
        {
          kind: 'event',
          ownerProp: 'textInputProps',
          path: ['textInputProps', 'onChange'],
          required: false,
          typeName: 'React.ChangeEventHandler<HTMLInputElement>',
        },
        {
          kind: 'visual',
          ownerProp: 'isSending',
          path: ['isSending'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'submitButtonText',
          path: ['submitButtonText'],
          required: false,
          typeName: 'string',
        },
        {
          kind: 'visual',
          ownerProp: 'closeTicket',
          path: ['closeTicket'],
          required: false,
          typeName: 'boolean',
          values: [false, true],
        },
        {
          kind: 'visual',
          ownerProp: 'closeTicketText',
          path: ['closeTicketText'],
          required: false,
          typeName: 'string',
        },
      ],
    };
    const newMessageFigmaSnapshot: FigmaComponentSnapshot = {
      componentId: 'new-message',
      componentName: 'TashilNewMessage',
      properties: [
        {
          defaultValue: 'Medium',
          id: 'size',
          name: 'size',
          options: ['Medium', 'Small'],
          rawKey: 'size',
          type: 'VARIANT',
        },
        {
          defaultValue: true,
          id: 'allow-to-attach',
          name: 'allowToAttach',
          options: [],
          rawKey: 'allowToAttach',
          type: 'BOOLEAN',
        },
        {
          defaultValue: 'Message',
          id: 'label',
          name: 'label',
          options: [],
          rawKey: 'label',
          type: 'TEXT',
        },
        {
          defaultValue: 'Ignored design value',
          id: 'value',
          name: 'value',
          options: [],
          rawKey: 'value',
          type: 'TEXT',
        },
        {
          defaultValue: false,
          id: 'is-sending',
          name: 'isSending',
          options: [],
          rawKey: 'isSending',
          type: 'BOOLEAN',
        },
        {
          defaultValue: 'Send',
          id: 'submit-button-text',
          name: 'submitButtonText',
          options: [],
          rawKey: 'submitButtonText',
          type: 'TEXT',
        },
        {
          defaultValue: true,
          id: 'close-ticket',
          name: 'closeTicket',
          options: [],
          rawKey: 'closeTicket',
          type: 'BOOLEAN',
        },
        {
          defaultValue: 'Close ticket',
          id: 'close-ticket-text',
          name: 'closeTicketText',
          options: [],
          rawKey: 'closeTicketText',
          type: 'TEXT',
        },
      ],
    };
    const semanticSnapshot = extractFigmaSemanticSnapshot(
      { name: 'TashilNewMessage', type: 'INSTANCE' },
      'new-message',
    ).snapshot;
    const recipe = createRecipeDraft(
      newMessageContract,
      newMessageFigmaSnapshot,
      semanticSnapshot,
    );

    expect(recipe.bindings.map((binding) => [
      binding.target.path.join('.'),
      binding.source.kind,
    ])).toEqual([
      ['files', 'runtime'],
      ['onChangeFiles', 'runtime'],
      ['onRetry', 'runtime'],
      ['onRemove', 'runtime'],
      ['onRejectFiles', 'omitted'],
      ['size', 'component-property'],
      ['allowToAttach', 'component-property'],
      ['onSubmit', 'runtime'],
      ['textInputProps.label', 'component-property'],
      ['textInputProps.value', 'omitted'],
      ['textInputProps.onChange', 'omitted'],
      ['isSending', 'component-property'],
      ['submitButtonText', 'component-property'],
      ['closeTicket', 'component-property'],
      ['closeTicketText', 'component-property'],
    ]);
    expect(validateRecipeDraft(recipe)).toMatchObject({ errors: [], saveable: true });

    const result = resolveSemanticUsage(
      'TashilNewMessage',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          allowToAttach: true,
          closeTicket: true,
          closeTicketText: 'Close ticket',
          isSending: false,
          label: 'Message',
          size: 'Medium',
          submitButtonText: 'Send',
          value: 'Ignored design value',
        },
      },
    );
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('files={files /* Set in application. */}');
    expect(result.usage.jsx).toContain(
      'onSubmit={onSubmit /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain('textInputProps={{ label: "Message" }}');
    expect(result.usage.jsx).not.toContain('value:');
    expect(result.usage.jsx).not.toContain('onChange:');
    expect(result.usage.jsx).not.toContain('onRejectFiles=');
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

  it('blocks an omitted binding when a runtime target becomes required', () => {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    const recipe = createRecipeDraft(contract, figmaSnapshot, semanticSnapshot);
    const omitted = {
      ...recipe,
      bindings: recipe.bindings.map((binding) => (
        binding.target.path.join('.') === 'onConfirm'
          ? {
              ...binding,
              requirement: 'optional' as const,
              source: { kind: 'omitted' as const },
            }
          : binding
      )),
    };

    const validation = validateRecipeDraft(omitted);

    expect(validation.saveable).toBe(false);
    expect(validation.summary.unresolvedRuntime).toBe(1);
    expect(validation.errors).toContain(
      'Mark the required callback "onConfirm" as set in application.',
    );
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

  it('counts one incompatible repeated slot regardless of its item count', () => {
    const semanticSnapshot = extractFigmaSemanticSnapshot({
      children: [
        {
          connectedComponentName: 'Avatar',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'avatar-one',
          name: 'First avatar',
          type: 'INSTANCE',
        },
        {
          connectedComponentName: 'Badge',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'badge-one',
          name: 'Badge',
          type: 'INSTANCE',
        },
      ],
      name: 'Tabs',
      type: 'COMPONENT',
    }, 'tabs-id').snapshot;
    const target: SourceTargetDescriptor = {
      itemSchemas: [{
        kind: 'node',
        role: 'item',
        typeName: 'ReactElement<TabProps, typeof Tab>',
      }],
      kind: 'array',
      ownerProp: 'tabs',
      path: ['tabs'],
      required: true,
      typeName: 'ReactElement<TabProps, typeof Tab>[]',
    };
    const recipe = createRecipeDraft({
      componentName: 'Tabs',
      contentHash: 'hash',
      fileName: 'tabs.tsx',
      targets: [target],
    }, undefined, semanticSnapshot);
    const withIncompatibleItems = {
      ...recipe,
      bindings: recipe.bindings.map((binding) => (
        binding.target.path.join('.') === 'tabs'
          ? {
              ...binding,
              source: {
                items: [
                  {
                    componentName: 'Avatar',
                    importPath: '@tashilcar/ui',
                    locator: {
                      componentKey: 'avatar-one',
                      fragile: false,
                      namePath: ['First avatar'],
                    },
                  },
                  {
                    componentName: 'Badge',
                    importPath: '@tashilcar/ui',
                    locator: {
                      componentKey: 'badge-one',
                      fragile: false,
                      namePath: ['Badge'],
                    },
                  },
                ],
                kind: 'instances' as const,
              },
            }
          : binding
      )),
    };

    const validation = validateRecipeDraft(withIncompatibleItems);

    expect(validation.summary.incompatibleSlots).toBe(1);
    expect(validation.summary.blocking).toBe(1);
    expect(validation.errors).toEqual([
      '"tabs" accepts Tab, not Avatar, Badge.',
    ]);
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

describe('validateRecipeDraft summary (roadmap M7)', () => {
  // Baseline: a fully-drafted Dialog recipe is saveable, so the summary is clean.
  function baseRecipe() {
    const { contract, figmaSnapshot, semanticSnapshot } = createDialogInputs();
    return { figmaSnapshot, recipe: createRecipeDraft(contract, figmaSnapshot, semanticSnapshot) };
  }

  it('reports zero blocking for a saveable recipe (review items allowed)', () => {
    const { recipe } = baseRecipe();
    const validation = validateRecipeDraft(recipe);
    // A drafted recipe may carry non-blocking review items (fragile locators,
    // unmapped enum values) yet still be saveable. Only blocking must be zero.
    expect(validation.saveable).toBe(true);
    expect(validation.summary.blocking).toBe(0);
    expect(validation.summary.unresolvedRequired).toBe(0);
    expect(validation.summary.unresolvedRuntime).toBe(0);
    expect(validation.summary.incompatibleSlots).toBe(0);
    expect(validation.summary.review).toBe(validation.warnings.length);
  });

  it('counts an unresolved required visual prop and flips blocking', () => {
    // `title` is a required visual target; clearing it must block save.
    const { figmaSnapshot, recipe } = baseRecipe();
    const next = setTargetOption(recipe, figmaSnapshot, ['title'], '');
    const validation = validateRecipeDraft(next);

    expect(validation.saveable).toBe(false);
    expect(validation.summary.blocking).toBeGreaterThan(0);
    expect(validation.summary.unresolvedRequired).toBeGreaterThanOrEqual(1);
  });

  it('summary.blocking equals the error count and never double-counts', () => {
    const { figmaSnapshot, recipe } = baseRecipe();
    const next = setTargetOption(recipe, figmaSnapshot, ['title'], '');
    const validation = validateRecipeDraft(next);

    expect(validation.summary.blocking).toBe(validation.errors.length);
  });
});
