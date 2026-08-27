import { describe, expect, it } from 'vitest';
import { diffTokenDocument, diffTokenDocuments } from './doc-diff';
import { buildTokenDocDocument, type RawCollectionData } from './token-doc-model';
import type { DocFrameMetadata } from './types';

describe('doc-diff', () => {
  const baseCollection: RawCollectionData = {
    collectionId: 'col-1',
    collectionName: 'Colors',
    modes: [
      { modeId: 'm1', name: 'Light' },
      { modeId: 'm2', name: 'Dark' },
    ],
    tokens: [
      {
        id: 'tok-1',
        name: 'color/text/default',
        valuesByMode: {
          m1: { isColor: true, value: { r: 0, g: 0, b: 0 } },
          m2: { isColor: true, value: { r: 1, g: 1, b: 1 } },
        },
      },
    ],
  };

  it('detects no drift when metadata matches current state', () => {
    const doc = buildTokenDocDocument(baseCollection);
    const metadata: DocFrameMetadata = {
      contentHash: doc.contentHash,
      docType: 'tokens',
      generatedAt: '2026-08-01T00:00:00Z',
      modeIds: ['m1', 'm2'],
      schemaVersion: 1,
      targetId: 'col-1',
      targetName: 'Colors',
    };

    const report = diffTokenDocument(metadata, doc);
    expect(report.hasDrift).toBe(false);
    expect(report.changes).toHaveLength(0);
  });

  it('detects added modes in collection', () => {
    const updatedCollection: RawCollectionData = {
      ...baseCollection,
      modes: [
        { modeId: 'm1', name: 'Light' },
        { modeId: 'm2', name: 'Dark' },
        { modeId: 'm3', name: 'High Contrast' },
      ],
    };
    const doc = buildTokenDocDocument(updatedCollection);
    const metadata: DocFrameMetadata = {
      contentHash: 'some-old-hash',
      docType: 'tokens',
      generatedAt: '2026-08-01T00:00:00Z',
      modeIds: ['m1', 'm2'],
      schemaVersion: 1,
      targetId: 'col-1',
      targetName: 'Colors',
    };

    const report = diffTokenDocument(metadata, doc);
    expect(report.hasDrift).toBe(true);
    expect(report.changes.some((c) => c.kind === 'mode-added')).toBe(true);
  });

  it('detects added, removed, and modified tokens between two documents', () => {
    const doc1 = buildTokenDocDocument(baseCollection);

    const modifiedCollection: RawCollectionData = {
      ...baseCollection,
      tokens: [
        {
          id: 'tok-1',
          name: 'color/text/default',
          valuesByMode: {
            m1: { isColor: true, value: { r: 0.1, g: 0.1, b: 0.1 } }, // modified
            m2: { isColor: true, value: { r: 1, g: 1, b: 1 } },
          },
        },
        {
          id: 'tok-new',
          name: 'color/text/subtle', // added
          valuesByMode: {
            m1: { isColor: true, value: { r: 0.5, g: 0.5, b: 0.5 } },
          },
        },
      ],
    };
    const doc2 = buildTokenDocDocument(modifiedCollection);

    const report = diffTokenDocuments(doc1, doc2);
    expect(report.hasDrift).toBe(true);
    expect(report.changes.some((c) => c.kind === 'token-added' && c.targetName === 'color/text/subtle')).toBe(true);
    expect(report.changes.some((c) => c.kind === 'token-value-changed' && c.targetName === 'color/text/default')).toBe(true);
  });
});
