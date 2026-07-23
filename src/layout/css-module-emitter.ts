/**
 * CSS Modules emitter for the layout composer (Phase 1 + Phase 3).
 *
 * Walks the layout IR and emits one `.className { … }` rule per container, plus
 * a per-child rule whenever a node needs flex-item behavior (grow, stretch, or
 * explicit sizing). Implements the full auto-layout mapping table including the
 * FIXED/HUG/FILL sizing policy and the root fixed-width omission.
 *
 * Pure, Figma-independent. Spec: roadmap §"Auto-layout to CSS Modules contract".
 */

import type {
  ChildStyle,
  CompositionNode,
  ContainerCompositionNode,
  LayoutDocument,
  LayoutStyle,
  SizingMode,
} from './types';

/**
 * Render the whole document's CSS Module text. Rules are emitted in document
 * order (pre-order traversal): each container's rule immediately followed by
 * its children's flex-item rules. Deterministic.
 *
 * The root's fixed canvas width is omitted by default (roadmap sizing policy)
 * so generated layouts remain responsive; the caller surfaces an informational
 * diagnostic via the LayoutDocument.
 */
export function renderCssModule(document: LayoutDocument): string {
  const rules: string[] = [];
  collectRules(document.root, rules, true);
  return rules.join('\n\n').concat(rules.length > 0 ? '\n' : '');
}

function collectRules(node: CompositionNode, rules: string[], isRoot: boolean): void {
  if (node.kind === 'container') {
    rules.push(renderContainerRule(node, isRoot));
    for (const child of node.children) {
      collectRules(child, rules, false);
    }
    return;
  }
  // Component/text/placeholder nodes only need a rule when they declare
  // flex-item behavior (childStyle) AND have a className to anchor it to.
  if (('childStyle' in node) && node.childStyle && 'className' in node && node.className) {
    rules.push(renderChildRule(node.className, node.childStyle, node.kind));
  }
}

function renderContainerRule(node: ContainerCompositionNode, isRoot: boolean): string {
  const declarations = renderLayoutDeclarations(node.layout, isRoot);
  // A non-root container may also participate as a flex item in its parent;
  // those declarations belong in the same rule.
  if (node.childStyle && !isRoot) {
    declarations.push(...renderChildDeclarations(node.childStyle));
  }
  return `.${node.className} {\n${declarations.join('\n')}\n}`;
}

/**
 * Render the declaration block for a {@link LayoutStyle}. Declaration order is
 * fixed so output is deterministic: box model (display, direction, wrap), gap,
 * padding, sizing, then alignment.
 *
 * `isRoot` controls the fixed-width omission: the root's canvas width is
 * dropped so the layout can stay responsive.
 */
export function renderLayoutDeclarations(style: LayoutStyle, isRoot = false): string[] {
  const lines: string[] = [];

  lines.push('  display: flex;');
  lines.push(style.axis === 'horizontal'
    ? '  flex-direction: row;'
    : '  flex-direction: column;');

  if (style.wrap) {
    lines.push('  flex-wrap: wrap;');
  }

  if (style.counterGap !== undefined && style.wrap) {
    lines.push(style.axis === 'horizontal'
      ? `  column-gap: ${formatLength(style.gap)};`
      : `  row-gap: ${formatLength(style.gap)};`);
    lines.push(style.axis === 'horizontal'
      ? `  row-gap: ${formatLength(style.counterGap)};`
      : `  column-gap: ${formatLength(style.counterGap)};`);
  } else if (style.gap > 0) {
    lines.push(`  gap: ${formatLength(style.gap)};`);
  }

  const padding = formatPadding(style);
  if (padding !== null) {
    lines.push(`  padding: ${padding};`);
  }

  lines.push(...renderSizingDeclarations(style, isRoot));

  if (style.justifyContent && style.justifyContent !== 'flex-start') {
    lines.push(`  justify-content: ${style.justifyContent};`);
  }
  if (style.alignItems && style.alignItems !== 'stretch') {
    lines.push(`  align-items: ${style.alignItems};`);
  }

  return lines;
}

