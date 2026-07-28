import {
  extractLayout,
  type ExtractLayoutOptions,
  type LayoutSourceNode,
} from './figma-layout-extractor';
import { generateLayout } from './generate-layout';
import type { ReactLayoutResult } from './types';

const SUPPORTED_ROOT_TYPES = new Set([
  'COMPONENT',
  'COMPONENT_SET',
  'FRAME',
  'GROUP',
  'INSTANCE',
  'SECTION',
  'TEXT',
]);

/** Whether a selection can produce a meaningful full React tree. */
export function supportsReactLayout(node: { type: string }): boolean {
  return SUPPORTED_ROOT_TYPES.has(node.type);
}

/** Generate one complete styled-components TSX module. */
export async function generateReactLayout(
  node: LayoutSourceNode,
  options: ExtractLayoutOptions = {},
): Promise<ReactLayoutResult> {
  const document = await extractLayout(node, options);
  const generated = generateLayout(document);

  return {
    ...generated,
    nodeName: node.name,
    nodeType: node.type,
  };
}
