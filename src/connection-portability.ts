import { migratePersistedConnectionMetadata, validatePersistedConnectionMetadata } from './codegen';
import type { ConnectionMetadata } from './types';

export const CONNECTION_EXPORT_SCHEMA_VERSION = 1;
export const MAX_CONNECTION_IMPORT_BYTES = 2_000_000;
export const MAX_CONNECTION_IMPORT_ENTRIES = 2_000;

export type ConnectionLocator = {
  componentKey: string;
  figmaComponentName: string;
  nodeType: 'COMPONENT' | 'COMPONENT_SET';
  pageName: string;
};
export type ConnectionExportEntry = { connection: ConnectionMetadata; locator: ConnectionLocator };
export type ConnectionExportDocument = {
  connections: ConnectionExportEntry[];
  schemaVersion: typeof CONNECTION_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  pluginVersion: string;
};

export function serializeConnectionExport(entries: readonly ConnectionExportEntry[], pluginVersion: string, exportedAt: string): string {
  return JSON.stringify({
    connections: [...entries].sort((a, b) => a.locator.componentKey.localeCompare(b.locator.componentKey)),
    schemaVersion: CONNECTION_EXPORT_SCHEMA_VERSION,
    exportedAt,
    pluginVersion,
  } satisfies ConnectionExportDocument, null, 2);
}

export function parseConnectionExport(raw: string): { document: ConnectionExportDocument; ok: true } | { message: string; ok: false } {
  if (utf8ByteLength(raw) > MAX_CONNECTION_IMPORT_BYTES) return { message: 'The import is larger than the 2 MB safety limit.', ok: false };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { message: 'The selected file is not valid JSON.', ok: false }; }
  if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.connections)) return { message: 'This is not a supported Tashil connection export.', ok: false };
  if (value.connections.length > MAX_CONNECTION_IMPORT_ENTRIES) return { message: 'The import contains more than 2,000 connections.', ok: false };
  const connections: ConnectionExportEntry[] = [];
  const seenKeys = new Set<string>();
  for (const entry of value.connections) {
    if (!isRecord(entry) || !isLocator(entry.locator)) return { message: 'An import entry has an invalid component locator.', ok: false };
    if (seenKeys.has(entry.locator.componentKey)) return { message: `The import contains duplicate component key ${entry.locator.componentKey}.`, ok: false };
    const validation = validatePersistedConnectionMetadata(entry.connection);
    if (!validation.ok) return { message: validation.issue.message, ok: false };
    seenKeys.add(entry.locator.componentKey);
    connections.push({ connection: migratePersistedConnectionMetadata(validation.metadata), locator: entry.locator });
  }
  return { document: {
    connections,
    schemaVersion: 1,
    exportedAt: typeof value.exportedAt === 'string' ? value.exportedAt : '',
    pluginVersion: typeof value.pluginVersion === 'string' ? value.pluginVersion : '',
  }, ok: true };
}

function isLocator(value: unknown): value is ConnectionLocator {
  return isRecord(value) && typeof value.componentKey === 'string' && value.componentKey.length > 0
    && typeof value.figmaComponentName === 'string' && (value.nodeType === 'COMPONENT' || value.nodeType === 'COMPONENT_SET')
    && typeof value.pageName === 'string';
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit <= 0x7f) bytes += 1;
    else if (unit <= 0x7ff) bytes += 2;
    else if (
      unit >= 0xd800 && unit <= 0xdbff
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff
    ) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}
