import {
  createComponentUsage,
  formatMappingDiagnostics,
} from '../codegen';
import { formatGeneratedCode, selectCopyContent } from '../output-preferences';
import { renderImportLines } from '../layout/imports';
import { GenerationContext } from '../layout/generation-context';
import type { LayoutSourceNode } from '../layout/figma-layout-extractor';
import {
  generateReactLayout,
} from '../layout/react-layout';
import { createSemanticNodeTree } from '../semantic/figma-adapter';
import {
  resolveSemanticUsage,
  type SemanticRuntimeRequirement,
  type SemanticTargetExplanation,
} from '../semantic/resolver';
import { formatCssBlock } from '../inspect/css-partition';
import { formatConnectedComponentsSnippet } from '../inspect/usage-snippet';
import { inspectFrame, type InspectableNode } from '../inspect/inspect-frame';
import type { ConnectedComponentEntry, FrameInspection } from '../inspect/types';
import type {
  CodegenBlock,
  ConnectionMetadata,
} from '../types';
import {
  createPlainTextBlock,
  formatUnexpectedError,
  type ConnectedOutput,
  type ConnectionReadResult,
  type ResolvedSelection,
} from './types';
import { loadOutputPreferences } from './preferences';
import {
  createReferenceText,
  createSelectionVariantLogic,
  readConnectionMetadata,
  resolveSelection,
} from './connection-adapter';

const MAX_MULTI_SELECTION = 50;

export function registerCodegenHandler(): void {
  figma.codegen.on('generate', async (event) => {
    const currentSelection = figma.currentPage.selection;
    const [blocks, preferences] = await Promise.all([
      currentSelection.length > 1
        ? generateMultiSelectionCodegenBlocks(currentSelection)
        : generateCodegenBlocks(event.node),
      loadOutputPreferences(),
    ]);
    return blocks.map((block) => block.language === 'TYPESCRIPT'
      ? { ...block, code: selectCopyContent(formatGeneratedCode(block.code, preferences), preferences.copyMode) }
      : block);
  });
}

export async function generateMultiSelectionCodegenBlocks(
  nodes: readonly SceneNode[],
): Promise<CodegenBlock[]> {
  if (nodes.length > MAX_MULTI_SELECTION) {
    return [createPlainTextBlock(
      'Selected components',
      `Select no more than ${MAX_MULTI_SELECTION} layers for combined output.`,
    )];
  }

  const entries: ConnectedComponentEntry[] = [];
  const notes: string[] = [];
  for (const node of nodes) {
    const selection = await resolveSelection(node);
    if (!selection) {
      notes.push(`${node.name}: unsupported selection.`);
      continue;
    }
    const connection = readConnectionMetadata(selection.mainComponent);
    if (!connection.ok) {
      notes.push(`${node.name}: ${connection.message}`);
      continue;
    }
    const output = await createConnectedOutput(connection.metadata, selection, node);
    entries.push({
      componentName: connection.metadata.componentName,
      layerPath: [node.name],
      nodeId: node.id,
      usage: output.usage,
    });
    for (const detail of [output.diagnostics, output.runtimeRequirements, output.deprecation]) {
      if (detail) notes.push(`${node.name}: ${detail}`);
    }
  }

  if (entries.length === 0) {
    return [createPlainTextBlock(
      'Selected components',
      notes.join('\n') || 'No connected component instances were selected.',
    )];
  }

  const blocks: CodegenBlock[] = [{
    code: formatConnectedComponentsSnippet(entries, {
      pathComments: readPathCommentsPreference(),
    }),
    language: 'TYPESCRIPT',
    title: `Selected components (${entries.length})`,
  }];
  if (notes.length > 0) blocks.push(createPlainTextBlock('Selection notes', notes.join('\n')));
  return blocks;
}

export async function generateCodegenBlocks(node: SceneNode): Promise<CodegenBlock[]> {
  try {
    const selection = await resolveSelection(node);

    if (selection) {
      const connection = readConnectionMetadata(selection.mainComponent);
      if (connection.ok) {
        return generateConnectedComponentBlocks(selection, node, connection.metadata);
      }
      return generateNotConnectedComponentBlocks(selection, node, connection);
    }

    if (node.type === 'FRAME' || node.type === 'GROUP' || node.type === 'SECTION') {
      return generateFrameLayoutBlocks(node);
    }

    return generatePrimitiveBlocks(node);
  } catch (error) {
    return [
      createPlainTextBlock(
        'Storybook Connect Error',
        error instanceof Error ? error.message : 'Unknown codegen error.',
      ),
    ];
  }
}

