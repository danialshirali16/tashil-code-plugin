/**
 * Orchestrate deterministic styled-components TSX generation from layout IR.
 */

import { toComponentName } from './naming';
import { renderTsx } from './tsx-emitter';
import type { CompositionNode, GeneratedLayout, LayoutDocument } from './types';

export function generateLayout(document: LayoutDocument): GeneratedLayout {
  const rendered = renderTsx(document);
  return {
    componentName: rendered.componentName,
    componentCount: countNodes(document.root, (node) => node.kind === 'component'),
    wrapperCount: countNodes(document.root, (node) => node.kind === 'container'),
    tsx: rendered.tsx,
    diagnostics: [...document.diagnostics],
  };
}

function countNodes(
  node: CompositionNode,
  predicate: (node: CompositionNode) => boolean,
): number {
  let count = predicate(node) ? 1 : 0;
  if (node.kind === 'container') {
    for (const child of node.children) {
      count += countNodes(child, predicate);
    }
  }
  return count;
}

export { toComponentName };
