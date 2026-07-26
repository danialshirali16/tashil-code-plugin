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
    runtimeRequirements: collectRuntimeRequirements(document.root),
    fidelity: summarizeFidelity(document),
  };
}

function collectRuntimeRequirements(node: CompositionNode): string[] {
  if (node.kind === 'component') {
    const path = node.layerPath.join(' / ');
    return (node.usage.runtimeRequirements ?? [])
      .map((requirement) => `${path} — ${requirement}`);
  }
  if (node.kind !== 'container') {
    return [];
  }
  return unique(node.children.flatMap(collectRuntimeRequirements));
}

function summarizeFidelity(document: LayoutDocument): GeneratedLayout['fidelity'] {
  const unresolvedReasons = new Set([
    'unconnected-instance',
    'invalid-connection',
    'missing-main-component',
  ]);
  const unsupportedAssetReasons = new Set([
    'unsupported-node',
    'unsupported-paint',
  ]);
  const omittedDeclarationReasons = new Set([
    'css-unavailable',
    'grid-layout',
    'root-fixed-size-omitted',
    'unsupported-effect',
    'unsupported-layout-mode',
  ]);

  return {
    unresolvedComponents: document.diagnostics.filter(({ reason }) =>
      unresolvedReasons.has(reason)).length,
    unsupportedAssets: document.diagnostics.filter(({ reason }) =>
      unsupportedAssetReasons.has(reason)).length,
    omittedDeclarations: document.diagnostics.filter(({ reason }) =>
      omittedDeclarationReasons.has(reason)).length,
  };
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
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
