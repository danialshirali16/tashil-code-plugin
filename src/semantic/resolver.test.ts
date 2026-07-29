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
  it('connects the standalone Icon and validates its name against IconNames', () => {
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'binding-icon-name',
        requirement: 'required',
        source: {
          kind: 'component-property',
          propertyId: 'icon-name',
          propertyName: 'name',
        },
        target: { path: ['name'], typeName: 'IconNames' },
      }],
      figmaSnapshot: {
        componentId: 'icon',
        componentName: 'Icon',
        nestedSources: [],
      },
      revision: 1,
      schemaVersion: 1,
      sourceContract: {
        componentName: 'Icon',
        contentHash: 'icon-source',
        fileName: 'icon/Icon.types.ts',
        propsTypeName: 'IconProps',
        targets: [{
          kind: 'visual',
          ownerProp: 'name',
          path: ['name'],
          required: true,
          typeName: 'IconNames',
          values: ['', 'plus', 'trash'],
        }],
      },
    };

    const valid = resolveSemanticUsage(
      'Icon',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { name: 'trash' } },
    );
    const invalid = resolveSemanticUsage(
      'Icon',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: { name: 'fictional-icon' } },
    );

    expect(valid.issues).toEqual([]);
    expect(valid.usage.jsx).toBe('<Icon name={"trash"} />');
    expect(invalid.usage.jsx).toBe('<Icon />');
    expect(invalid.issues).toEqual([
      'Required value "name" could not be resolved: Icon name "fictional-icon" is not declared by IconNames.',
    ]);
  });

  it('keeps arbitrary fixed values available for non-Icon component props', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [{
      id: 'binding-variant',
      requirement: 'required',
      source: { kind: 'static', value: 'custom-variant' },
      target: { path: ['variant'], typeName: 'ButtonVariantType' },
    }];
    recipe.sourceContract = {
      componentName: 'Button',
      contentHash: 'button-source',
      fileName: 'button/types.ts',
      propsTypeName: 'ButtonProps',
      targets: [{
        kind: 'visual',
        ownerProp: 'variant',
        path: ['variant'],
        required: true,
        typeName: 'ButtonVariantType',
        values: ['solid', 'outline', 'ghost'],
      }],
    };

    const result = resolveSemanticUsage(
      'Button',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: {} },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toBe('<Button variant={"custom-variant"} />');
  });

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
        '  onConfirm={onConfirm /* Set in application. */}',
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
      { placeholder: 'onConfirm', targetPath: 'onConfirm', typeName: '() => void' },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('renders complex runtime targets as actionable, type-preserving placeholders', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [
      {
        id: 'binding-items',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['items'], typeName: 'Item[]' },
      },
      {
        id: 'binding-render-item',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['renderItem'], typeName: '(item: Item) => ReactNode' },
      },
    ];

    const result = resolveSemanticUsage('DataView', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root: { name: 'DataView', type: 'INSTANCE' },
    });

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('items={items /* Set in application. */}');
    expect(result.usage.jsx).toContain('renderItem={renderItem /* Set in application. */}');
    expect(result.runtimeRequirements).toEqual([
      { placeholder: 'items', targetPath: 'items', typeName: 'Item[]' },
      {
        placeholder: 'renderItem',
        targetPath: 'renderItem',
        typeName: '(item: Item) => ReactNode',
      },
    ]);
  });

  it('does not emit a connected child that violates an explicit ReactElement type', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [{
      id: 'binding-action',
      requirement: 'required',
      source: {
        componentName: 'Avatar',
        importPath: '@tashilcar/ui',
        kind: 'instance',
        locator: {
          componentKey: 'avatar-key',
          fragile: false,
          namePath: ['Action'],
        },
      },
      target: {
        path: ['action'],
        typeName: 'ReactElement<ButtonProps, typeof Button>',
      },
    }];

    const result = resolveSemanticUsage('Card', '@tashilcar/ui', recipe, {
      componentProperties: {},
    });

    expect(result.usage.jsx).toBe('<Card />');
    expect(result.issues).toEqual([
      'Required value "action" could not be resolved: Avatar is incompatible with ReactElement<ButtonProps, typeof Button>; expected Button.',
    ]);
    expect(result.explanations).toContainEqual({
      outcome: 'unresolved',
      reason: 'Avatar is incompatible with ReactElement<ButtonProps, typeof Button>; expected Button.',
      targetPath: 'action',
    });
  });

  it('assembles recursively mapped object leaves into nested object literals', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [
      {
        id: 'binding-primary',
        requirement: 'required',
        source: { kind: 'static', value: '#0057b8' },
        target: {
          path: ['config', 'theme', 'palette', 'primary'],
          typeName: 'string',
        },
      },
      {
        id: 'binding-dense',
        requirement: 'required',
        source: { kind: 'static', value: true },
        target: {
          path: ['config', 'theme', 'dense'],
          typeName: 'boolean',
        },
      },
    ];

    const result = resolveSemanticUsage('Widget', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root: { name: 'Widget', type: 'INSTANCE' },
    });

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain(
      'config={{ theme: { palette: { primary: "#0057b8" }, dense: true } }}',
    );
  });

  it('allocates safe, collision-free identifiers for nested runtime values', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [
      {
        id: 'binding-nested-theme',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['config', 'theme'], typeName: 'ThemeConfig' },
      },
      {
        id: 'binding-flat-theme',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['configTheme'], typeName: 'ThemeConfig' },
      },
      {
        id: 'binding-reserved',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['default'], typeName: 'string' },
      },
    ];

    const result = resolveSemanticUsage('Widget', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root: { name: 'Widget', type: 'INSTANCE' },
    });

    expect(result.usage.jsx).toContain(
      'config={{ theme: configTheme /* Set in application. */ }}',
    );
    expect(result.usage.jsx).toContain(
      'configTheme={configTheme2 /* Set in application. */}',
    );
    expect(result.usage.jsx).toContain(
      'default={runtimeDefault /* Set in application. */}',
    );
  });

  it('generates named collection, controlled-state, and callback placeholders together', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [
      {
        id: 'binding-options',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['options'], typeName: 'Option[]' },
      },
      {
        id: 'binding-value',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['value'], typeName: 'Option | null' },
      },
      {
        id: 'binding-change',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['onChange'], typeName: '(value: Option | null) => void' },
      },
    ];

    const result = resolveSemanticUsage('TashilDropdown', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root: { name: 'TashilDropdown', type: 'INSTANCE' },
    });

    expect(result.usage.jsx).toBe(
      '<TashilDropdown options={options /* Set in application. */} '
      + 'value={value /* Set in application. */} '
      + 'onChange={onChange /* Set in application. */} />',
    );
    expect(result.runtimeRequirements.map(({ placeholder }) => placeholder))
      .toEqual(['options', 'value', 'onChange']);
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

  it('surfaces a deprecation notice without blocking code generation', () => {
    const recipe = createDialogRecipe();
    recipe.lifecycle = { replacement: 'Use AlertDialog instead.', state: 'deprecated' };

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.deprecation).toBe(
      'ConfirmationDialog is deprecated. Use AlertDialog instead.',
    );
    // Code is still generated in full.
    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('title={"Delete account?"}');
  });

  it('omits the deprecation notice for non-deprecated lifecycle states', () => {
    const recipe = createDialogRecipe();
    recipe.lifecycle = { state: 'connected' };

    const result = resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
      componentProperties: { intent: 'Danger' },
      root: createDialogNode(),
    });

    expect(result.deprecation).toBeUndefined();
  });

  it('resolves Button icon slots from paired visibility and instance-swap properties', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [
      {
        id: 'binding-left-icon',
        requirement: 'optional',
        source: {
          kind: 'component-property',
          propertyId: 'has-leading-icon',
          propertyName: 'hasLeadingIcon',
        },
        target: { path: ['renderLeftIcon'], typeName: 'ReactNode' },
      },
      {
        id: 'binding-right-icon',
        requirement: 'optional',
        source: {
          kind: 'component-property',
          propertyId: 'trailing-icon',
          propertyName: 'trailingIcon',
        },
        target: { path: ['renderRightIcon'], typeName: 'ReactNode' },
      },
    ];

    const result = resolveSemanticUsage(
      'Button',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {
          hasLeadingIcon: true,
          trailingIcon: 'chevron-left-id',
        },
        instanceSwaps: {
          leadingIcon: { componentId: 'plus-id', componentName: 'Icon / Trash' },
          trailingIcon: { componentId: 'chevron-left-id', componentName: 'ChevronLeft' },
        },
      },
    );

    expect(result.issues).toEqual([]);
    expect(result.usage.jsx).toContain('renderLeftIcon={<Icon name={"trash"} />}');
    expect(result.usage.jsx).toContain('renderRightIcon={<Icon name={"chevron-left"} />}');
    expect(result.usage.imports).toContainEqual({
      importedName: 'Icon',
      localName: 'Icon',
      modulePath: '@tashilcar/swiss-army-knife',
    });
  });

  it('omits a hidden Button icon instead of emitting a bare boolean prop', () => {
    const recipe = createDialogRecipe();
    recipe.bindings = [{
      id: 'binding-left-icon',
      requirement: 'optional',
      source: {
        kind: 'component-property',
        propertyId: 'has-leading-icon',
        propertyName: 'hasLeadingIcon',
      },
      target: { path: ['renderLeftIcon'], typeName: 'ReactNode' },
    }];

    const result = resolveSemanticUsage(
      'Button',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: { hasLeadingIcon: false },
        instanceSwaps: {
          leadingIcon: { componentId: 'plus-id', componentName: 'Plus' },
        },
      },
    );

    expect(result.usage.jsx).not.toContain('renderLeftIcon');
  });
});

function resolveDialogWith(recipe: SemanticConnectionRecipe) {
  return resolveSemanticUsage('ConfirmationDialog', '@tashilcar/ui', recipe, {
    componentProperties: { intent: 'Danger' },
    root: createDialogNode(),
  });
}
