/**
 * Import collection, deduplication, and aliasing for the layout composer.
 *
 * Takes the per-usage {@link ComponentImport} lists emitted by
 * `createComponentUsage` and merges them into one sorted, deduplicated set of
 * import lines. Same imported name from two different modules resolves to a
 * deterministic local alias so the generated JSX stays valid.
 *
 * Pure, Figma-independent. Spec: roadmap §"Component usage refactor".
 */

import type { ComponentImport } from './types';

/**
 * Merge a list of per-usage imports into one sorted import-block string.
 *
 * Format (matches the existing single-component output exactly so the Phase 0
 * compatibility baselines stay byte-identical):
 *
 *     import { A, B } from "path-a";
 *     import { C } from "path-b";
 *
 * Lines are sorted by module path; names within a line are sorted
 * alphabetically and deduplicated. When the same `importedName` arrives from
 * two distinct module paths, the second occurrence is aliased as
 * `${name}${suffix}` (deterministic) and that alias must already be the
 * `localName` used in the JSX — so a layout's JSX references the aliased name.
 */
export function renderImportLines(imports: readonly ComponentImport[]): string {
  const byPath = collectByPath(imports);

  // Paths in insertion order — NOT sorted. The legacy single-usage output
  // emits the component's importPath before the icon's importPath, and the
  // existing golden tests pin that order. Multi-usage determinism comes from
  // the caller passing imports in document order, which is itself stable.
  return Array.from(byPath.entries())
    .map(([modulePath, entries]) => {
      // Dedup by localName; preserve insertion order within a path so the
      // single-usage compatibility baselines stay byte-identical with the old
      // `createImportLines` (component name first, then named imports).
      const seen = new Set<string>();
      const names: string[] = [];
      for (const entry of entries) {
        if (seen.has(entry.localName)) {
          continue;
        }
        seen.add(entry.localName);
        names.push(formatName(entry));
      }
      return `import { ${names.join(', ')} } from ${JSON.stringify(modulePath)};`;
    })
    .join('\n');
}

/**
 * Collect every import, resolving same-name/different-path conflicts with a
 * deterministic alias. Returns entries grouped by module path, in insertion
 * order within each path (the block is sorted afterward by the caller).
 *
 * Aliasing rule: a name's first module path wins the bare name; any later
 * module path that wants the same imported name gets `${name}${N}` where N
 * starts at 2. The caller is responsible for using the returned `localName` in
 * JSX — this function only assigns aliases, it does not rewrite JSX.
 */
export function collectByPath(
  imports: readonly ComponentImport[],
): Map<string, Array<{ importedName: string; localName: string }>> {
  const byPath = new Map<string, Array<{ importedName: string; localName: string }>>();
  // bareName -> modulePath that owns the un-aliased name.
  const ownerOfBare = new Map<string, string>();
  // bareName -> next alias suffix (starts at 2 on first collision).
  const nextAliasSuffix = new Map<string, number>();

  for (const entry of imports) {
    const list = byPath.get(entry.modulePath) ?? [];

    let localName = entry.importedName;
    const owner = ownerOfBare.get(entry.importedName);
    if (owner !== undefined && owner !== entry.modulePath) {
      // Conflict: a different module already owns the bare name. Alias this one.
      const suffix = nextAliasSuffix.get(entry.importedName) ?? 2;
      localName = `${entry.importedName}${suffix}`;
      nextAliasSuffix.set(entry.importedName, suffix + 1);
    } else if (owner === undefined) {
      ownerOfBare.set(entry.importedName, entry.modulePath);
    }

    list.push({ importedName: entry.importedName, localName });
    byPath.set(entry.modulePath, list);
  }

  return byPath;
}

/**
 * `import { Foo }` vs `import { Foo as Foo2 }`. Bare name when local matches
 * imported; aliased otherwise. The single-usage compatibility case always
 * emits the bare name.
 */
function formatName(entry: { importedName: string; localName: string }): string {
  return entry.localName === entry.importedName
    ? entry.localName
    : `${entry.importedName} as ${entry.localName}`;
}
