import { describe, expect, it } from 'vitest';
import { compileMappingDocument, isMappingDocument } from './mapping-document';
import type { MappingDocument } from './types';

const document: MappingDocument = {
  revision: 1,
  figmaSnapshot: {
    componentId: 'button-set',
    componentName: 'Button',
    properties: [
      {
        id: 'style-id',
        name: 'Style',
        options: ['Solid', 'Outline'],
        rawKey: 'Style#style-id',
        type: 'VARIANT',
      },
      {
        defaultValue: false,
        id: 'disabled-id',
        name: 'Disabled',
        options: ['False', 'True'],
        rawKey: 'Disabled#disabled-id',
        type: 'BOOLEAN',
      },
      {
        id: 'label-id',
        name: 'label',
        options: [],
        rawKey: 'label#label-id',
        type: 'TEXT',
      },
      {
        id: 'leading-icon-id',
        name: 'LeadingIcon',
        options: [],
        rawKey: 'LeadingIcon#leading-icon-id',
        type: 'INSTANCE_SWAP',
      },
    ],
  },
  mappings: [
    {
      figmaPropertyId: 'style-id',
      figmaPropertyName: 'Style',
      sourceProp: 'variant',
      values: [
        { figmaValue: 'Solid', sourceValue: 'solid' },
        { figmaValue: 'Outline', sourceValue: 'outline' },
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
      figmaPropertyId: 'leading-icon-id',
      figmaPropertyName: 'LeadingIcon',
      kind: 'instance-swap',
      sourceProp: 'renderRightIcon',
      values: [],
    },
  ],
};

describe('mapping document', () => {
  it('compiles visual mappings into the existing prop-mapping format', () => {
    expect(compileMappingDocument(document)).toEqual({
      Disabled: {
        False: { prop: 'disabled', value: false },
        True: { prop: 'disabled', value: true },
      },
      Style: {
        Outline: { prop: 'variant', value: 'outline' },
        Solid: { prop: 'variant', value: 'solid' },
      },
      LeadingIcon: {
        '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
      },
    });
  });

  it('preserves advanced mappings that standard rows do not own', () => {
    expect(compileMappingDocument(document, {
      leadingIcon: {
        '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
      },
      Style: {
        Ghost: { prop: 'variant', value: 'ghost' },
      },
    })).toEqual(expect.objectContaining({
      leadingIcon: {
        '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
      },
      Style: {
        Ghost: { prop: 'variant', value: 'ghost' },
        Outline: { prop: 'variant', value: 'outline' },
        Solid: { prop: 'variant', value: 'solid' },
      },
    }));
  });

  it('validates complete mapping documents and rejects invalid revisions', () => {
    expect(isMappingDocument(document)).toBe(true);
    expect(isMappingDocument({ ...document, revision: 0 })).toBe(false);
  });
});