export const MAX_FRAME_CODEGEN_NODES = 150;

/**
 * Fast, non-blocking pre-flight counter for subtree layers.
 * Traverses up to (limit + 1) nodes and returns early if limit is exceeded.
 */
export function countSceneNodes(root: SceneNode, limit: number): number {
  let count = 1;
  const stack: SceneNode[] = [];
  if ('children' in root && Array.isArray(root.children)) {
    stack.push(...root.children);
  }

  while (stack.length > 0) {
    const current = stack.pop()!;
    count += 1;
    if (count > limit) {
      return count;
    }
    if ('children' in current && Array.isArray(current.children)) {
      stack.push(...current.children);
    }
  }

  return count;
}

/**
 * Category 1: Selected a Frame / Container
 * - Generated Code
 * - Layout (CSS)
 * - Style (CSS)
 */
export async function generateFrameLayoutBlocks(node: SceneNode): Promise<CodegenBlock[]> {
  const nodeCount = countSceneNodes(node, MAX_FRAME_CODEGEN_NODES);

  if (nodeCount > MAX_FRAME_CODEGEN_NODES) {
    const inspection = await inspectSceneNode(node);
    const blocks: CodegenBlock[] = [
      createPlainTextBlock(
        'Generated Code',
        [
          '⚠️ This frame contains too many layers for full React generation.',
          '',
          '💡 Tip: Select a specific section, widget, or sub-component inside this frame to generate focused code.',
        ].join('\n'),
      ),
    ];
    blocks.push(...createCssBlocks(inspection));
    return blocks;
  }

  const context = new GenerationContext();
  const [layoutResult, inspectionResult] = await Promise.allSettled([
    generateReactLayout(
      node as unknown as LayoutSourceNode,
      { context },
    ),
    inspectSceneNode(node, context),
  ]);

  const blocks: CodegenBlock[] = [];
  if (layoutResult.status === 'fulfilled') {
    blocks.push({
      title: 'Generated Code',
      language: 'TYPESCRIPT',
      code: layoutResult.value.tsx,
    });
  } else {
    blocks.push(createPlainTextBlock(
      'React generation notes',
      `React generation failed: ${formatUnexpectedError(layoutResult.reason)}`,
    ));
  }

  if (inspectionResult.status === 'fulfilled') {
    blocks.push(...createCssBlocks(inspectionResult.value));
  }

  return blocks;
}

/**
 * Category 2: Selected a Connected Component
 * - Generated Code
 * - References
 * - Layout (CSS)
 * - Style (CSS)
 * - Notes
 */
export async function generateConnectedComponentBlocks(
  selection: ResolvedSelection,
  selectedNode: SceneNode,
  metadata: ConnectionMetadata,
): Promise<CodegenBlock[]> {
  const output = await createConnectedOutput(metadata, selection, selectedNode);
  const blocks: CodegenBlock[] = [
    {
      title: 'Generated Code',
      language: 'TYPESCRIPT',
      code: output.code,
    },
  ];

  const references = createReferenceText(metadata);
  if (references) {
    blocks.push(createPlainTextBlock('References', references));
  }

  const inspection = await inspectSceneNode(selectedNode);
  blocks.push(...createCssBlocks(inspection));

  const noteItems: string[] = [];
  if (output.deprecation) {
    noteItems.push(`⚠️ Deprecated: ${output.deprecation}`);
  }
  if (output.runtimeRequirements) {
    noteItems.push(`Runtime requirements:\n${output.runtimeRequirements}`);
  }
  if (output.diagnostics) {
    noteItems.push(output.diagnostics);
  }
  if (noteItems.length > 0) {
    blocks.push(createPlainTextBlock('Notes', noteItems.join('\n\n')));
  }

  return blocks;
}

/**
 * Category 3: Selected a NotConnected Component
 * - ⚠️ The component isn't Connect (Simple message)
 * - Variant logic (if available)
 * - Layout (CSS)
 * - Style (CSS)
 */
export async function generateNotConnectedComponentBlocks(
  selection: ResolvedSelection,
  node: SceneNode,
  connection?: ConnectionReadResult,
): Promise<CodegenBlock[]> {
  const message = connection && !connection.ok && connection.issue
    ? connection.message
    : '💬 Ask the Design System Owner';
  const blocks: CodegenBlock[] = [
    createPlainTextBlock(
      "⚠️ This component isn't connected to code.",
      message,
    ),
  ];

  const variantLogic = createSelectionVariantLogic(selection);
  if (variantLogic?.code) {
    blocks.push({
      title: 'Variant logic',
      language: 'TYPESCRIPT',
      code: variantLogic.code,
    });
  }

  const inspection = await inspectSceneNode(node);
  blocks.push(...createCssBlocks(inspection));

  return blocks;
}

