/**
 * Selected-node CSS retrieval (Phase B).
 *
 * Wraps `node.getCSSAsync()` — the same CSS Figma's native inspect panel
 * shows, including variable-backed values like `var(--spacer-3, 1rem)` — and
 * partitions the result into Layout and Style sections. The CSS is passed
 * normalized only when Figma returns a bare design-token path that is not
 * valid CSS by itself.
 *
 * Never throws: a missing or failing `getCSSAsync` yields empty sections plus
 * a `css-unavailable` diagnostic so the caller can still render the
 * connected-components section.
 */

import { partitionCss } from './css-partition';
import { normalizeCssValue } from '../css-values';
import type { GenerationContext } from '../layout/generation-context';
import type { CssDeclaration, InspectionDiagnostic, NodeCss } from './types';

/** Minimal structural view of a node that may expose `getCSSAsync()`. */
export type CssSourceNode = {
  id: string;
  name: string;
  getCSSAsync?: () => Promise<{ [key: string]: string }>;
};

export type NodeCssResult = {
  css: NodeCss;
  diagnostics: InspectionDiagnostic[];
};

const EMPTY_CSS: NodeCss = { layout: [], style: [] };

/**
 * Retrieve and partition a node's CSS. Declaration order within each bucket
 * preserves the `getCSSAsync()` emission order (object insertion order).
 */
export async function getNodeCss(
  node: CssSourceNode,
  context?: GenerationContext,
): Promise<NodeCssResult> {
  if (typeof node.getCSSAsync !== 'function') {
    return {
      css: EMPTY_CSS,
      diagnostics: [cssUnavailable(node, 'CSS inspection is not available for this node in the current Figma runtime.')],
    };
  }

  let raw: { [key: string]: string };
  try {
    raw = context
      ? await context.getNodeCss(node.id, () => node.getCSSAsync!())
      : await node.getCSSAsync();
  } catch {
    return {
      css: EMPTY_CSS,
      diagnostics: [cssUnavailable(node, `Figma could not produce CSS for "${node.name}".`)],
    };
  }

  const declarations: CssDeclaration[] = Object.entries(raw ?? {}).map(
    ([property, value]) => ({
      property,
      value: normalizeCssValue(String(value)),
    }),
  );

  return { css: partitionCss(declarations), diagnostics: [] };
}

function cssUnavailable(node: CssSourceNode, message: string): InspectionDiagnostic {
  return {
    severity: 'warning',
    reason: 'css-unavailable',
    message,
    nodeId: node.id,
    layerPath: [node.name],
  };
}
