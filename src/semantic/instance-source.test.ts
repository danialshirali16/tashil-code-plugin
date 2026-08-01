import { describe, expect, it } from 'vitest';
import { buildValueOptions, nestedOptionId } from './authoring';
import { extractFigmaSemanticSnapshot, type SemanticNodeLike } from './figma-extractor';
import { evaluateSemanticHealth } from './health';
import { resolveSemanticUsage } from './resolver';
import { validateSemanticRecipe } from './schema';
import type { SourceTargetDescriptor } from './source-contract';
import { SEMANTIC_RECIPE_SCHEMA_VERSION, type SemanticConnectionRecipe } from './types';

/**
 * A connected nested instance used as a real component value — the case the
 * legacy pipeline covered with icon instance swaps (`renderLeftIcon={<Icon />}`)
 * and that semantic connections must not regress on.
 */
function buttonWithConnectedIcon(): SemanticNodeLike {
  return {
    children: [
      {
        connectedComponentName: 'TrashIcon',
        connectedImportPath: '@tashilcar/icons',
        hasOwnConnection: true,
        mainComponentKey: 'icon-main-key',
        name: 'Leading icon',
        type: 'INSTANCE',
        componentProperties: { name: 'trash' },
        // Internals must never be harvested from a connected child.
        children: [{ characters: 'ignore me', name: 'Glyph', type: 'TEXT' }],
      },
      { characters: 'Delete', name: 'Label', type: 'TEXT' },
    ],
    name: 'Button',
    type: 'COMPONENT',
  };
}

function buttonWithExposedIconName(): SemanticNodeLike {
  return {
    children: [
      {
        componentProperties: { name: 'trash' },
        mainComponentKey: 'icon-main-key',
        name: 'Leading icon',
        type: 'INSTANCE',
      },
    ],
    name: 'Button',
    type: 'COMPONENT',
  };
}

function dialogWithConnectedAction(): SemanticNodeLike {
  const actionRecipe: SemanticConnectionRecipe = {
    bindings: [
      {
        id: 'action-variant',
        requirement: 'optional',
        source: {
          kind: 'component-property',
          propertyId: 'variant-id',
          propertyName: 'variant',
        },
        target: { path: ['variant'], typeName: '"solid" | "ghost"' },
      },
      {
        id: 'action-click',
        requirement: 'runtime',
        source: { kind: 'runtime' },
        target: { path: ['onClick'], typeName: 'MouseEventHandler<HTMLButtonElement>' },
      },
    ],
    figmaSnapshot: {
      componentId: 'button-child',
      componentName: 'Button',
      nestedSources: [],
    },
    revision: 1,
    schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
  };

  return {
    children: [
      {
        componentProperties: { variant: 'ghost' },
        connectedComponentName: 'Button',
        connectedImportPath: '@tashilcar/ui',
        connectedRecipe: actionRecipe,
        hasOwnConnection: true,
        mainComponentKey: 'button-main-key',
        name: 'Footer action',
        type: 'INSTANCE',
      },
    ],
    name: 'Dialog',
    type: 'COMPONENT',
  };
}

function nodeTarget(name: string): SourceTargetDescriptor {
  return { kind: 'node', ownerProp: name, path: [name], required: false, typeName: 'ReactNode' };
}

function visualTarget(name: string): SourceTargetDescriptor {
  return { kind: 'visual', ownerProp: name, path: [name], required: false, typeName: 'string' };
}

describe('connected nested instance extraction', () => {
  it('captures a connected child as a nested-instance source and stops descending', () => {
    const { snapshot } = extractFigmaSemanticSnapshot(buttonWithConnectedIcon(), '1:1');

    const instance = snapshot.nestedSources.find((s) => s.kind === 'nested-instance');
    expect(instance).toMatchObject({
      connectedComponentName: 'TrashIcon',
      connectedImportPath: '@tashilcar/icons',
      displayPath: 'Leading icon',
    });
    expect(instance?.locator.componentKey).toBe('icon-main-key');

    // The connected child's internals are not harvested as parent sources.
    expect(snapshot.nestedSources.some((s) => s.displayPath.includes('Glyph'))).toBe(false);
    // Sibling text outside the connected child is still captured.
    expect(snapshot.nestedSources.some((s) => s.displayPath === 'Label')).toBe(true);
  });

  it('leads with a connected instance for targets that expect a component', () => {
    const { snapshot } = extractFigmaSemanticSnapshot(buttonWithConnectedIcon(), '1:1');

    const nodeOptions = buildValueOptions(nodeTarget('renderLeftIcon'), undefined, snapshot);
    expect(nodeOptions[0].label).toBe('Leading icon');
    expect(nodeOptions[0].needsCheck).toBeUndefined();
    const instanceDescriptor = snapshot.nestedSources.find((s) => s.kind === 'nested-instance')!;
    expect(nodeOptions.map((o) => o.id)).toContain(nestedOptionId(instanceDescriptor));

    // A string prop can still see the component, but it is flagged rather than
    // hidden — only the component's author knows whether it makes sense.
    const textOptions = buildValueOptions(visualTarget('label'), undefined, snapshot);
    expect(textOptions.find((o) => o.label === 'Leading icon')?.needsCheck).toBe(true);
  });
});