/**
 * Category 4: Selected a Primitive / Vector / Text
 * - Content (Only for Texts)
 * - Layout (CSS)
 * - Style (CSS)
 */
export async function generatePrimitiveBlocks(node: SceneNode): Promise<CodegenBlock[]> {
  const blocks: CodegenBlock[] = [];

  if (node.type === 'TEXT' && 'characters' in node && typeof node.characters === 'string') {
    blocks.push(createPlainTextBlock('Content', node.characters));
  }

  const inspection = await inspectSceneNode(node);
  blocks.push(...createCssBlocks(inspection));

  return blocks;
}

export function createCssBlocks(inspection: FrameInspection): CodegenBlock[] {
  const blocks: CodegenBlock[] = [];

  const layoutCss = formatCssBlock(inspection.css.layout);
  if (layoutCss) {
    blocks.push({ title: 'Layout', language: 'CSS', code: layoutCss });
  }

  const styleCssRaw = formatCssBlock(inspection.css.style);
  if (styleCssRaw) {
    let styleCss = styleCssRaw;
    if (inspection.textStyleName) {
      const comment = `/* Text style: "${inspection.textStyleName}" */`;
      const lines = styleCssRaw.split('\n');
      let lastColorIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].trimStart().startsWith('color:')) {
          lastColorIndex = i;
        }
      }
      if (lastColorIndex === -1) {
        styleCss = `${comment}\n${styleCssRaw}`;
      } else {
        lines.splice(lastColorIndex + 1, 0, comment);
        styleCss = lines.join('\n');
      }
    }
    blocks.push({ title: 'Style', language: 'CSS', code: styleCss });
  }

  return blocks;
}

export async function createConnectedOutput(
  metadata: ConnectionMetadata,
  selection: ResolvedSelection,
  selectedNode: SceneNode,
): Promise<ConnectedOutput> {
  if (metadata.semanticRecipe) {
    const root = await createSemanticNodeTree(selectedNode);
    const result = resolveSemanticUsage(
      metadata.componentName,
      metadata.importPath,
      metadata.semanticRecipe,
      {
        componentProperties: selection.componentProperties,
        instanceSwaps: selection.instanceSwaps,
        root,
      },
    );

    return {
      code: [renderImportLines(result.usage.imports), '', result.usage.jsx].join('\n'),
      diagnostics: result.issues.length > 0 ? result.issues.join('\n') : undefined,
      explanation: formatSemanticExplanations(result.explanations),
      runtimeRequirements: formatRuntimeRequirements(result.runtimeRequirements),
      deprecation: result.deprecation,
      usage: result.usage,
    };
  }

  const usage = createComponentUsage(metadata, selection);
  return {
    code: [renderImportLines(usage.imports), '', usage.jsx].join('\n'),
    diagnostics: formatMappingDiagnostics(usage.diagnostics) || undefined,
    usage,
  };
}

export function formatSemanticExplanations(
  explanations: readonly SemanticTargetExplanation[],
): string | undefined {
  if (explanations.length === 0) {
    return undefined;
  }

  return explanations
    .map((explanation) => {
      const status = explanation.outcome === 'emitted'
        ? ''
        : ` (${explanation.outcome})`;
      return `${explanation.targetPath}${status} — ${explanation.reason}`;
    })
    .join('\n');
}

export function formatRuntimeRequirements(
  requirements: readonly SemanticRuntimeRequirement[],
): string | undefined {
  if (requirements.length === 0) {
    return undefined;
  }

  return requirements
    .map((requirement) => {
      const note = requirement.note ? ` — ${requirement.note}` : '';
      const label = requirement.placeholder === requirement.targetPath
        ? requirement.targetPath
        : `${requirement.placeholder} → ${requirement.targetPath}`;
      return `${label}: ${requirement.typeName}${note}`;
    })
    .join('\n');
}

export async function inspectSceneNode(
  node: SceneNode,
  context?: GenerationContext,
): Promise<FrameInspection> {
  return inspectFrame(node as unknown as InspectableNode, {
    context,
    loadTextStyle: loadFigmaTextStyle,
  });
}

export async function loadFigmaTextStyle(id: string): Promise<{ name: string } | null> {
  const style = await figma.getStyleByIdAsync(id);
  return style ? { name: style.name } : null;
}

export function readPathCommentsPreference(): boolean {
  try {
    return figma.codegen.preferences?.customSettings?.['pathComments'] !== 'hide';
  } catch (_error) {
    return true;
  }
}
