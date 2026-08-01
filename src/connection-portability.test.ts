import { describe, expect, it } from 'vitest';
import {
  parseConnectionExport,
  serializeConnectionExport,
  type ConnectionExportEntry,
} from './connection-portability';
import { CURRENT_SCHEMA_VERSION } from './types';

describe('connection portability', () => {
  const entry: ConnectionExportEntry = {
    connection: {
      componentName: 'Button',
      importPath: '@acme/ui',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
    locator: {
      componentKey: 'button-key',
      figmaComponentName: 'Button',
      nodeType: 'COMPONENT' as const,
      pageName: 'Components',
    },
  };

  it('serializes a deterministic versioned export and round-trips it', () => {
    const json = serializeConnectionExport([entry], '1.0.0', '2026-08-01T00:00:00.000Z');
    expect(json).toMatchSnapshot();
    expect(parseConnectionExport(json)).toEqual({
      document: {
        connections: [entry],
        schemaVersion: 1,
        exportedAt: '2026-08-01T00:00:00.000Z',
        pluginVersion: '1.0.0',
      },
      ok: true,
    });
  });

  it('rejects duplicate keys and malformed connection metadata', () => {
    const duplicate = serializeConnectionExport([entry, entry], '1.0.0', '');
    expect(parseConnectionExport(duplicate)).toEqual(expect.objectContaining({ ok: false }));
    expect(parseConnectionExport(JSON.stringify({
      connections: [{ ...entry, connection: { componentName: 'Button' } }],
      schemaVersion: 1,
    }))).toEqual(expect.objectContaining({ ok: false }));
  });
});
