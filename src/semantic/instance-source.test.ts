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
        // Internals must never be harvested from a connected child.
        children: [{ characters: 'ignore me', name: 'Glyph', type: 'TEXT' }],
      },
      { characters: 'Delete', name: 'Label', type: 'TEXT' },
    ],
    name: 'Button',
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

    expect(result.usage.jsx).toContain('renderLeftIcon={<TrashIcon />}');
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
});
