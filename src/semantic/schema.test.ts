import { describe, expect, it } from 'vitest';
import { validateSemanticRecipe } from './schema';
import {
  SEMANTIC_LIMITS,
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  type SemanticConnectionRecipe,
} from './types';

function createRecipe(): SemanticConnectionRecipe {
  return {
    bindings: [
      {
        id: 'binding-title',
        requirement: 'required',
        source: {
          kind: 'nested-text',
          locator: { fragile: true, namePath: ['Header', 'Title'] },
        },
        target: { path: ['title'], typeName: 'string' },
      },
    ],
    figmaSnapshot: { componentId: '1:1', componentName: 'Dialog', nestedSources: [] },
    revision: 1,
    schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
  };
}

function asUnknown(recipe: SemanticConnectionRecipe): Record<string, unknown> {
  return JSON.parse(JSON.stringify(recipe)) as Record<string, unknown>;
}

describe('validateSemanticRecipe', () => {
  it('accepts a valid recipe after a JSON round trip', () => {
    expect(validateSemanticRecipe(asUnknown(createRecipe()))).toMatchObject({ ok: true });
  });

  it('migrates a v1 recipe in memory without changing its bindings', () => {
    const value = asUnknown(createRecipe());
    value.schemaVersion = 1;
    const bindingsBefore = JSON.stringify(value.bindings);

    const result = validateSemanticRecipe(value);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.recipe.schemaVersion).toBe(SEMANTIC_RECIPE_SCHEMA_VERSION);
      expect(JSON.stringify(result.recipe.bindings)).toBe(bindingsBefore);
    }
    // Reading never mutates/persists the legacy document.
    expect(value.schemaVersion).toBe(1);
  });

  it('accepts every explicit complex source target kind', () => {
    const value = asUnknown(createRecipe());
    value.sourceContract = {
      componentName: 'DataView',
      contentHash: 'complex-contract',
      fileName: 'data-view.tsx',
      targets: [
        'array',
        'record',
        'date',
        'file',
        'render',
        'styling',
        'controlled',
        'environment',
      ].map(
        (kind, index) => ({
          kind,
          ...(kind === 'array'
            ? {
                itemSchemas: [
                  { kind: 'record', role: 'item', typeName: 'Item' },
                ],
              }
            : {}),
          ...(kind === 'controlled' ? { controlledBy: ['onChange'] } : {}),
          ownerProp: `value${index}`,
          path: [`value${index}`],
          required: true,
          typeName: `ComplexType${index}`,
        }),
      ),
    };

    expect(validateSemanticRecipe(value)).toMatchObject({ ok: true });
  });

  it('rejects newer schema versions with an update message', () => {
    const value = asUnknown(createRecipe());
    value.schemaVersion = SEMANTIC_RECIPE_SCHEMA_VERSION + 1;

    const result = validateSemanticRecipe(value);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('newer than this plugin supports');
    }
  });

  it('rejects malformed target path segments', () => {
    for (const segment of ['', 'not valid', '1leading', 'a.b', '__proto__', 'constructor']) {
      const value = asUnknown(createRecipe());
      (value.bindings as Array<{ target: { path: string[] } }>)[0].target.path = [segment];

      expect(validateSemanticRecipe(value).ok).toBe(false);
    }
  });

  it('rejects target paths deeper than the supported nesting level', () => {
    const value = asUnknown(createRecipe());
    (value.bindings as Array<{ target: { path: string[] } }>)[0].target.path = Array.from(
      { length: SEMANTIC_LIMITS.maxTargetPathDepth + 1 },
      (_, index) => `level${index}`,
    );

    expect(validateSemanticRecipe(value).ok).toBe(false);
  });

  it('rejects unknown source and transform kinds so code can never be smuggled in', () => {
    const withBadSource = asUnknown(createRecipe());
    (withBadSource.bindings as Array<{ source: unknown }>)[0].source = {
      code: 'return eval("1")',
      kind: 'javascript',
    };
    expect(validateSemanticRecipe(withBadSource).ok).toBe(false);

    const withBadTransform = asUnknown(createRecipe());
    (withBadTransform.bindings as Array<{ transform?: unknown }>)[0].transform = {
      body: 'x => x',
      kind: 'function',
    };
    expect(validateSemanticRecipe(withBadTransform).ok).toBe(false);
  });

  it('rejects duplicate binding ids', () => {
    const recipe = createRecipe();
    recipe.bindings.push({ ...recipe.bindings[0] });

    expect(validateSemanticRecipe(asUnknown(recipe)).ok).toBe(false);
  });

  it('rejects recipes over the binding limit', () => {
    const recipe = createRecipe();
    for (let index = 0; index <= SEMANTIC_LIMITS.maxBindings; index += 1) {
      recipe.bindings.push({
        ...recipe.bindings[0],
        id: `binding-${index}`,
      });
    }

    const result = validateSemanticRecipe(asUnknown(recipe));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('limit');
    }
  });

  it('rejects oversized serialized recipes', () => {
    const recipe = createRecipe();
    recipe.bindings[0].source = {
      kind: 'static',
      value: 'x'.repeat(SEMANTIC_LIMITS.maxSerializedLength),
    };

    expect(validateSemanticRecipe(asUnknown(recipe)).ok).toBe(false);
  });

  it('rejects non-integer revisions', () => {
    const value = asUnknown(createRecipe());
    value.revision = 0;

    expect(validateSemanticRecipe(value).ok).toBe(false);
  });

  it('accepts valid lifecycle metadata and rejects an unknown state', () => {
    const valid = asUnknown(createRecipe());
    valid.lifecycle = {
      owner: 'Design systems',
      packageName: '@tashilcar/ui',
      packageVersion: '2.1.0',
      replacement: 'Use AlertDialog.',
      state: 'deprecated',
    };
    expect(validateSemanticRecipe(valid)).toMatchObject({ ok: true });

    const invalid = asUnknown(createRecipe());
    invalid.lifecycle = { state: 'archived' };
    expect(validateSemanticRecipe(invalid).ok).toBe(false);
  });
});
