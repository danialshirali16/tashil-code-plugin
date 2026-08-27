import { describe, expect, it } from 'vitest';
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
});
