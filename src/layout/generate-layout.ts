/**
 * Layout generation orchestrator (Phase 1).
 *
 * Given a resolved {@link LayoutDocument} IR, produce a {@link GeneratedLayout}
 * with deterministic TSX, CSS Module text, counts, and the document's
 * diagnostics. This is the single entry point both Dev Mode and Inspect Code
 * adapters will call (Phase 4 / 5).
 *
 * Pure, Figma-independent. Spec: roadmap §"Target domain model".
 */

import { renderCssModule } from './css-module-emitter';
import { renderTsx } from './tsx-emitter';
import { toComponentName } from './naming';
import type { CompositionNode, GeneratedLayout, LayoutDocument } from './types';

/**
 * Generate TSX + CSS from a layout IR. `cssModulePath` is the module specifier
 * used in the `import styles from …` line (e.g. `./PaymentDetails.module.css`).
 */
export function generateLayout(
  document: LayoutDocument,
  cssModulePath: string,
): GeneratedLayout {
  const tsx = renderTsx(document, cssModulePath);
  const css = renderCssModule(document);

  const componentCount = countNodes(document.root, (node) => node.kind === 'component');
  const wrapperCount = countNodes(document.root, (node) => node.kind === 'container');

  return {
    componentCount,
    wrapperCount,
    tsx,
    css,
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
