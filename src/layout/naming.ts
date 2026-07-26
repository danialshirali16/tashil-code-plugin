/**
 * Deterministic naming helpers for generated React layouts.
 */

const IDENTIFIER_START = /^[A-Za-z_$]/;

/** Turn an arbitrary layer name into a legal PascalCase React component name. */
export function toComponentName(layerName: string): string {
  const chunks = layerName
    .split(/[^A-Za-z0-9_$]+/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (chunks.length === 0) {
    return 'GeneratedLayout';
  }

  const pascal = chunks
    .map((chunk) => chunk[0].toUpperCase() + chunk.slice(1))
    .join('');

  return IDENTIFIER_START.test(pascal) ? pascal : `Layer${pascal}`;
}

/** Turn a layer name into a stable kebab-case key for extraction diagnostics. */
export function toClassName(layerName: string): string {
  const kebab = layerName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return kebab || 'layer';
}

/** Assign collision-free class names in stable document order. */
export function resolveClassNames(
  candidates: ReadonlyArray<{ nodeId: string; name: string }>,
): Map<string, string> {
  const assigned = new Map<string, string>();
  const used = new Set<string>();

  for (const candidate of candidates) {
    const base = toClassName(candidate.name);
    let next = base;
    let suffix = 2;

    while (used.has(next)) {
      next = `${base}-${suffix}`;
      suffix += 1;
    }

    used.add(next);
    assigned.set(candidate.nodeId, next);
  }

  return assigned;
}
