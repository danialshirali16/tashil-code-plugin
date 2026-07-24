/**
 * Format one connected-component usage as copyable snippet text — imports,
 * blank line, JSX — byte-identical to `createUsageSnippet`'s single-component
 * output so an entry copied from the inspection view matches selecting that
 * instance alone.
 */

import { renderImportLines } from '../layout/imports';
import type { ComponentUsage } from '../layout/types';
import type { ConnectedComponentEntry } from './types';

export function formatUsageSnippet(usage: ComponentUsage): string {
  return [renderImportLines(usage.imports), '', usage.jsx].join('\n');
}

export type ConnectedComponentsSnippetOptions = {
  /**
   * Emit a `//./ …` source comment above each usage, showing where the
   * instance lives inside the inspected selection. Defaults to true; the Dev
   * Mode "Layer path comments" preference turns it off.
   */
  pathComments?: boolean;
};

/**
 * Format a frame's connected components as one copyable TypeScript snippet for
 * Dev Mode: deduplicated imports, then each usage optionally preceded by its
 * source comment.
 *
 * When the same imported name arrives from two different modules, cross-entry
 * import dedup would require rewriting JSX to aliased names; instead the rare
 * conflict case falls back to per-entry snippets (each individually valid).
 */
export function formatConnectedComponentsSnippet(
  entries: readonly ConnectedComponentEntry[],
  options: ConnectedComponentsSnippetOptions = {},
): string {
  const pathComments = options.pathComments !== false;
  const allImports = entries.flatMap((entry) => entry.usage.imports);

  const ownerOfName = new Map<string, string>();
  const hasConflict = allImports.some((entry) => {
    const owner = ownerOfName.get(entry.importedName);
    if (owner !== undefined && owner !== entry.modulePath) {
      return true;
    }
    ownerOfName.set(entry.importedName, entry.modulePath);
    return false;
  });

  const section = (entry: ConnectedComponentEntry, body: string): string =>
    pathComments ? [sourceComment(entry.layerPath), body].join('\n') : body;

  if (hasConflict) {
    return entries
      .map((entry) => section(entry, formatUsageSnippet(entry.usage)))
      .join('\n\n');
  }

  const usages = entries
    .map((entry) => section(entry, entry.usage.jsx))
    .join('\n\n');
  const importBlock = renderImportLines(allImports);
  return importBlock ? [importBlock, '', usages].join('\n') : usages;
}

/**
 * `//./ <layers inside the selection> / <name>` — relative to the inspected
 * root, so the root's own name (the first path segment) is dropped.
 */
function sourceComment(layerPath: string[]): string {
  const inside = layerPath.length > 1 ? layerPath.slice(1) : layerPath;
  return `//./ ${inside.join(' / ')}`;
}
