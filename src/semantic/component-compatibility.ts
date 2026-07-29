/**
 * Read explicit component constraints from React element types such as
 * `ReactElement<ButtonProps, typeof Button>`. A plain ReactNode/ReactElement
 * remains intentionally open to any connected child.
 *
 * This module deliberately has no TypeScript-compiler dependency because the
 * resolver runs in the Figma plugin bundle.
 */
export function getAcceptedComponentNames(typeName: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const pattern = /typeof\s+(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*([A-Z_$][A-Za-z0-9_$]*)/g;
  let match = pattern.exec(typeName);
  while (match !== null) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
    match = pattern.exec(typeName);
  }
  return names;
}
