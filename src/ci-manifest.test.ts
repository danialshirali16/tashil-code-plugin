import { describe, expect, it } from 'vitest';
import { reviewConnectionManifest } from './ci-manifest';
import { serializeConnectionExport, type ConnectionExportEntry } from './connection-portability';
import { parseSourceComponent } from './source-schema';
import type { ConnectionMetadata } from './types';

const source = '/** A button. */\nexport interface ButtonProps { /** Disables it. */ disabled?: boolean }';

function manifest(sourcePath = 'src/Button.tsx'): string {
  const parsed = parseSourceComponent([{ contents: source, fileName: 'Button.tsx' }], 'Button');
  if (!parsed.ok) throw new Error(parsed.message);
  const connection: ConnectionMetadata = { schemaVersion: 5, componentName: 'Button', importPath: '@app/button', sourcePath, mappingDocument: { figmaSnapshot: { componentId: '1:1', componentName: 'Button', properties: [] }, mappings: [], revision: 1, sourceSnapshot: parsed.snapshot } };
  const entry: ConnectionExportEntry = { connection, locator: { componentKey: 'key', figmaComponentName: 'Button', nodeType: 'COMPONENT', pageName: 'Components' } };
  return serializeConnectionExport([entry], '1.0.0', '2026-08-01T00:00:00.000Z');
}

describe('connection manifest reviewer', () => {
  it('reports clean and drifted source contracts', async () => {
    const clean = await reviewConnectionManifest(manifest(), async () => [{ contents: source, fileName: 'Button.tsx' }]);
    expect(clean.ok).toBe(true);
    expect(clean.entries[0].status).toBe('clean');
    const drifted = await reviewConnectionManifest(manifest(), async () => [{ contents: 'export interface ButtonProps { size?: "sm" | "lg" }', fileName: 'Button.tsx' }]);
    expect(drifted.ok).toBe(false);
    expect(drifted.entries[0].status).toBe('drifted');
  });

  it('rejects paths outside the source root before loading files', async () => {
    let called = false;
    const report = await reviewConnectionManifest(manifest('../secret.ts'), async () => { called = true; return []; });
    expect(report.entries[0].status).toBe('invalid-path');
    expect(called).toBe(false);
  });

  it('reports a missing source file', async () => {
    const report = await reviewConnectionManifest(manifest(), async () => undefined);
    expect(report.ok).toBe(false);
    expect(report.entries[0].status).toBe('missing-source');
  });
});