describe('connected nested instance generation', () => {
  function recipeWithIcon(): SemanticConnectionRecipe {
    const { snapshot } = extractFigmaSemanticSnapshot(buttonWithConnectedIcon(), '1:1');
    return {
      bindings: [{
        id: 'binding-icon',
        requirement: 'optional',
        source: {
          componentName: 'TrashIcon',
          importPath: '@tashilcar/icons',
          kind: 'instance',
          locator: { componentKey: 'icon-main-key', fragile: false, namePath: ['Leading icon'] },
        },
        target: { path: ['renderLeftIcon'], typeName: 'ReactNode' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };
  }

  it('emits the child as a JSX component value and imports it', () => {
    const result = resolveSemanticUsage('Button', '@tashilcar/ui', recipeWithIcon(), {
      componentProperties: {},
      root: buttonWithConnectedIcon(),
    });

    expect(result.usage.jsx).toContain('renderLeftIcon={<TrashIcon name={"trash"} />}');
    expect(result.issues).toEqual([]);
    expect(result.usage.imports).toEqual([
      { importedName: 'Button', localName: 'Button', modulePath: '@tashilcar/ui' },
      { importedName: 'TrashIcon', localName: 'TrashIcon', modulePath: '@tashilcar/icons' },
    ]);
  });

  it('explains where the component value came from', () => {
    const result = resolveSemanticUsage('Button', '@tashilcar/ui', recipeWithIcon(), {
      componentProperties: {},
      root: buttonWithConnectedIcon(),
    });

    const explanation = result.explanations.find((e) => e.targetPath === 'renderLeftIcon');
    expect(explanation?.outcome).toBe('emitted');
    expect(explanation?.reason).toContain('TrashIcon');
  });

  it('passes schema validation and rejects an unsafe component name', () => {
    const recipe = recipeWithIcon();
    expect(validateSemanticRecipe(JSON.parse(JSON.stringify(recipe)))).toMatchObject({ ok: true });

    const unsafe = JSON.parse(JSON.stringify(recipe)) as {
      bindings: Array<{ source: { componentName: string } }>;
    };
    unsafe.bindings[0].source.componentName = 'Icon /><script>';
    expect(validateSemanticRecipe(unsafe).ok).toBe(false);
  });

  it('reports a removed connected child through health', () => {
    const recipe = recipeWithIcon();
    const withoutIcon: SemanticNodeLike = {
      children: [{ characters: 'Delete', name: 'Label', type: 'TEXT' }],
      name: 'Button',
      type: 'COMPONENT',
    };
    const { snapshot } = extractFigmaSemanticSnapshot(withoutIcon, '1:1');

    const issues = evaluateSemanticHealth(recipe, snapshot, undefined);

    expect(issues.some((issue) => issue.targetPath === 'renderLeftIcon')).toBe(true);
  });

  it('uses a connected child for TashilDropdown noOptionsText', () => {
    const root: SemanticNodeLike = {
      children: [{
        connectedComponentName: 'DropdownEmptyState',
        connectedImportPath: '@tashilcar/ui',
        hasOwnConnection: true,
        mainComponentKey: 'dropdown-empty-state',
        name: 'No options',
        type: 'INSTANCE',
      }],
      name: 'Dropdown',
      type: 'COMPONENT',
    };
    const { snapshot } = extractFigmaSemanticSnapshot(root, 'dropdown');
    const target: SourceTargetDescriptor = {
      kind: 'node',
      ownerProp: 'noOptionsText',
      path: ['noOptionsText'],
      required: false,
      typeName: 'Node',
    };
    const option = buildValueOptions(target, undefined, snapshot)
      .find((candidate) => candidate.label === 'No options');
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'dropdown-empty',
        requirement: 'optional',
        source: {
          componentName: 'DropdownEmptyState',
          importPath: '@tashilcar/ui',
          kind: 'instance',
          locator: {
            componentKey: 'dropdown-empty-state',
            fragile: false,
            namePath: ['No options'],
          },
        },
        target: { path: ['noOptionsText'], typeName: 'Node' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };

    const result = resolveSemanticUsage('TashilDropdown', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root,
    });

    expect(option?.needsCheck).toBeUndefined();
    expect(result.usage.jsx).toContain(
      'noOptionsText={<DropdownEmptyState />}',
    );
    expect(result.issues).toEqual([]);
  });

  it('resolves a non-icon child through the child connection recipe', () => {
    const root = dialogWithConnectedAction();
    const { snapshot } = extractFigmaSemanticSnapshot(root, 'dialog-root');
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'dialog-action',
        requirement: 'optional',
        source: {
          componentName: 'Button',
          importPath: '@tashilcar/ui',
          kind: 'instance',
          locator: {
            componentKey: 'button-main-key',
            fragile: false,
            namePath: ['Footer action'],
          },
        },
        target: { path: ['footerAction'], typeName: 'ReactNode' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };

    const result = resolveSemanticUsage('Dialog', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root,
    });

    expect(result.usage.jsx).toContain(
      'footerAction={<Button variant={"ghost"} onClick={onClick /* Set in application. */} />}',
    );
    expect(result.usage.imports).toEqual([
      { importedName: 'Dialog', localName: 'Dialog', modulePath: '@tashilcar/ui' },
      { importedName: 'Button', localName: 'Button', modulePath: '@tashilcar/ui' },
    ]);
    expect(result.runtimeRequirements).toEqual([{
      placeholder: 'onClick',
      targetPath: 'footerAction.onClick',
      typeName: 'MouseEventHandler<HTMLButtonElement>',
    }]);
    expect(result.issues).toEqual([]);
  });

  it('emits repeated connected children in the authored order with deduplicated imports', () => {
    const root: SemanticNodeLike = {
      children: [
        {
          connectedComponentName: 'PrimaryAction',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'primary-key',
          name: 'Primary',
          type: 'INSTANCE',
        },
        {
          connectedComponentName: 'SecondaryAction',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'secondary-key',
          name: 'Secondary',
          type: 'INSTANCE',
        },
      ],
      name: 'ActionBar',
      type: 'COMPONENT',
    };
    const { snapshot } = extractFigmaSemanticSnapshot(root, 'action-bar');
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'actions',
        requirement: 'required',
        source: {
          items: [
            {
              componentName: 'SecondaryAction',
              importPath: '@tashilcar/ui',
              locator: {
                componentKey: 'secondary-key',
                fragile: false,
                namePath: ['Secondary'],
              },
            },
            {
              componentName: 'PrimaryAction',
              importPath: '@tashilcar/ui',
              locator: {
                componentKey: 'primary-key',
                fragile: false,
                namePath: ['Primary'],
              },
            },
          ],
          kind: 'instances',
        },
        target: { path: ['actions'], typeName: 'ReactElement[]' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };

    const result = resolveSemanticUsage('ActionBar', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root,
    });

    expect(validateSemanticRecipe(JSON.parse(JSON.stringify(recipe))).ok).toBe(true);
    expect(result.usage.jsx).toContain(
      'actions={[<SecondaryAction />, <PrimaryAction />]}',
    );
    expect(result.usage.imports).toEqual([
      { importedName: 'ActionBar', localName: 'ActionBar', modulePath: '@tashilcar/ui' },
      {
        importedName: 'SecondaryAction',
        localName: 'SecondaryAction',
        modulePath: '@tashilcar/ui',
      },
      {
        importedName: 'PrimaryAction',
        localName: 'PrimaryAction',
        modulePath: '@tashilcar/ui',
      },
    ]);
    expect(result.issues).toEqual([]);
  });

  it('wraps repeated connected children in a declared collection item field', () => {
    const root: SemanticNodeLike = {
      children: [
        {
          connectedComponentName: 'AccountPanel',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'account-panel',
          name: 'Account',
          type: 'INSTANCE',
        },
        {
          connectedComponentName: 'SecurityPanel',
          connectedImportPath: '@tashilcar/ui',
          hasOwnConnection: true,
          mainComponentKey: 'security-panel',
          name: 'Security',
          type: 'INSTANCE',
        },
      ],
      name: 'Tabs',
      type: 'COMPONENT',
    };
    const { snapshot } = extractFigmaSemanticSnapshot(root, 'tabs');
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'tab-components',
        requirement: 'optional',
        source: {
          itemPath: ['component'],
          items: [
            {
              componentName: 'SecurityPanel',
              importPath: '@tashilcar/ui',
              locator: {
                componentKey: 'security-panel',
                fragile: false,
                namePath: ['Security'],
              },
            },
            {
              componentName: 'AccountPanel',
              importPath: '@tashilcar/ui',
              locator: {
                componentKey: 'account-panel',
                fragile: false,
                namePath: ['Account'],
              },
            },
          ],
          kind: 'instances',
        },
        target: {
          path: ['components'],
          typeName: '{ component: ReactNode; isSelected?: boolean }[]',
        },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };

    const result = resolveSemanticUsage('TashilTab', '@tashilcar/ui', recipe, {
      componentProperties: {},
      root,
    });

    expect(validateSemanticRecipe(JSON.parse(JSON.stringify(recipe))).ok).toBe(true);
    expect(result.usage.jsx).toContain(
      'components={[{ component: <SecurityPanel /> }, { component: <AccountPanel /> }]}',
    );
    expect(result.issues).toEqual([]);
  });

  it('preserves a selected instance-swap identity inside a connected child recipe', () => {
    const childRecipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'leading-icon',
        requirement: 'optional',
        source: {
          kind: 'component-property',
          propertyId: 'leading-icon-id',
          propertyName: 'leadingIcon',
        },
        target: { path: ['renderLeftIcon'], typeName: 'ReactNode' },
      }],
      figmaSnapshot: {
        componentId: 'button-child',
        componentName: 'Button',
        nestedSources: [],
      },
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };
    const root: SemanticNodeLike = {
      children: [{
        componentProperties: { leadingIcon: 'trash-component-id' },
        connectedComponentName: 'Button',
        connectedImportPath: '@tashilcar/swiss-army-knife',
        connectedRecipe: childRecipe,
        hasOwnConnection: true,
        instanceSwaps: {
          leadingIcon: {
            componentId: 'trash-component-id',
            componentName: 'Trash',
          },
        },
        mainComponentKey: 'button-key',
        name: 'Action',
        type: 'INSTANCE',
      }],
      name: 'Card',
      type: 'COMPONENT',
    };
    const { snapshot } = extractFigmaSemanticSnapshot(root, 'card');
    const recipe: SemanticConnectionRecipe = {
      bindings: [{
        id: 'action',
        requirement: 'optional',
        source: {
          componentName: 'Button',
          importPath: '@tashilcar/swiss-army-knife',
          kind: 'instance',
          locator: {
            componentKey: 'button-key',
            fragile: false,
            namePath: ['Action'],
          },
        },
        target: { path: ['action'], typeName: 'ReactNode' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };

    const result = resolveSemanticUsage(
      'Card',
      '@tashilcar/swiss-army-knife',
      recipe,
      { componentProperties: {}, root },
    );

    expect(result.usage.jsx).toContain(
      'action={<Button renderLeftIcon={<Icon name={"trash"} />} />}',
    );
    expect(result.usage.imports).toEqual([
      {
        importedName: 'Card',
        localName: 'Card',
        modulePath: '@tashilcar/swiss-army-knife',
      },
      {
        importedName: 'Button',
        localName: 'Button',
        modulePath: '@tashilcar/swiss-army-knife',
      },
      {
        importedName: 'Icon',
        localName: 'Icon',
        modulePath: '@tashilcar/swiss-army-knife',
      },
    ]);
    expect(result.issues).toEqual([]);
  });
});