/**
 * Emit width/height for a container's own sizing. `HUG` is the default and
 * omitted (document flow). `FILL` on the cross axis becomes `100%`; on the
 * main axis it is expressed via flex-grow on the child instead. `FIXED` emits
 * the explicit pixel dimension. The root's fixed width is always omitted so
 * generated layouts remain responsive.
 */
function renderSizingDeclarations(style: LayoutStyle, isRoot: boolean): string[] {
  const lines: string[] = [];

  // Width: skip for the root (responsive), FILL on horizontal becomes flex-grow.
  if (!isRoot && style.sizingHorizontal === 'fixed' && typeof style.width === 'number') {
    lines.push(`  width: ${formatLength(style.width)};`);
  } else if (!isRoot && style.sizingHorizontal === 'fill' && style.axis !== 'horizontal') {
    // FILL on the cross axis (a vertical container filling horizontally).
    lines.push('  width: 100%;');
  }

  // Height: FILL on vertical becomes flex-grow; emit only cross-axis fill or fixed.
  if (style.sizingVertical === 'fixed' && typeof style.height === 'number') {
    lines.push(`  height: ${formatLength(style.height)};`);
  } else if (style.sizingVertical === 'fill' && style.axis !== 'vertical') {
    lines.push('  height: 100%;');
  }

  return lines;
}

/** A standalone flex-item rule for a non-container child (component/text). */
function renderChildRule(className: string, style: ChildStyle, _kind: CompositionNode['kind']): string {
  const declarations = renderChildDeclarations(style);
  return `.${className} {\n${declarations.join('\n')}\n}`;
}

/**
 * Declarations for a node's flex-item behavior in its parent. `grow` →
 * `flex-grow`; `alignSelf: stretch` → `align-self`; sizing per the same
 * FIXED/HUG/FILL policy as containers but relative to the parent axis.
 */
export function renderChildDeclarations(style: ChildStyle): string[] {
  const lines: string[] = [];

  if (typeof style.grow === 'number' && style.grow > 0) {
    lines.push(`  flex-grow: ${style.grow};`);
  }
  if (style.alignSelf === 'stretch') {
    lines.push('  align-self: stretch;');
  }

  // Child sizing: FILL on the cross axis → 100%; FIXED → explicit px; HUG → omit.
  if (style.sizingHorizontal === 'fixed' && typeof style.width === 'number') {
    lines.push(`  width: ${formatLength(style.width)};`);
  } else if (style.sizingHorizontal === 'fill') {
    lines.push('  width: 100%;');
  }

  if (style.sizingVertical === 'fixed' && typeof style.height === 'number') {
    lines.push(`  height: ${formatLength(style.height)};`);
  } else if (style.sizingVertical === 'fill') {
    lines.push('  height: 100%;');
  }

  return lines;
}

/**
 * Minimal valid `padding` shorthand from four values, or null when all zero.
 * Collapses equal sides: `12px` > `12px 8px` > `12px 8px 4px` > full form.
 */
function formatPadding(style: LayoutStyle): string | null {
  const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = style;
  if (t === 0 && r === 0 && b === 0 && l === 0) {
    return null;
  }
  if (t === b && l === r) {
    if (t === l) {
      return formatLength(t);
    }
    return `${formatLength(t)} ${formatLength(r)}`;
  }
  if (l === r) {
    return `${formatLength(t)} ${formatLength(r)} ${formatLength(b)}`;
  }
  return `${formatLength(t)} ${formatLength(r)} ${formatLength(b)} ${formatLength(l)}`;
}

/**
 * Format a Figma pixel length as a CSS length. Integer values stay bare;
 * fractional values are rounded to a stable precision to avoid floating-point
 * noise. Non-finite values fall back to 0px so output is always valid.
 */
export function formatLength(value: number): string {
  if (!Number.isFinite(value)) {
    return '0px';
  }
  if (Number.isInteger(value)) {
    return `${value}px`;
  }
  return `${Math.round(value * 100) / 100}px`;
}

/** Re-export for callers that need to classify sizing. */
export type { SizingMode };
