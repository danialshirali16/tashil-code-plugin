import { parseConnectionExport } from './connection-portability';
import { parseSourceComponent, type SourceFileInput } from './source-schema';
import type { SourceComponentSnapshot } from './types';

export type ConnectionManifestReview = {
  componentName: string;
  message: string;
  sourcePath?: string;
  status: 'clean' | 'drifted' | 'invalid-path' | 'missing-snapshot' | 'missing-source';
};

export type ConnectionManifestReport = { entries: ConnectionManifestReview[]; ok: boolean };

export async function reviewConnectionManifest(
  rawExport: string,
  loadSourceFiles: (relativePath: string) => Promise<readonly SourceFileInput[] | undefined>,
): Promise<ConnectionManifestReport> {
  const parsed = parseConnectionExport(rawExport);
  if (!parsed.ok) {
    return { entries: [{ componentName: 'Manifest', message: parsed.message, status: 'missing-source' }], ok: false };
  }
  const entries: ConnectionManifestReview[] = [];
  for (const { connection } of parsed.document.connections) {
    const sourcePath = connection.sourcePath?.trim();
    const snapshot = connection.mappingDocument?.sourceSnapshot;
    if (!snapshot) {
      entries.push({ componentName: connection.componentName, message: 'No saved source snapshot is available.', sourcePath, status: 'missing-snapshot' });
      continue;
    }
    if (!sourcePath) {
      entries.push({ componentName: connection.componentName, message: 'No source path is saved.', status: 'missing-source' });
      continue;
    }
    if (!isSafeRelativeSourcePath(sourcePath)) {
      entries.push({ componentName: connection.componentName, message: 'The saved source path escapes the configured source root.', sourcePath, status: 'invalid-path' });
      continue;
    }
    const files = await loadSourceFiles(sourcePath);
    if (!files || files.length === 0) {
      entries.push({ componentName: connection.componentName, message: 'Source files could not be read.', sourcePath, status: 'missing-source' });
      continue;
    }
    const current = parseSourceComponent(files, connection.componentName);
    if (!current.ok) {
      entries.push({ componentName: connection.componentName, message: current.message, sourcePath, status: 'drifted' });
      continue;
    }
    const clean = sourceContractsMatch(snapshot, current.snapshot);
    entries.push({ componentName: connection.componentName, message: clean ? 'Saved source contract matches.' : 'Source props or documentation changed.', sourcePath, status: clean ? 'clean' : 'drifted' });
  }
  return { entries, ok: entries.every(({ status }) => status === 'clean') };
}

export function isSafeRelativeSourcePath(value: string): boolean {
  const normalized = value.replace(/\\/g, '/');
  return normalized !== '' && !normalized.startsWith('/') && !/^[A-Za-z]:\//.test(normalized)
    && !normalized.split('/').some((part) => part === '..');
}

function sourceContractsMatch(saved: SourceComponentSnapshot, current: SourceComponentSnapshot): boolean {
  const comparable = (snapshot: SourceComponentSnapshot) => ({ componentName: snapshot.componentName, description: snapshot.description ?? '', propsTypeName: snapshot.propsTypeName ?? '', props: snapshot.props });
  return JSON.stringify(comparable(saved)) === JSON.stringify(comparable(current));
}