describe('nested icon property generation', () => {
  function recipeWithIconName(): SemanticConnectionRecipe {
    const { snapshot } = extractFigmaSemanticSnapshot(buttonWithExposedIconName(), '1:1');
    return {
      bindings: [{
        id: 'binding-icon-name',
        requirement: 'optional',
        source: {
          kind: 'nested-property',
          locator: { componentKey: 'icon-main-key', fragile: false, namePath: ['Leading icon'] },
          propertyName: 'name',
        },
        target: { path: ['renderLeftIcon'], typeName: 'ReactNode' },
      }],
      figmaSnapshot: snapshot,
      revision: 1,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };
  }

  it('turns an exposed icon name into the package Icon component', () => {
    const result = resolveSemanticUsage(
      'Button',
      '@tashilcar/swiss-army-knife',
      recipeWithIconName(),
      {
        componentProperties: {},
        root: buttonWithExposedIconName(),
      },
    );

    expect(result.usage.jsx).toContain('renderLeftIcon={<Icon name={"trash"} />}');
    expect(result.issues).toEqual([]);
    expect(result.usage.imports).toEqual([
      {
        importedName: 'Button',
        localName: 'Button',
        modulePath: '@tashilcar/swiss-army-knife',
      },
      {
        importedName: 'Icon',
        localName: 'Icon',
        modulePath: '@tashilcar/swiss-army-knife',
      },
    ]);
  });

  it('keeps a non-icon ReactNode nested property as a literal', () => {
    const recipe = recipeWithIconName();
    recipe.bindings[0]!.target = { path: ['children'], typeName: 'ReactNode' };

    const result = resolveSemanticUsage(
      'Button',
      '@tashilcar/swiss-army-knife',
      recipe,
      {
        componentProperties: {},
        root: buttonWithExposedIconName(),
      },
    );

    expect(result.usage.jsx).toContain([
      '<Button>',
      '  trash',
      '</Button>',
    ].join('\n'));
    expect(result.usage.imports).toHaveLength(1);
  });
});
