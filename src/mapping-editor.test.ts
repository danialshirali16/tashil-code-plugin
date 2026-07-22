import { describe, expect, it } from 'vitest';
import {
  createMappingDocumentDraft,
  extractAdvancedPropMappings,
  setMappedFigmaProperty,
  setMappedFigmaValue,
} from './mapping-editor';
import { compileMappingDocument } from './mapping-document';
import type { FigmaComponentSnapshot, SourceComponentSnapshot } from './types';

const sourceSnapshot: SourceComponentSnapshot = {
  componentName: 'Button',
  contentHash: 'source-hash',
  fileName: 'types.ts',
  props: [
    { name: 'variant', required: false, role: 'standard', typeName: 'ButtonVariant', values: ['primary', 'success', 'error'] },
    { name: 'disabled', required: false, role: 'standard', typeName: 'boolean', values: [false, true] },
    { name: 'children', required: false, role: 'children', typeName: 'ReactNode' },
    { name: 'renderRightIcon', required: false, role: 'advanced', typeName: 'ReactNode' },
    { name: 'renderLeftIcon', required: false, role: 'advanced', typeName: 'ReactNode' },
  ],
};

const figmaSnapshot: FigmaComponentSnapshot = {
  componentId: '1:2',
  componentName: 'Button',
  properties: [
    { id: 'style-id', name: 'Style', options: ['Primary', 'Positive', 'Negative'], rawKey: 'Style#style-id', type: 'VARIANT' },
    { id: 'disabled-id', name: 'Disabled', options: ['False', 'True'], rawKey: 'Disabled#disabled-id', type: 'BOOLEAN' },
    { id: 'label-id', name: 'label', options: [], rawKey: 'label#label-id', type: 'TEXT' },
    { id: 'leading-id', name: 'LeadingIcon', options: [], rawKey: 'LeadingIcon#leading-id', type: 'INSTANCE_SWAP' },
    { id: 'trailing-id', name: 'TrailingIcon', options: [], rawKey: 'TrailingIcon#trailing-id', type: 'INSTANCE_SWAP' },
    { id: 'has-leading-id', name: 'HasLeadingIcon', options: ['False', 'True'], rawKey: 'HasLeadingIcon#has-leading-id', type: 'BOOLEAN' },
    { id: 'has-trailing-id', name: 'HasTrailingIcon', options: ['False', 'True'], rawKey: 'HasTrailingIcon#has-trailing-id', type: 'BOOLEAN' },
  ],
};

describe('mapping editor', () => {
  it('suggests compatible properties and aliases', () => {
    const document = createMappingDocumentDraft(sourceSnapshot, figmaSnapshot);

    expect(document.mappings).toEqual([
      {
        figmaPropertyId: 'style-id',
        figmaPropertyName: 'Style',
        sourceProp: 'variant',
        values: [
          { figmaValue: 'Primary', sourceValue: 'primary' },
          { figmaValue: 'Positive', sourceValue: 'success' },
          { figmaValue: 'Negative', sourceValue: 'error' },
        ],
      },
      {
        figmaPropertyId: 'disabled-id',
        figmaPropertyName: 'Disabled',
        sourceProp: 'disabled',
        values: [
          { figmaValue: 'False', sourceValue: false },
          { figmaValue: 'True', sourceValue: true },
        ],
      },
      {
        figmaPropertyId: 'label-id',
        figmaPropertyName: 'label',
        kind: 'children',
        sourceProp: 'children',
        values: [],
      },
      {
        figmaPropertyId: 'leading-id',
        figmaPropertyName: 'LeadingIcon',
        kind: 'instance-swap',
        sourceProp: 'renderRightIcon',
        values: [],
      },
      {
        figmaPropertyId: 'trailing-id',
        figmaPropertyName: 'TrailingIcon',
        kind: 'instance-swap',
        sourceProp: 'renderLeftIcon',
        values: [],
      },
    ]);
  });

  it('updates property and value mappings without mutating the document', () => {
    const original = createMappingDocumentDraft(sourceSnapshot, figmaSnapshot);
    const unmapped = setMappedFigmaProperty(original, 'variant', '');
    const remapped = setMappedFigmaProperty(unmapped, 'variant', 'style-id');
    const updated = setMappedFigmaValue(remapped, 'variant', 'success', 'Negative');

    expect(original.mappings).toHaveLength(5);
    expect(unmapped.mappings.map((mapping) => mapping.sourceProp)).toEqual([
      'disabled',
      'children',
      'renderRightIcon',
      'renderLeftIcon',
    ]);
    expect(updated.mappings.find((mapping) => mapping.sourceProp === 'variant')?.values)
      .toContainEqual({ figmaValue: 'Negative', sourceValue: 'success' });
  });

  it('preserves instance-swap and raw advanced mappings', () => {
    expect(extractAdvancedPropMappings({
      icon: { '*': { prop: 'icon', value: '$instanceSwap' } },
      label: { '*': { prop: 'children', value: '$raw' } },
      style: { Primary: { prop: 'variant', value: 'primary' } },
    })).toEqual({
      icon: { '*': { prop: 'icon', value: '$instanceSwap' } },
      label: { '*': { prop: 'children', value: '$raw' } },
    });
  });

  it('removes instance swaps owned by the previous visual document before recompiling', () => {
    const visualDocument = createMappingDocumentDraft(sourceSnapshot, figmaSnapshot);
    const existingMappings = {
      LeadingIcon: { '*': { prop: 'renderRightIcon', value: '$instanceSwap' } },
      customSlot: { '*': { prop: 'customSlot', value: '$instanceSwap' } },
    };
    expect(extractAdvancedPropMappings(existingMappings, visualDocument)).toEqual({
      customSlot: { '*': { prop: 'customSlot', value: '$instanceSwap' } },
    });

    const withoutLeading = setMappedFigmaProperty(visualDocument, 'renderRightIcon', '');
    expect(compileMappingDocument(
      withoutLeading,
      extractAdvancedPropMappings(existingMappings, visualDocument),
    )).not.toHaveProperty('LeadingIcon');
  });
});
