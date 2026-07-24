/**
 * Layout / Style partition of `getCSSAsync()` output (Phase B).
 *
 * One explicit, tested property table — no scattered conditionals. Unknown or
 * future properties default to the Style bucket, matching Figma's own panel
 * behavior of grouping non-structural properties under Style.
 *
 * Spec: docs/layout-composer-roadmap.md §"Layout / Style partition".
 */

import type { CssDeclaration, NodeCss } from './types';

/** Properties that belong to the Layout section, matched exactly. */
const LAYOUT_PROPERTIES = new Set([
  'display',
  'flex-direction',
  'flex-wrap',
  'flex-flow',
  'flex',
  'flex-grow',
  'flex-shrink',
  'flex-basis',
  'gap',
  'row-gap',
  'column-gap',
  'justify-content',
  'align-items',
  'align-self',
  'align-content',
  'padding',
  'width',
  'height',
  'min-width',
  'min-height',
  'max-width',
  'max-height',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'overflow',
  'box-sizing',
  'grid',
]);

/** Prefixes that place a property in the Layout section (`padding-left`, …). */
const LAYOUT_PREFIXES = ['padding-', 'overflow-', 'grid-'];

/** True when a CSS property belongs in the Layout section. */
export function isLayoutProperty(property: string): boolean {
  const normalized = property.trim().toLowerCase();
  return (
    LAYOUT_PROPERTIES.has(normalized)
    || LAYOUT_PREFIXES.some((prefix) => normalized.startsWith(prefix))
  );
}

/**
 * Split `getCSSAsync()` declarations into Layout and Style buckets, preserving
 * the input declaration order within each bucket.
 */
export function partitionCss(declarations: CssDeclaration[]): NodeCss {
  const layout: CssDeclaration[] = [];
  const style: CssDeclaration[] = [];

  for (const declaration of declarations) {
    (isLayoutProperty(declaration.property) ? layout : style).push(declaration);
  }

  return { layout, style };
}

/**
 * Render a bucket as copy-ready CSS text: one `property: value;` per line,
 * matching the native inspect panel. Returns an empty string for an empty
 * bucket so callers can omit the section.
 */
export function formatCssBlock(declarations: CssDeclaration[]): string {
  return declarations
    .map(({ property, value }) => `${property}: ${value};`)
    .join('\n');
}
