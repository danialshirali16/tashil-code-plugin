import { describe, expect, it } from 'vitest';
import * as componentDocModel from './component-doc-model';
import { buildComponentDocDocument } from './component-doc-model';
import type { ConnectionMetadata, SourceComponentSnapshot } from '../types';

describe('component-doc-model', () => {
  const metadata: ConnectionMetadata = {
    componentName: 'Button',
    importPath: '@tashilcar/swiss-army-knife',
    schemaVersion: 5,
  };

  const sourceSnapshot: SourceComponentSnapshot = {
    componentName: 'Button',
    contentHash: 'hash-btn-1',
    fileName: 'Button.tsx',
    props: [
      { name: 'children', required: true, role: 'children', typeName: 'ReactNode' },
      { name: 'variant', required: false, role: 'standard', typeName: "'primary' | 'secondary'", values: ['primary', 'secondary'], defaultValue: 'primary' },
      { name: 'disabled', required: false, role: 'standard', typeName: 'boolean', defaultValue: false },
    ],
  };

  it('builds component doc document from connection metadata and source contract', () => {
    const doc = buildComponentDocDocument(metadata, sourceSnapshot);

    expect(doc.componentName).toBe('Button');
    expect(doc.importPath).toBe('@tashilcar/swiss-army-knife');
    expect(doc.props).toHaveLength(3);

    const childrenProp = doc.props.find((p) => p.name === 'children');
    expect(childrenProp?.required).toBe(true);

    const variantProp = doc.props.find((p) => p.name === 'variant');
    expect(variantProp?.defaultValue).toBe('primary');
    expect(variantProp?.values).toEqual(['primary', 'secondary']);
  });

  it('generates a 2D variant matrix when Figma component variants are present', () => {
    const figmaSnapshot = {
      componentId: '100:200',
      componentName: 'Button',
      description: 'A button component',
      properties: [
        { defaultValue: 'primary', id: 'prop-1', name: 'Intent', options: ['primary', 'neutral', 'positive'], rawKey: 'Intent#1:1', type: 'VARIANT' as const },
        { defaultValue: 'tonal', id: 'prop-2', name: 'Style', options: ['tonal', 'outline', 'ghost'], rawKey: 'Style#1:2', type: 'VARIANT' as const },
        { defaultValue: 'md', id: 'prop-3', name: 'Size', options: ['sm', 'md', 'lg'], rawKey: 'Size#1:3', type: 'VARIANT' as const },
      ],
    };

    const doc = buildComponentDocDocument(metadata, sourceSnapshot, figmaSnapshot);
    expect(doc.matrix).toBeDefined();
    expect(doc.matrix?.primaryYAxis.propertyName).toBe('Intent');
    expect(doc.matrix?.primaryYAxis.values).toEqual(['primary', 'neutral', 'positive']);
    expect(doc.matrix?.primaryXAxis.propertyName).toContain('Style');
    expect(doc.matrix?.rows).toHaveLength(3);
    expect(doc.matrix?.rows[0].cells).toHaveLength(9); // 3 Style * 3 Size = 9 cells per row
    expect(doc.matrix?.rows[0].cells[0].combination).toHaveProperty('Intent', 'primary');
    expect(doc.matrix?.rows[0].cells[0].combination).toHaveProperty('Style', 'tonal');

    // Verify layered X-tiers and Y-tiers
    expect(doc.matrix?.xTiers).toBeDefined();
    expect(doc.matrix?.xTiers).toHaveLength(2); // Style (Tier 0) + Size (Tier 1)
    expect(doc.matrix?.xTiers?.[0].propertyName).toBe('Style');
    expect(doc.matrix?.xTiers?.[0].groups).toHaveLength(3);
    expect(doc.matrix?.xTiers?.[0].groups[0].span).toBe(3); // 3 sizes per style

    expect(doc.matrix?.yTiers).toBeDefined();
    expect(doc.matrix?.yTiers).toHaveLength(1); // Intent (Tier 0)
    expect(doc.matrix?.yTiers?.[0].groups).toHaveLength(3);
  });

  it('counts variant combinations without constructing the Cartesian matrix', () => {
    const summarize = (componentDocModel as unknown as {
      summarizeComponentVariants?: (
        properties: Array<{ options: string[]; type: string }>,
      ) => { combinationCount: number; propertyCount: number };
    }).summarizeComponentVariants;

    expect(summarize).toBeTypeOf('function');
    if (!summarize) return;

    expect(summarize([
      { options: ['primary', 'neutral', 'positive'], type: 'VARIANT' },
      { options: ['tonal', 'outline', 'ghost'], type: 'VARIANT' },
      { options: ['sm', 'md', 'lg'], type: 'VARIANT' },
      { options: ['true', 'false'], type: 'BOOLEAN' },
    ])).toEqual({
      combinationCount: 27,
      propertyCount: 3,
    });
  });
});
