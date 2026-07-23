/**
 * Naming helpers for the layout composer (Phase 1).
 *
 * Pure, deterministic. Derives legal identifiers from layer names and resolves
 * class-name collisions with stable path-based suffixes. Spec: roadmap §"Naming
 * and formatting rules".
 */

const IDENTIFIER_START = /^[A-Za-z_$]/;

/**
 * Turn an arbitrary layer name into a legal PascalCase React function name.
 * Falls back to `GeneratedLayout` when nothing usable can be derived — the
 * roadmap's documented fallback.
 */
export function toComponentName(layerName: string): string {
  // Split on any non-identifier run and capitalize each surviving chunk.
  const chunks = layerName
    .split(/[^A-Za-z0-9_$]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length === 0) {
    return 'GeneratedLayout';
  }

  const pascal = chunks
    .map((chunk) => upperFirst(chunk))
    .join('');

  // A name may start with a digit after sanitization (e.g. layer "1 / 2");
  // prefix so it is a legal identifier.
  return IDENTIFIER_START.test(pascal) ? pascal : `Layer${pascal}`;
}

/**
 * Derive a kebab-case CSS class name from a layer name. Empty input yields
 * `layer`. The importer resolves collisions separately via {@link uniqueClassName}.
 */
export function toClassName(layerName: string): string {
  const kebab = layerName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return kebab.length > 0 ? kebab : 'layer';
}

/**
 * Assign stable, collision-free class names across a set of candidates.
 * Collisions are resolved with a deterministic numeric suffix (`header`,
 * `header-2`, `header-3`). The first occurrence keeps its bare name; later
 * collisions get the next available suffix starting at 2.
 */
export function resolveClassNames(
  candidates: ReadonlyArray<{ nodeId: string; name: string }>,
): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  for (const candidate of candidates) {
    const base = toClassName(candidate.name);
    if (!used.has(base)) {
      used.add(base);
      assigned.set(candidate.nodeId, base);
      continue;
    }

    let suffix = 2;
    while (used.has(`${base}-${suffix}`)) {
      suffix += 1;
    }
    const next = `${base}-${suffix}`;
    used.add(next);
    assigned.set(candidate.nodeId, next);
  }

  return assigned;
}

function upperFirst(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value[0].toUpperCase() + value.slice(1);
}
