import { describe, expect, it } from 'vitest';
import { compileMappingDocument } from '../mapping-document';
import type { MappingDocument } from '../types';
import { compileRecipeToPropMappings, migrateMappingDocumentToRecipe } from './migrate';
import { validateSemanticRecipe } from './schema';

function createButtonDocument(): MappingDocument {
  return {
    figmaSnapshot: {
      componentId: '10:1',
      componentName: 'Button',
      properties: [
        {
          defaultValue: 'Medium',
          id: 'prop-size',
          name: 'Size',
          options: ['Small', 'Medium', 'Large'],
          rawKey: 'Size',
          type: 'VARIANT',
        },
        {
          defaultValue: false,
          id: 'prop-disabled',
          name: 'Disabled',
          options: [],
          rawKey: 'Disabled',
          type: 'BOOLEAN',
        },
      ],
    },
    mappings: [
      {
        figmaPropertyId: 'prop-size',
        figmaPropertyName: 'Size',
        kind: 'property',
        sourceProp: 'size',
        values: [
          { figmaValue: 'Small', sourceValue: 'sm' },
          { figmaValue: 'Medium', sourceValue: 'md' },
          { figmaValue: 'Large', sourceValue: 'lg' },
        ],
      },
      {
        figmaPropertyId: 'prop-disabled',
        figmaPropertyName: 'Disabled',
        kind: 'property',
        sourceProp: 'disabled',
        values: [{ figmaValue: 'true', sourceValue: true }],
      },
    ],
    revision: 3,
    sourceSnapshot: {
      componentName: 'Button',
      contentHash: 'fnv1a-00000001',
      fileName: 'button.tsx',
      props: [
        {
          name: 'size',
          required: false,
          role: 'standard',
          typeName: "'sm' | 'md' | 'lg'",
          values: ['sm', 'md', 'lg'],
        },
        {
          name: 'disabled',
          required: false,
          role: 'standard',
          typeName: 'boolean',
          values: [false, true],
        },
      ],
    },
  };
}

describe('migrateMappingDocumentToRecipe', () => {
  it('lifts schema-v4 property mappings into valid semantic bindings', () => {
    const { recipe, skipped } = migrateMappingDocumentToRecipe(createButtonDocument());

    expect(skipped).toEqual([]);
    expect(validateSemanticRecipe(recipe)).toMatchObject({ ok: true });
    expect(recipe.bindings.map((binding) => binding.target.path)).toEqual([
      ['size'],
      ['disabled'],
    ]);
    expect(recipe.bindings[0]).toMatchObject({
      source: { kind: 'component-property', propertyId: 'prop-size', propertyName: 'Size' },
      target: { typeName: "'sm' | 'md' | 'lg'" },
      transform: {
        kind: 'enum',
        map: { Large: 'lg', Medium: 'md', Small: 'sm' },
      },
    });
  });

  it('keeps binding ids stable across display-name changes', () => {
    const document = createButtonDocument();
    const { recipe: first } = migrateMappingDocumentToRecipe(document);

    document.mappings[0].figmaPropertyName = 'Button size';
    const { recipe: second } = migrateMappingDocumentToRecipe(document);

    expect(second.bindings[0].id).toBe(first.bindings[0].id);
  });

  it('reports non-property mappings as skipped instead of dropping them silently', () => {
    const document = createButtonDocument();
    document.mappings.push({
      figmaPropertyId: 'prop-icon',
      figmaPropertyName: 'Icon',
      kind: 'instance-swap',
      sourceProp: 'renderLeftIcon',
      values: [],
    });

    const { skipped } = migrateMappingDocumentToRecipe(document);

    expect(skipped).toEqual([
      {
        figmaPropertyName: 'Icon',
        reason: 'Legacy instance-swap mappings stay on the compatibility pipeline.',
      },
    ]);
  });
});

describe('compileRecipeToPropMappings', () => {
  it('round-trips a migrated document to identical legacy propMappings', () => {
    const document = createButtonDocument();
    const { recipe } = migrateMappingDocumentToRecipe(document);
    const { propMappings, uncompiled } = compileRecipeToPropMappings(recipe);

    expect(uncompiled).toEqual([]);
    expect(propMappings).toEqual(compileMappingDocument(document));
  });

  it('routes nested and non-property bindings through the usage IR instead', () => {
    const { recipe } = migrateMappingDocumentToRecipe(createButtonDocument());
    recipe.bindings.push({
      id: 'binding-confirm-label',
      requirement: 'required',
      source: {
        kind: 'nested-property',
        locator: { componentKey: 'k', fragile: false, namePath: ['Footer', 'Primary'] },
        propertyName: 'label',
      },
      target: { path: ['confirmAction', 'label'], typeName: 'string' },
    });

    const { uncompiled } = compileRecipeToPropMappings(recipe);

    expect(uncompiled.map((binding) => binding.id)).toEqual(['binding-confirm-label']);
  });
});
