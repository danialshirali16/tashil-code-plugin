import { describe, expect, it } from 'vitest';
import { emitComponentDocMarkdown, emitTokenDocMarkdown } from './markdown-emitter';
import { buildTokenDocDocument } from './token-doc-model';
import { buildComponentDocDocument } from './component-doc-model';

describe('markdown-emitter', () => {
  it('emits structured markdown for tokens doc', () => {
    const doc = buildTokenDocDocument({
      collectionId: 'col-1',
      collectionName: 'Colors',
      modes: [{ modeId: 'm1', name: 'Light' }],
      tokens: [
        {
          id: 't1',
          name: 'color/text/default',
          valuesByMode: { m1: { isColor: true, value: { r: 0, g: 0, b: 0 } } },
        },
      ],
    });

    const markdown = emitTokenDocMarkdown(doc);
    expect(markdown).toContain('# Colors');
    expect(markdown).toContain('| Token | Light |');
    expect(markdown).toContain('`color/text/default`');
  });

  it('emits structured markdown for component doc', () => {
    const doc = buildComponentDocDocument(
      {
        componentName: 'Badge',
        importPath: '@tashilcar/swiss-army-knife',
        schemaVersion: 5,
      },
      {
        componentName: 'Badge',
        contentHash: 'hash-1',
        fileName: 'Badge.tsx',
        props: [
          { name: 'count', required: true, role: 'standard', typeName: 'number' },
        ],
      },
    );

    const markdown = emitComponentDocMarkdown(doc);
    expect(markdown).toContain('# <Badge />');
    expect(markdown).toContain('`count`');
    expect(markdown).toContain('`number`');
  });
});
