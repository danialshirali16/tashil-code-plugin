import { emit, on, showUI } from '@create-figma-plugin/utilities';
import {
  createComponentUsage,
  formatMappingDiagnostics,
  isPropMappings,
  isRecord,
  migratePersistedConnectionMetadata,
  validatePersistedConnectionMetadata,
  validateConnectionMetadata,
  type ResolvedInstanceSwap,
} from './codegen';
import { generateStorybookCsf, STORYBOOK_COMBINATION_LIMIT } from './storybook';
import { DEFAULT_OUTPUT_PREFERENCES, formatGeneratedCode, readOutputPreferences, selectCopyContent, type OutputPreferences } from './output-preferences';
import { normalizeHttpUrl, normalizeOptionalHttpUrl } from './external-url';
import { parseConnectionExport, serializeConnectionExport, type ConnectionExportEntry } from './connection-portability';
import { generateCodeConnectFile } from './code-connect';
import { renderImportLines } from './layout/imports';
import { GenerationContext } from './layout/generation-context';
import type { LayoutSourceNode } from './layout/figma-layout-extractor';
import {
  generateReactLayout,
  supportsReactLayout,
} from './layout/react-layout';
import type { ComponentUsage, ReactLayoutResult } from './layout/types';
import {
  generateVariantLogic,
  type VariantLogicResult,
} from './layout/variant-logic';
import { createSemanticNodeTree } from './semantic/figma-adapter';
import { extractFigmaSemanticSnapshot } from './semantic/figma-extractor';
import type { FigmaSemanticSnapshot } from './semantic/types';
import {
  resolveSemanticUsage,
  type SemanticRuntimeRequirement,
  type SemanticTargetExplanation,
} from './semantic/resolver';
import { createReactPropIdentifier } from './prop-mappings';
import { formatCssBlock } from './inspect/css-partition';
import { formatConnectedComponentsSnippet } from './inspect/usage-snippet';
import { inspectFrame, type InspectableNode } from './inspect/inspect-frame';
import type { ConnectedComponentEntry, FrameInspection } from './inspect/types';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type CanvasTargetStateHandler,
  type ClearConnectionHandler,
  type CloseHandler,
  type CodegenBlock,
  type ComponentConnectionStatus,
  type ComponentInventoryItem,
  type ConnectionCoverageReport,
  type ComponentInventoryStateHandler,
  type ComponentTargetStateHandler,
  type ConnectionIssue,
  type ConnectionMetadata,
  type ConnectionReferences,
  type FigmaComponentSnapshot,
  type FigmaPropertyDescriptor,
  type SourceComponentSnapshot,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type OpenComponentTargetHandler,
  type OpenExternalHandler,
  type PropMapping,
  type PropMappings,
  type PreviewTokensHandler,
  type PreviewTokensResultHandler,
  type RefreshSelectionHandler,
  type ResizeWindowHandler,
  type ScanComponentsHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type UiTargetState,
  type LoadTokenCollectionsHandler,
  type LoadTokenCollectionsResultHandler,
  type ExportTokensHandler,
  type ExportTokensResultHandler,
  type ApplyConnectionImportHandler,
  type ApplyConnectionImportResultHandler,
  type ExportConnectionsHandler,
  type ExportConnectionsResultHandler,
  type PreviewConnectionImportHandler,
  type PreviewConnectionImportResultHandler,
  type GenerateStoriesHandler,
  type GenerateStoriesResultHandler,
  type GenerateCodeConnectHandler,
  type GenerateCodeConnectResultHandler,
  type LoadOutputPreferencesHandler,
  type LoadOutputPreferencesResultHandler,
  type SaveOutputPreferencesHandler,
  type SaveOutputPreferencesResultHandler,
  type DocFrameSelectedHandler,
  type GenerateTokenDocsHandler,
  type GenerateTokenDocsResultHandler,
  type UpdateDocsInPlaceHandler,
  type UpdateDocsInPlaceResultHandler,
  type GenerateComponentDocsHandler,
  type GenerateComponentDocsResultHandler,
  type DocGenerationProgressHandler,
} from './types';
import {
  buildTokenDocDocument,
  type RawCollectionData,
  type RawVariableValue,
} from './documentation/token-doc-model';
import { diffComponentDocument, diffTokenDocument } from './documentation/doc-diff';
import { buildComponentDocDocument } from './documentation/component-doc-model';
import {
  emitComponentDocMarkdown,
  emitTokenDocMarkdown,
} from './documentation/markdown-emitter';
import {
  createComponentDocFrame,
  createTokenDocFrame,
} from './documentation/figma-canvas-writer';
import {
  readDocFrameMetadata,
  updateComponentDocFrameInPlace,
  updateTokenDocFrameInPlace,
} from './documentation/figma-canvas-updater';
import { diffTokenSnapshots } from './sync-tokens/export-diff';
import { createTokenSnapshot, serializeTokenCollection } from './sync-tokens/serialize-formats';
import type {
  AliasValue,
  ColorValue,
  ExportFile,
  ExportOptions,
  ResolvedTokenValue,
  Token,
  TokenCollection,
  TokenCollectionSummary,
  TokenExportWarning,
  TokenValue,
  VariableResolvedType,
} from './sync-tokens/types';

type ConnectableComponentNode = ComponentNode | ComponentSetNode;

type ResolvedSelection = {
  mainComponent: ConnectableComponentNode;
  componentProperties: Record<string, string | boolean>;
  displayText: string;
  instanceSwaps: Record<string, ResolvedInstanceSwap>;
};

type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { issue?: ConnectionIssue; ok: false; message: string };

type MutationTargetResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; message: string };

let latestSelectionRefreshRequestId = 0;
let latestComponentScanId: string | undefined;
let latestTargetRequestId: string | undefined;
const OUTPUT_PREFERENCES_KEY = 'tashil-output-preferences-v1';
const MAX_MULTI_SELECTION = 50;

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 880, height: 680 });

  on<ExportConnectionsHandler>('EXPORT_CONNECTIONS', () => { void exportConnections(); });
  on<PreviewConnectionImportHandler>('PREVIEW_CONNECTION_IMPORT', ({ raw }) => { void previewConnectionImport(raw); });
  on<ApplyConnectionImportHandler>('APPLY_CONNECTION_IMPORT', ({ choices }) => { void applyConnectionImport(choices); });
  on<GenerateStoriesHandler>('GENERATE_STORIES', (payload) => { void generateStories(payload.targetToken, payload.selectedVariantTokens); });
  on<GenerateCodeConnectHandler>('GENERATE_CODE_CONNECT', ({ targetToken }) => { void generateCodeConnect(targetToken); });
  on<LoadOutputPreferencesHandler>('LOAD_OUTPUT_PREFERENCES', () => { void emitOutputPreferences(); });
  on<SaveOutputPreferencesHandler>('SAVE_OUTPUT_PREFERENCES', ({ preferences }) => { void saveOutputPreferences(preferences); });

  on<SaveConnectionHandler>('SAVE_CONNECTION', (payload) => {
    void saveConnection(payload.metadata, payload.targetToken, payload.operationId);
  });

  on<ClearConnectionHandler>('CLEAR_CONNECTION', (payload) => {
    void clearConnection(payload.targetToken, payload.operationId);
  });

  on<RefreshSelectionHandler>('REFRESH_SELECTION', () => {
    runBestEffort(() => sendSelectionState('initial'));
  });

  on<ScanComponentsHandler>('SCAN_COMPONENTS', (payload) => {
    void scanComponents(payload.scanId, payload.includeCoverage === true);
  });

  on<OpenComponentTargetHandler>('OPEN_COMPONENT_TARGET', (payload) => {
    void sendComponentTargetState(payload.requestId, payload.targetToken);
  });

  on<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS', (payload) => {
    void scaffoldPropMappings(payload.targetToken, payload.operationId);
  });

  on<LoadTokenCollectionsHandler>('LOAD_TOKEN_COLLECTIONS', () => {
    void loadTokenCollections();
  });

  on<ExportTokensHandler>('EXPORT_TOKENS', (payload) => {
    void exportTokens(payload.operationId, payload.collectionIds, payload.options);
  });

  on<PreviewTokensHandler>('PREVIEW_TOKENS', (payload) => {
    void previewTokens(payload.operationId, payload.collectionIds, payload.options);
  });

  on<GenerateTokenDocsHandler>('GENERATE_TOKEN_DOCS', (payload) => {
    void generateTokenDocs(payload.collectionId, payload.targetFormat);
  });

  on<UpdateDocsInPlaceHandler>('UPDATE_DOCS_IN_PLACE', (payload) => {
    void updateDocsInPlace(payload.frameNodeId);
  });

  on<GenerateComponentDocsHandler>('GENERATE_COMPONENT_DOCS', (payload) => {
    void generateComponentDocs(payload.targetToken, payload.targetFormat);
  });

  on<OpenExternalHandler>('OPEN_EXTERNAL', (payload) => {
    openExternalReference(payload);
  });

  on<ResizeWindowHandler>('RESIZE_WINDOW', (size) => {
    figma.ui.resize(size.width, size.height);
  });

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin();
  });

  figma.on('selectionchange', () => {
    runBestEffort(() => sendSelectionState('selectionchange'));
  });
}

async function loadOutputPreferences(): Promise<OutputPreferences> {
  try {
    return readOutputPreferences(await figma.clientStorage?.getAsync(OUTPUT_PREFERENCES_KEY));
  } catch (_error) {
    return { ...DEFAULT_OUTPUT_PREFERENCES };
  }
}

async function emitOutputPreferences(): Promise<void> {
  emit<LoadOutputPreferencesResultHandler>('LOAD_OUTPUT_PREFERENCES_RESULT', {
    preferences: await loadOutputPreferences(),
  });
}

async function saveOutputPreferences(preferences: OutputPreferences): Promise<void> {
  try {
    const normalized = readOutputPreferences(preferences);
    await figma.clientStorage?.setAsync(OUTPUT_PREFERENCES_KEY, normalized);
    emit<SaveOutputPreferencesResultHandler>('SAVE_OUTPUT_PREFERENCES_RESULT', { ok: true });
  } catch (error) {
    emit<SaveOutputPreferencesResultHandler>('SAVE_OUTPUT_PREFERENCES_RESULT', {
      message: errorMessage(error, 'save output preferences'),
      ok: false,
    });
  }
}

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

async function generateMultiSelectionCodegenBlocks(
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

/**
 * Produce Dev Mode codegen blocks for a selected node. A connected component
 * with a valid connection follows the existing single-component branch,
 * byte-identical to before. Unconnected components and other supported design
 * roots produce a complete styled-components React module for their visible
 * subtree; selected-layer Layout and Style blocks remain additive.
 */
async function generateCodegenBlocks(node: SceneNode): Promise<CodegenBlock[]> {
  try {
    const selection = await resolveSelection(node);

    if (selection) {
      const connection = readConnectionMetadata(selection.mainComponent);
      if (!connection.ok && !connection.issue && supportsReactLayout(node)) {
        return generateLayoutAndInspectionBlocks(
          node,
          createSelectionVariantLogic(selection),
          createSelectionLayoutName(selection),
        );
      }
      return generateComponentCodegenBlocks(selection, node, connection);
    }

    if (supportsReactLayout(node)) {
      return generateLayoutAndInspectionBlocks(node);
    }

    return generateInspectionBlocks(await inspectSceneNode(node));
  } catch (error) {
    return [
      createPlainTextBlock(
        'Storybook Connect Error',
        error instanceof Error ? error.message : 'Unknown codegen error.',
      ),
    ];
  }
}

async function generateLayoutAndInspectionBlocks(
  node: SceneNode,
  variantLogic?: VariantLogicResult,
  rootName?: string,
): Promise<CodegenBlock[]> {
  const context = new GenerationContext();
  const [layoutResult, inspectionResult] = await Promise.allSettled([
    generateReactLayout(
      node as unknown as LayoutSourceNode,
      { context, rootName },
    ),
    inspectSceneNode(node, context),
  ]);
  const blocks: CodegenBlock[] = [];
  if (layoutResult.status === 'fulfilled') {
    blocks.push(...generateReactLayoutBlocks(layoutResult.value));
    if (variantLogic) {
      blocks.push({
        title: 'Variant logic',
        language: 'TYPESCRIPT',
        code: variantLogic.code,
      });
    }
  } else {
    blocks.push(createPlainTextBlock(
      'React generation notes',
      `React generation failed: ${formatUnexpectedError(layoutResult.reason)}`,
    ));
  }
  if (inspectionResult.status === 'fulfilled') {
    blocks.push(...generateInspectionBlocks(inspectionResult.value));
  } else {
    blocks.push(createPlainTextBlock(
      'Inspection notes',
      `Selected-layer inspection failed: ${formatUnexpectedError(inspectionResult.reason)}`,
    ));
  }
  return blocks;
}

/** Complete styled-components React module for a selected design tree. */
function generateReactLayoutBlocks(layout: ReactLayoutResult): CodegenBlock[] {
  const blocks: CodegenBlock[] = [
    {
      title: `${layout.componentName}.tsx`,
      language: 'TYPESCRIPT',
      code: layout.tsx,
    },
  ];

  const diagnostics = formatDiagnostics(layout.diagnostics);
  if (diagnostics) {
    blocks.push(createPlainTextBlock('React generation notes', diagnostics));
  }

  return blocks;
}

function formatUnexpectedError(error: unknown): string {
  return error instanceof Error && error.message.trim() !== ''
    ? error.message
    : 'Unknown error.';
}

/**
 * Connected-component branch. Legacy connections stay byte-identical; a
 * connection with a semantic recipe resolves through the semantic pipeline
 * shared with Inspect Code, adding runtime-requirement and explanation blocks.
 */
async function generateComponentCodegenBlocks(
  selection: ResolvedSelection,
  selectedNode: SceneNode,
  connection: ConnectionReadResult = readConnectionMetadata(selection.mainComponent),
): Promise<CodegenBlock[]> {
  if (!connection.ok) {
    return [
      createPlainTextBlock(
        'Storybook Connect',
        connection.message,
      ),
    ];
  }

  const output = await createConnectedOutput(connection.metadata, selection, selectedNode);
  const blocks: CodegenBlock[] = [
    {
      title: connection.metadata.componentName,
      language: 'TYPESCRIPT',
      code: output.code,
    },
  ];

  if (output.deprecation) {
    blocks.push(createPlainTextBlock('⚠️ Deprecated', output.deprecation));
  }

  if (output.runtimeRequirements) {
    blocks.push(createPlainTextBlock('Set in application', output.runtimeRequirements));
  }

  if (output.diagnostics) {
    blocks.push(createPlainTextBlock('Mapping diagnostics', output.diagnostics));
  }

  if (output.explanation) {
    blocks.push(createPlainTextBlock('Why this structure?', output.explanation));
  }

  const references = createReferenceText(connection.metadata);

  if (references) {
    blocks.push(createPlainTextBlock('References', references));
  }

  const stories = await createStorybookForSelection(
    connection.metadata,
    selection,
    undefined,
    selectedNode.type !== 'COMPONENT_SET',
  );
  if (stories.ok && stories.code) {
    blocks.push({
      title: `${connection.metadata.componentName}.stories.tsx`,
      language: 'TYPESCRIPT',
      code: stories.code,
    });
  } else if (stories.message) {
    blocks.push(createPlainTextBlock('Storybook stories', stories.message));
  }

  return blocks;
}

type ConnectedOutput = {
  code: string;
  diagnostics?: string;
  explanation?: string;
  runtimeRequirements?: string;
  deprecation?: string;
  usage: ComponentUsage;
};

/**
 * One generation pipeline for Dev Mode and Inspect Code. A semantic recipe
 * resolves nested design values against the selected node's own subtree (so
 * instance overrides win); legacy connections keep `createUsageSnippet`
 * byte-for-byte.
 */
async function createConnectedOutput(
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

function formatSemanticExplanations(
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

function formatRuntimeRequirements(
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

/** Inspect any single scene node through the shared inspection service. */
async function inspectSceneNode(
  node: SceneNode,
  context?: GenerationContext,
): Promise<FrameInspection> {
  return inspectFrame(node as unknown as InspectableNode, {
    context,
    loadTextStyle: loadFigmaTextStyle,
  });
}

async function loadFigmaTextStyle(id: string): Promise<{ name: string } | null> {
  const style = await figma.getStyleByIdAsync(id);
  return style ? { name: style.name } : null;
}

/**
 * The Dev Mode "Layer path comments" codegen preference (manifest
 * `codegenPreferences`). Defaults to shown; only an explicit "hide" turns the
 * `//./ …` source comments off. Guarded because `figma.codegen.preferences`
 * only exists in the Dev Mode runtime.
 */
function readPathCommentsPreference(): boolean {
  try {
    return figma.codegen.preferences?.customSettings?.['pathComments'] !== 'hide';
  } catch (_error) {
    return true;
  }
}

/**
 * Render a {@link FrameInspection} as Dev Mode blocks: Layout CSS, Style CSS
 * (omitted when empty), a Connected components TypeScript snippet with
 * deduplicated imports and per-usage layer-path comments, and diagnostics.
 */
function generateInspectionBlocks(inspection: FrameInspection): CodegenBlock[] {
  const blocks: CodegenBlock[] = [];

  if ((inspection.accessibility?.length ?? 0) > 0) {
    blocks.push(createPlainTextBlock(
      'Accessibility',
      inspection.accessibility!.map((finding) => `${finding.status === 'pass' ? '✓' : '⚠'} ${finding.message}`).join('\n'),
    ));
  }

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

  if (inspection.connectedComponents.length > 0) {
    blocks.push({
      title: 'Connected components',
      language: 'TYPESCRIPT',
      code: formatConnectedComponentsSnippet(inspection.connectedComponents, {
        pathComments: readPathCommentsPreference(),
      }),
    });
  }

  const diagnostics = formatDiagnostics(inspection.diagnostics);
  if (diagnostics) {
    blocks.push(createPlainTextBlock('Notes', diagnostics));
  }

  if (blocks.length === 0) {
    blocks.push(createPlainTextBlock(
      'Tashil Code',
      `"${inspection.nodeName}" has no CSS to show.`,
    ));
  }

  return blocks;
}

async function saveConnection(
  metadata: ConnectionMetadata,
  targetToken: string,
  operationId: string,
): Promise<void> {
  let selection: ResolvedSelection;
  let savedMetadata: ConnectionMetadata;

  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'save',
        operationId,
        targetToken,
      });
      return;
    }

    selection = result.selection;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'save',
        operationId,
        targetToken,
      });
      return;
    }

    const validation = validateConnectionMetadata(metadata);

    if (!validation.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: validation.message,
        operation: 'save',
        operationId,
        targetToken,
      });
      return;
    }

    const referenceUrls = normalizeConnectionReferenceUrlsForSave(metadata);

    if (!referenceUrls.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: referenceUrls.message,
        operation: 'save',
        operationId,
        targetToken,
      });
      return;
    }

    const savedAt = new Date().toISOString();
    const connectionMetadata: ConnectionMetadata = {
      ...metadata,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sourceUrl: referenceUrls.sourceUrl,
      storybookUrl: referenceUrls.storybookUrl,
      updatedAt: savedAt,
      ...(metadata.mappingDocument ? {
        mappingDocument: {
          ...metadata.mappingDocument,
          figmaSnapshot: createFigmaComponentSnapshot(selection.mainComponent),
          lastValidatedAt: savedAt,
          revision: metadata.mappingDocument.revision + 1,
        },
      } : {}),
    };

    selection.mainComponent.setSharedPluginData(
      CONNECTION_NAMESPACE,
      CONNECTION_KEY,
      JSON.stringify(connectionMetadata),
    );
    savedMetadata = connectionMetadata;
  } catch (error) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: createMutationFailureMessage('save the connection', error),
      operation: 'save',
      operationId,
      targetToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection saved.',
    operation: 'save',
    operationId,
    targetState: await createTargetState(
      selection,
      { metadata: savedMetadata, ok: true },
    ),
    targetToken,
  });
  runBestEffort(() => {
    figma.notify(`${metadata.componentName} connected to Storybook`);
  });
  runBestEffort(() => sendSelectionState('refresh'));
}

async function clearConnection(
  targetToken: string,
  operationId: string,
): Promise<void> {
  let selection: ResolvedSelection;

  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'clear',
        operationId,
        targetToken,
      });
      return;
    }

    selection = result.selection;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'clear',
        operationId,
        targetToken,
      });
      return;
    }

    selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, '');
  } catch (error) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: createMutationFailureMessage('clear the connection', error),
      operation: 'clear',
      operationId,
      targetToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection cleared.',
    operation: 'clear',
    operationId,
    targetState: await createTargetState(
      selection,
      {
        ok: false,
        message: 'This component is ready to connect.',
      },
    ),
    targetToken,
  });
  runBestEffort(() => {
    figma.notify('Storybook connection cleared');
  });
  runBestEffort(() => sendSelectionState('refresh'));
}

/**
 * Build a prop-mapping skeleton from the selected component's
 * `componentPropertyDefinitions`. Every VARIANT property becomes a mapping
 * group; each of its `variantOptions` maps to a normalized React prop name.
 * Active INSTANCE_SWAP properties also get a mapping from component ID to
 * the selected component name so codegen can keep resolving future swaps.
 */
async function scaffoldPropMappings(
  targetToken: string,
  operationId: string,
): Promise<void> {
  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: result.message,
        operationId,
        targetToken,
      });
      return;
    }

    const { selection } = result;

    const propertyDefinitions = selection.mainComponent.componentPropertyDefinitions;
    const mappings = createDictionary<Record<string, PropMapping>>() as PropMappings;
    const unsupportedProperties: string[] = [];

    for (const [propertyName, definition] of Object.entries(propertyDefinitions)) {
      if (definition.type !== 'VARIANT' && definition.type !== 'INSTANCE_SWAP') {
        continue;
      }

      const normalizedPropertyName = normalizeComponentPropertyName(propertyName);
      const reactProp = definition.type === 'INSTANCE_SWAP'
        ? createInstanceSwapReactPropIdentifier(normalizedPropertyName)
        : createReactPropIdentifier(normalizedPropertyName);
      if (!reactProp) {
        unsupportedProperties.push(propertyName);
        continue;
      }

      const group = createDictionary<PropMapping>();

      if (definition.type === 'VARIANT') {
        for (const option of definition.variantOptions ?? []) {
          group[option] = { prop: reactProp, value: option };
        }
      } else if (definition.type === 'INSTANCE_SWAP') {
        const instanceSwap = selection.instanceSwaps[normalizedPropertyName]
          ?? (typeof definition.defaultValue === 'string'
            ? await resolveInstanceSwapComponent(definition.defaultValue)
            : undefined);

        if (instanceSwap) {
          const mappingKey = isIconRenderProp(reactProp)
            ? '*'
            : instanceSwap.componentId;
          group[mappingKey] = {
            prop: reactProp,
            value: isIconRenderProp(reactProp)
              ? '$instanceSwap'
              : instanceSwap.componentName,
          };
        }
      } else {
        continue;
      }

      if (Object.keys(group).length > 0) {
        mappings[normalizedPropertyName] = group;
      }
    }

    if (unsupportedProperties.length > 0) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: [
          'Could not generate valid React prop names for Figma properties:',
          unsupportedProperties.map((propertyName) => JSON.stringify(propertyName)).join(', '),
          'Rename them using letters or numbers, or enter mappings manually.',
        ].join(' '),
        operationId,
        targetToken,
      });
      return;
    }

    if (Object.keys(mappings).length === 0) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'No variant or active instance-swap properties found on this component to scaffold.',
        operationId,
        targetToken,
      });
      return;
    }

    if (!isPropMappings(mappings)) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'Generated prop mappings were invalid. Rename the Figma variant properties or enter mappings manually.',
        operationId,
        targetToken,
      });
      return;
    }

    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: true,
      mappings,
      operationId,
      targetToken,
    });
  } catch (error) {
    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: false,
      message: createMutationFailureMessage('generate prop mappings', error),
      operationId,
      targetToken,
    });
  }
}

function createMutationFailureMessage(action: string, error: unknown): string {
  const detail = error instanceof Error && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not ${action}.${detail}`;
}

function runBestEffort(effect: () => void | Promise<void>): void {
  try {
    void Promise.resolve(effect()).catch(() => undefined);
  } catch {
    // Event entry points and post-mutation effects must not leak host failures.
  }
}

// --- Sync Tokens: enumerate Variable collections and serialize to CSS. ---

async function loadTokenCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const summaries: TokenCollectionSummary[] = collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
      defaultModeId: collection.defaultModeId,
      tokenCount: collection.variableIds.length,
    }));
    emit<LoadTokenCollectionsResultHandler>('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: true,
      collections: summaries,
    });
  } catch (error) {
    emit<LoadTokenCollectionsResultHandler>('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: false,
      message: errorMessage(error, 'load variable collections'),
    });
  }
}

// ponytail: track the latest export operation so a superseded request's late
// resolve is ignored — mirrors the scanComponents stale-guard.
let latestTokensExportId = '';
let latestTokensPreviewId = '';
const TOKEN_EXPORT_HISTORY_KEY = 'tashil-token-export-history-v1';

async function exportTokens(
  operationId: string,
  collectionIds: readonly string[],
  options: ExportOptions,
): Promise<void> {
  latestTokensExportId = operationId;
  try {
    const files = await generateTokenFiles(
      collectionIds,
      options,
      () => latestTokensExportId === operationId,
    );
    if (files === null) {
      return;
    }
    await saveTokenExportHistory(files);
    emit<ExportTokensResultHandler>('EXPORT_TOKENS_RESULT', {
      ok: true,
      operationId,
      files,
    });
  } catch (error) {
    if (latestTokensExportId !== operationId) {
      return;
    }
    emit<ExportTokensResultHandler>('EXPORT_TOKENS_RESULT', {
      ok: false,
      operationId,
      message: errorMessage(error, 'export tokens'),
    });
  }
}

async function previewTokens(
  operationId: string,
  collectionIds: readonly string[],
  options: ExportOptions,
): Promise<void> {
  latestTokensPreviewId = operationId;
  try {
    const files = await generateTokenFiles(
      collectionIds,
      options,
      () => latestTokensPreviewId === operationId,
    );
    if (files === null) {
      return;
    }
    emit<PreviewTokensResultHandler>('PREVIEW_TOKENS_RESULT', {
      ok: true,
      operationId,
      files,
    });
  } catch (error) {
    if (latestTokensPreviewId !== operationId) {
      return;
    }
    emit<PreviewTokensResultHandler>('PREVIEW_TOKENS_RESULT', {
      ok: false,
      operationId,
      message: errorMessage(error, 'preview tokens'),
    });
  }
}

async function generateTokenFiles(
  collectionIds: readonly string[],
  options: ExportOptions,
  isCurrent: () => boolean,
): Promise<ExportFile[] | null> {
  const wantSet = new Set(collectionIds);
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const collectionsById = new Map(
    collections.map((collection) => [collection.id, collection]),
  );
  const variablesById = new Map(
    variables.map((variable) => [variable.id, variable]),
  );
  const files: ExportFile[] = [];
  const previousHistory = await loadTokenExportHistory();

  for (const collection of collections) {
    if (!isCurrent()) {
      return null;
    }
    if (!wantSet.has(collection.id)) {
      continue;
    }
    // One CSS file per selected mode. Falls back to the default mode if none
    // were explicitly chosen (keeps a bare "export this" click working).
    const modeIds = options.modesByCollection[collection.id] ?? [collection.defaultModeId];
    const collectionSlug = slug(collection.name) || collection.id;
    for (const modeId of modeIds) {
      if (!isCurrent()) {
        return null;
      }
      const mode = collection.modes.find((item) => item.modeId === modeId);
      const warnings: TokenExportWarning[] = [];
      const configuredOverrides =
        options.aliasModeOverridesByCollectionMode?.[collection.id]?.[modeId] ?? {};
      const resolvedModeIds = new Map<string, string>([[collection.id, modeId]]);
      for (const [targetCollectionId, targetModeId] of Object.entries(configuredOverrides)) {
        const targetCollection = collectionsById.get(targetCollectionId);
        if (targetCollection?.modes.some((item) => item.modeId === targetModeId)) {
          resolvedModeIds.set(targetCollectionId, targetModeId);
        }
      }
      const tokens = await collectTokens(collection, modeId, {
        collectionsById,
        modeFallbackKeys: new Set(),
        modeIdsByCollection: resolvedModeIds,
        preferredModeName: mode?.name ?? '',
        sourceCollectionId: collection.id,
        sourceModeId: modeId,
        variablesById,
        warnings,
      }, options);
      const domain: TokenCollection = {
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((item) => ({
          modeId: item.modeId,
          name: item.name,
        })),
        defaultModeId: collection.defaultModeId,
        tokens,
      };
      const suffix = collection.modes.length > 1 && mode ? `-${slug(mode.name)}` : '';
      const serialized = serializeTokenCollection(domain, options);
      const name = `${collectionSlug}${suffix}.${serialized.extension}`;
      const tokenSnapshot = createTokenSnapshot(tokens);
      files.push({
        name,
        css: serialized.content,
        declarationCount: tokens.length,
        sourceVariableCount: collection.variableIds.length,
        warnings,
        diff: diffTokenSnapshots(previousHistory[name], tokenSnapshot),
        tokenSnapshot,
      });
    }
  }

  return files;
}

type TokenExportHistory = Record<string, Record<string, string>>;

async function loadTokenExportHistory(): Promise<TokenExportHistory> {
  try {
    const value = await figma.clientStorage?.getAsync(TOKEN_EXPORT_HISTORY_KEY) as unknown;
    return isRecord(value) ? value as TokenExportHistory : {};
  } catch (_error) {
    return {};
  }
}

async function saveTokenExportHistory(files: readonly ExportFile[]): Promise<void> {
  try {
    const previous = await loadTokenExportHistory();
    const next: TokenExportHistory = { ...previous };
    for (const file of files) next[file.name] = { ...(file.tokenSnapshot ?? {}) };
    await figma.clientStorage?.setAsync(TOKEN_EXPORT_HISTORY_KEY, next);
  } catch (_error) {
    // Export history is informational and must never block a download.
  }
}

type TokenResolutionContext = {
  collectionsById: Map<string, VariableCollection>;
  modeFallbackKeys: Set<string>;
  modeIdsByCollection: Map<string, string>;
  preferredModeName: string;
  sourceCollectionId: string;
  sourceModeId: string;
  variablesById: Map<string, Variable>;
  warnings: TokenExportWarning[];
};

async function collectTokens(
  collection: VariableCollection,
  modeId: string,
  context: TokenResolutionContext,
  options: ExportOptions,
): Promise<Token[]> {
  const tokens: Token[] = [];
  for (const variableId of collection.variableIds) {
    const variable = await getVariable(variableId, context);
    if (variable === null) {
      context.warnings.push({
        code: 'missing-variable',
        message: `Variable ${variableId} is no longer available.`,
      });
      continue;
    }
    const raw = variable.valuesByMode[modeId];
    if (raw === undefined) {
      context.warnings.push({
        code: 'missing-mode-value',
        message: `No value exists for the selected mode.`,
        tokenName: variable.name,
      });
      continue;
    }
    const value = await normalizeValue(raw, variable.resolvedType, context);
    if (value === null) {
      context.warnings.push({
        code: 'unsupported-value',
        message: `The value type cannot be exported as CSS.`,
        tokenName: variable.name,
      });
      continue;
    }
    if (value.kind === 'alias' && value.value.resolvedValue === undefined) {
      context.warnings.push({
        code: 'unresolved-alias',
        message: `The referenced variable could not be resolved; the var() reference was preserved.`,
        tokenName: variable.name,
      });
    }
    if (
      options.convertPxToRem
      && variable.resolvedType === 'FLOAT'
      && (variable.scopes.length === 0 || variable.scopes.includes('ALL_SCOPES'))
      && tokenValueContainsNumber(value)
    ) {
      context.warnings.push({
        code: 'unknown-number-scope',
        message: `The numeric value stayed unitless because its Figma scope does not identify a length.`,
        tokenName: variable.name,
      });
    }
    tokens.push({
      id: variable.id,
      name: variable.name,
      resolvedType: variable.resolvedType as VariableResolvedType,
      scopes: variable.scopes as readonly string[],
      value,
    });
  }
  return tokens;
}

async function getVariable(
  variableId: string,
  context: TokenResolutionContext,
): Promise<Variable | null> {
  const cached = context.variablesById.get(variableId);
  if (cached !== undefined) {
    return cached;
  }
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (variable !== null) {
    context.variablesById.set(variable.id, variable);
  }
  return variable;
}

function tokenValueContainsNumber(value: TokenValue): boolean {
  return value.kind === 'number'
    || (value.kind === 'alias' && value.value.resolvedValue?.kind === 'number');
}

async function normalizeValue(
  raw: VariableValue,
  resolvedType: VariableResolvedDataType,
  context: TokenResolutionContext,
): Promise<TokenValue | null> {
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw };
  }
  if (typeof raw === 'number') {
    return { kind: 'number', value: raw };
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw };
  }
  // Object shapes: alias, RGB, RGBA.
  const maybeAlias = raw as { type?: string; id?: string };
  if (maybeAlias.type === 'VARIABLE_ALIAS' && typeof maybeAlias.id === 'string') {
    const target = await getVariable(maybeAlias.id, context);
    const targetName = target?.name ?? maybeAlias.id;
    const resolvedValue = target === null
      ? null
      : await resolveVariableValue(target, context, new Set());
    const alias: AliasValue = {
      targetName,
      ...(resolvedValue === null ? {} : { resolvedValue }),
    };
    return { kind: 'alias', value: alias };
  }
  if (resolvedType === 'COLOR' || isColorShape(raw)) {
    const color = toColorValue(raw);
    if (color !== null) {
      return { kind: 'color', value: color };
    }
  }
  return null;
}

async function resolveVariableValue(
  variable: Variable,
  context: TokenResolutionContext,
  visitedVariableIds: Set<string>,
): Promise<ResolvedTokenValue | null> {
  if (visitedVariableIds.has(variable.id)) {
    return null;
  }
  visitedVariableIds.add(variable.id);

  const modeId = await resolveVariableModeId(variable, context);
  if (modeId === null) {
    return null;
  }
  const raw = variable.valuesByMode[modeId];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw === 'object' && raw !== null) {
    const alias = raw as { type?: string; id?: string };
    if (alias.type === 'VARIABLE_ALIAS' && typeof alias.id === 'string') {
      const target = await getVariable(alias.id, context);
      return target === null
        ? null
        : resolveVariableValue(target, context, visitedVariableIds);
    }
  }
  return normalizeResolvedValue(raw, variable.resolvedType);
}

async function resolveVariableModeId(
  variable: Variable,
  context: TokenResolutionContext,
): Promise<string | null> {
  const cachedModeId = context.modeIdsByCollection.get(variable.variableCollectionId);
  if (cachedModeId !== undefined) {
    return cachedModeId;
  }

  let collection = context.collectionsById.get(variable.variableCollectionId);
  if (collection === undefined) {
    collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId,
    ) ?? undefined;
    if (collection !== undefined) {
      context.collectionsById.set(collection.id, collection);
    }
  }
  if (collection === undefined) {
    return null;
  }

  const preferredModeName = context.preferredModeName.trim().toLocaleLowerCase();
  const matchingMode = preferredModeName.length === 0
    ? undefined
    : collection.modes.find(
      (mode) => mode.name.trim().toLocaleLowerCase() === preferredModeName,
    );
  const modeId = matchingMode?.modeId ?? collection.defaultModeId;
  if (matchingMode === undefined && preferredModeName.length > 0) {
    const fallbackKey = `${collection.id}:${preferredModeName}`;
    if (!context.modeFallbackKeys.has(fallbackKey)) {
      const fallbackMode = collection.modes.find(
        (mode) => mode.modeId === collection.defaultModeId,
      );
      context.modeFallbackKeys.add(fallbackKey);
      context.warnings.push({
        code: 'mode-fallback',
        message: `No “${context.preferredModeName}” mode exists in ${collection.name}; using ${fallbackMode?.name ?? 'its default mode'}.`,
        tokenName: variable.name,
        sourceCollectionId: context.sourceCollectionId,
        sourceModeId: context.sourceModeId,
        targetCollectionId: collection.id,
        fallbackModeId: modeId,
      });
    }
  }
  context.modeIdsByCollection.set(collection.id, modeId);
  return modeId;
}

function normalizeResolvedValue(
  raw: VariableValue,
  resolvedType: VariableResolvedDataType,
): ResolvedTokenValue | null {
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw };
  }
  if (typeof raw === 'number') {
    return { kind: 'number', value: raw };
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw };
  }
  if (resolvedType === 'COLOR' || isColorShape(raw)) {
    const color = toColorValue(raw);
    return color === null ? null : { kind: 'color', value: color };
  }
  return null;
}

function isColorShape(value: unknown): value is { r: number; g: number; b: number; a?: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { r, g, b } = value as { r?: unknown; g?: unknown; b?: unknown };
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number';
}

function toColorValue(value: unknown): ColorValue | null {
  if (!isColorShape(value)) {
    return null;
  }
  return 'a' in value ? { r: value.r, g: value.g, b: value.b, a: value.a } : { r: value.r, g: value.g, b: value.b };
}

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function errorMessage(error: unknown, action: string): string {
  return error instanceof Error
    ? `Could not ${action}: ${error.message}`
    : `Could not ${action}.`;
}

async function resolveSelection(node: SceneNode): Promise<ResolvedSelection | null> {
  if (node.type === 'INSTANCE') {
    const mainComponent = await node.getMainComponentAsync();

    if (!mainComponent) {
      return null;
    }

    const connectionTarget = getConnectionTarget(mainComponent);
    const propertySources = [connectionTarget, mainComponent, node];

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, mainComponent, connectionTarget),
      displayText: getDisplayText(node),
      instanceSwaps: await collectInstanceSwaps(propertySources),
    };
  }

  if (node.type === 'COMPONENT') {
    const connectionTarget = getConnectionTarget(node);
    const propertySources = [connectionTarget, node];

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, node, connectionTarget),
      displayText: getDisplayText(node),
      instanceSwaps: await collectInstanceSwaps(propertySources),
    };
  }

  if (node.type === 'COMPONENT_SET') {
    return {
      mainComponent: node,
      componentProperties: readComponentProperties(node),
      displayText: node.name,
      instanceSwaps: await collectInstanceSwaps([node]),
    };
  }

  return null;
}

async function collectInstanceSwaps(
  nodes: ReadonlyArray<InstanceNode | ComponentNode | ComponentSetNode>,
): Promise<Record<string, ResolvedInstanceSwap>> {
  const instanceSwaps = createDictionary<ResolvedInstanceSwap>();
  const visitedNodeIds = new Set<string>();

  for (const node of nodes) {
    if (visitedNodeIds.has(node.id) || !('componentProperties' in node)) {
      continue;
    }
    visitedNodeIds.add(node.id);

    for (const [propertyName, property] of Object.entries(node.componentProperties)) {
      if (property.type !== 'INSTANCE_SWAP' || typeof property.value !== 'string') {
        continue;
      }

      const instanceSwap = await resolveInstanceSwapComponent(property.value);
      if (!instanceSwap) {
        continue;
      }

      instanceSwaps[normalizeComponentPropertyName(propertyName)] = instanceSwap;
    }
  }

  return instanceSwaps;
}

async function resolveInstanceSwapComponent(
  componentId: string,
): Promise<ResolvedInstanceSwap | undefined> {
  let component: BaseNode | null;

  try {
    component = await figma.getNodeByIdAsync(componentId);
  } catch (_error) {
    return undefined;
  }

  if (component?.type !== 'COMPONENT') {
    return undefined;
  }

  return {
    componentId,
    componentName: component.name,
  };
}

function createInstanceSwapReactPropIdentifier(figmaPropertyName: string): string | null {
  const normalized = createReactPropIdentifier(figmaPropertyName);

  if (normalized === 'leadingIcon' || normalized === 'leftIcon') {
    return 'renderRightIcon';
  }

  if (normalized === 'trailingIcon' || normalized === 'rightIcon') {
    return 'renderLeftIcon';
  }

  return normalized;
}

function isIconRenderProp(prop: string): boolean {
  return prop === 'renderLeftIcon' || prop === 'renderRightIcon';
}

async function resolveTargetById(targetToken: string): Promise<MutationTargetResult> {
  let node: BaseNode | null;

  try {
    node = await figma.getNodeByIdAsync(targetToken);
  } catch (_error) {
    node = null;
  }

  if (
    !node
    || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')
    || node.remote
  ) {
    return {
      ok: false,
      message: 'This component is no longer available. Scan the file again and retry.',
    };
  }

  const selection = await resolveSelection(node);

  if (
    !selection
    || selection.mainComponent.id !== targetToken
    || selection.mainComponent.remote
  ) {
    return {
      ok: false,
      message: 'This component changed after the last scan. Scan the file again and retry.',
    };
  }

  return { ok: true, selection };
}

async function sendComponentTargetState(
  requestId: string,
  targetToken: string,
): Promise<void> {
  latestTargetRequestId = requestId;

  try {
    const result = await resolveTargetById(targetToken);
    if (latestTargetRequestId !== requestId) {
      return;
    }

    const state = result.ok
      ? await createTargetState(
          result.selection,
          readConnectionMetadata(result.selection.mainComponent),
        )
      : { status: 'empty' as const, message: result.message };

    emit<ComponentTargetStateHandler>('COMPONENT_TARGET_STATE', {
      requestId,
      state,
    });
  } catch (error) {
    if (latestTargetRequestId !== requestId) {
      return;
    }

    emit<ComponentTargetStateHandler>('COMPONENT_TARGET_STATE', {
      requestId,
      state: {
        status: 'empty',
        message: createTargetRefreshFailureMessage(error),
      },
    });
  }
}

async function collectLocalConnectionTargets(): Promise<ConnectableComponentNode[]> {
  const targets: ConnectableComponentNode[] = [];
  const seen = new Set<string>();
  for (const page of figma.root.children) {
    await page.loadAsync();
    for (const node of page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
      if (node.remote || (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET')) continue;
      if (!seen.has(node.id)) { seen.add(node.id); targets.push(node); }
    }
  }
  return targets;
}

async function exportConnections(): Promise<void> {
  try {
    const entries: ConnectionExportEntry[] = [];
    for (const target of await collectLocalConnectionTargets()) {
      const connection = readConnectionMetadata(target);
      if (!connection.ok) continue;
      entries.push({
        connection: connection.metadata,
        locator: {
          componentKey: target.key,
          figmaComponentName: target.name,
          nodeType: target.type,
          pageName: getTargetPageName(target),
        },
      });
    }
    emit<ExportConnectionsResultHandler>('EXPORT_CONNECTIONS_RESULT', {
      json: serializeConnectionExport(entries, '1.0.0', new Date().toISOString()),
      ok: true,
    });
  } catch (error) {
    emit<ExportConnectionsResultHandler>('EXPORT_CONNECTIONS_RESULT', { ok: false, message: errorMessage(error, 'export connections') });
  }
}

async function previewConnectionImport(raw: string): Promise<void> {
  const parsed = parseConnectionExport(raw);
  if (!parsed.ok) {
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', parsed);
    return;
  }
  try {
    const targets = await collectLocalConnectionTargets();
    const byKey = new Map(targets.map((target) => [target.key, target]));
    const byIdentity = new Map<string, ConnectableComponentNode[]>();
    for (const target of targets) {
      const key = connectionTargetIdentity(target.type, target.name, getTargetPageName(target));
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), target]);
    }
    const entries = parsed.document.connections.map(({ connection, locator }) => {
      const identityMatches = byIdentity.get(connectionTargetIdentity(
        locator.nodeType,
        locator.figmaComponentName,
        locator.pageName,
      ));
      // Component keys are the strongest locator. The unique name/type/page
      // fallback keeps exports useful after a file duplication changes keys.
      const target = byKey.get(locator.componentKey)
        ?? (identityMatches?.length === 1 ? identityMatches[0] : undefined);
      if (!target) return { componentName: locator.figmaComponentName, imported: connection, status: 'missing' as const };
      const current = readConnectionMetadata(target);
      return {
        componentName: target.name,
        imported: connection,
        status: current.ok ? 'conflict' as const : 'matched' as const,
        targetToken: target.id,
      };
    });
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', { entries, ok: true });
  } catch (error) {
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', { ok: false, message: errorMessage(error, 'preview connection import') });
  }
}

function getTargetPageName(target: ConnectableComponentNode): string {
  let parent = target.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') parent = parent.parent;
  return parent?.type === 'PAGE' ? parent.name : '';
}

function connectionTargetIdentity(nodeType: string, componentName: string, pageName: string): string {
  return `${nodeType}\u0000${pageName}\u0000${componentName}`;
}

async function applyConnectionImport(choices: Array<{ action: 'overwrite' | 'skip'; imported: ConnectionMetadata; targetToken: string }>): Promise<void> {
  let applied = 0;
  try {
    for (const choice of choices) {
      if (choice.action === 'skip') continue;
      const validation = validateConnectionMetadata(choice.imported);
      if (!validation.ok) throw new Error(validation.message);
      const resolved = await resolveTargetById(choice.targetToken);
      if (!resolved.ok) throw new Error(resolved.message);
      resolved.selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, JSON.stringify(choice.imported));
      applied += 1;
    }
    emit<ApplyConnectionImportResultHandler>('APPLY_CONNECTION_IMPORT_RESULT', { applied, ok: true });
  } catch (error) {
    emit<ApplyConnectionImportResultHandler>('APPLY_CONNECTION_IMPORT_RESULT', { applied, ok: false, message: errorMessage(error, 'apply connection import') });
  }
}

async function generateStories(targetToken: string, selectedVariantTokens?: string[]): Promise<void> {
  try {
    const resolved = await resolveTargetById(targetToken);
    if (!resolved.ok) throw new Error(resolved.message);
    const connection = readConnectionMetadata(resolved.selection.mainComponent);
    if (!connection.ok) throw new Error(connection.message);
    const result = await createStorybookForSelection(
      connection.metadata,
      resolved.selection,
      selectedVariantTokens,
      false,
    );
    const preferences = await loadOutputPreferences();
    emit<GenerateStoriesResultHandler>('GENERATE_STORIES_RESULT', result.code
      ? { ...result, code: formatGeneratedCode(result.code, preferences) }
      : result);
  } catch (error) {
    emit<GenerateStoriesResultHandler>('GENERATE_STORIES_RESULT', {
      message: errorMessage(error, 'generate stories'),
      ok: false,
    });
  }
}

async function generateCodeConnect(targetToken: string): Promise<void> {
  try {
    const resolved = await resolveTargetById(targetToken);
    if (!resolved.ok) throw new Error(resolved.message);
    const connection = readConnectionMetadata(resolved.selection.mainComponent);
    if (!connection.ok) throw new Error(connection.message);
    if (!figma.fileKey) throw new Error('Save this Figma file before generating Code Connect output.');
    const output = await createConnectedOutput(
      connection.metadata,
      resolved.selection,
      resolved.selection.mainComponent,
    );
    const nodeId = resolved.selection.mainComponent.id.replace(/:/g, '-');
    const componentUrl = `https://www.figma.com/design/${figma.fileKey}?node-id=${encodeURIComponent(nodeId)}`;
    emit<GenerateCodeConnectResultHandler>('GENERATE_CODE_CONNECT_RESULT', {
      ...generateCodeConnectFile(connection.metadata.componentName, componentUrl, output.usage),
      ok: true,
    });
  } catch (error) {
    emit<GenerateCodeConnectResultHandler>('GENERATE_CODE_CONNECT_RESULT', {
      message: errorMessage(error, 'generate Code Connect output'),
      ok: false,
    });
  }
}

async function createStorybookForSelection(
  metadata: ConnectionMetadata,
  selection: ResolvedSelection,
  selectedVariantTokens?: readonly string[],
  allowCurrentSelectionFallback = true,
): Promise<Parameters<GenerateStoriesResultHandler['handler']>[0]> {
  const target = selection.mainComponent;
  if (target.type !== 'COMPONENT_SET') {
    return {
      code: generateStorybookCsf(metadata.componentName, [{
        name: 'Default',
        usage: createComponentUsage(metadata, selection),
      }]),
      fileName: `${metadata.componentName}.stories.tsx`,
      ok: true,
    };
  }

  const variants = target.children.filter((child): child is ComponentNode => child.type === 'COMPONENT');
  if (selectedVariantTokens === undefined && variants.length > STORYBOOK_COMBINATION_LIMIT) {
    if (allowCurrentSelectionFallback) {
      return {
        code: generateStorybookCsf(metadata.componentName, [{
          name: createVariantStoryName(selection.componentProperties),
          usage: createComponentUsage(metadata, selection),
        }]),
        fileName: `${metadata.componentName}.stories.tsx`,
        ok: true,
      };
    }
    return {
      message: `This component set has ${variants.length} combinations. Select up to ${STORYBOOK_COMBINATION_LIMIT} to generate.`,
      ok: false,
      variants: variants.map((variant) => ({ label: variant.name, targetToken: variant.id })),
    };
  }

  const selected = selectedVariantTokens === undefined
    ? variants
    : variants.filter((variant) => selectedVariantTokens.includes(variant.id));
  if (selected.length === 0) return { message: 'Select at least one variant.', ok: false };
  if (selected.length > STORYBOOK_COMBINATION_LIMIT) return { message: `Select no more than ${STORYBOOK_COMBINATION_LIMIT} variants.`, ok: false };
  const stories = [];
  for (const variant of selected) {
    const variantSelection = await resolveSelection(variant);
    if (!variantSelection) continue;
    stories.push({ name: variant.name, usage: createComponentUsage(metadata, variantSelection) });
  }
  return {
    code: generateStorybookCsf(metadata.componentName, stories),
    fileName: `${metadata.componentName}.stories.tsx`,
    ok: true,
  };
}

function createVariantStoryName(properties: Readonly<Record<string, string | boolean>>): string {
  const values = Object.values(properties).filter((value): value is string => typeof value === 'string');
  return values.length > 0 ? values.join(' ') : 'Selected variant';
}

async function scanComponents(scanId: string, includeCoverage = false): Promise<void> {
  latestComponentScanId = scanId;

  try {
    const pages = [...figma.root.children];
    const totalPages = pages.length;
    const items: ComponentInventoryItem[] = [];
    const skippedPageNames: string[] = [];
    const seenTargetTokens = new Set<string>();
    const instanceCounts = new Map<string, number>();
    const coverage: ConnectionCoverageReport | undefined = includeCoverage ? {
      brokenInstanceCount: 0,
      brokenInstances: [],
      connectedInstanceCount: 0,
      totalInstanceCount: 0,
    } : undefined;

    emitInventoryState(scanId, {
      scannedPages: 0,
      status: 'scanning',
      totalPages,
    });

    for (let index = 0; index < pages.length; index += 1) {
      if (latestComponentScanId !== scanId) {
        return;
      }

      const page = pages[index];
      try {
        await page.loadAsync();
        const nodes = page.findAllWithCriteria({
          types: ['COMPONENT', 'COMPONENT_SET'],
        });

        for (const node of nodes) {
          if (
            node.remote
            || (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET')
            || seenTargetTokens.has(node.id)
          ) {
            continue;
          }

          seenTargetTokens.add(node.id);
          items.push({
            componentName: node.name,
            nodeType: node.type,
            pageName: page.name,
            status: getInventoryConnectionStatus(node),
            targetToken: node.id,
          });
        }

        // Keep the runtime guard even though Figma types this query precisely;
        // it also makes the scan resilient to incomplete test/plugin-host shims.
        const instances = includeCoverage
          ? page.findAllWithCriteria({ types: ['INSTANCE'] })
            .filter((node): node is InstanceNode => node.type === 'INSTANCE')
          : [];
        for (let offset = 0; coverage && offset < instances.length; offset += 40) {
          if (latestComponentScanId !== scanId) return;
          const chunk = instances.slice(offset, offset + 40);
          await Promise.all(chunk.map(async (instance) => {
            coverage.totalInstanceCount += 1;
            const mainComponent = await instance.getMainComponentAsync();
            if (!mainComponent) {
              coverage.brokenInstanceCount += 1;
              if (coverage.brokenInstances.length < 100) {
                coverage.brokenInstances.push({
                  layerPath: getNodeLayerPath(instance),
                  pageName: page.name,
                });
              }
              return;
            }
            const target = getConnectionTarget(mainComponent);
            instanceCounts.set(target.id, (instanceCounts.get(target.id) ?? 0) + 1);
            if (readConnectionMetadata(target).ok) coverage.connectedInstanceCount += 1;
          }));
          // Yield between bounded chunks so large files do not monopolize Figma's thread.
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } catch (_error) {
        skippedPageNames.push(page.name);
      }

      emitInventoryState(scanId, {
        scannedPages: index + 1,
        status: 'scanning',
        totalPages,
      });
    }

    if (latestComponentScanId !== scanId) {
      return;
    }

    if (coverage) {
      for (const item of items) item.instanceCount = instanceCounts.get(item.targetToken) ?? 0;
    }
    items.sort((first, second) => (
      (coverage ? (second.instanceCount ?? 0) - (first.instanceCount ?? 0) : 0)
      || first.componentName.localeCompare(second.componentName, undefined, {
        sensitivity: 'base',
      })
      || first.pageName.localeCompare(second.pageName, undefined, {
        sensitivity: 'base',
      })
    ));

    if (skippedPageNames.length > 0) {
      emitInventoryState(scanId, {
        ...(coverage ? { coverage } : {}),
        items,
        message: [
          `${skippedPageNames.length} page${skippedPageNames.length === 1 ? '' : 's'} could not be scanned.`,
          `Skipped: ${skippedPageNames.join(', ')}.`,
        ].join(' '),
        scannedPages: totalPages,
        skippedPageNames,
        status: 'partial',
        totalPages,
      });
      return;
    }

    emitInventoryState(scanId, {
      ...(coverage ? { coverage } : {}),
      items,
      scannedPages: totalPages,
      status: 'ready',
      totalPages,
    });
  } catch (error) {
    if (latestComponentScanId !== scanId) {
      return;
    }

    const detail = error instanceof Error && error.message.trim() !== ''
      ? ` ${error.message}`
      : '';
    emitInventoryState(scanId, {
      message: `Could not scan this file.${detail}`,
      status: 'error',
    });
  }
}

function getNodeLayerPath(node: SceneNode): string {
  const names: string[] = [node.name];
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    if ('name' in parent) names.unshift(parent.name);
    parent = parent.parent;
  }
  return names.join(' / ');
}

function emitInventoryState(
  scanId: string,
  state: Parameters<ComponentInventoryStateHandler['handler']>[0]['state'],
): void {
  if (latestComponentScanId !== scanId) {
    return;
  }
  emit<ComponentInventoryStateHandler>('COMPONENT_INVENTORY_STATE', {
    scanId,
    state,
  });
}

function getInventoryConnectionStatus(
  component: ConnectableComponentNode,
): ComponentConnectionStatus {
  try {
    const connection = readConnectionMetadata(component);
    if (connection.ok) {
      return 'connected';
    }
    return connection.issue ? 'needs-attention' : 'not-connected';
  } catch (_error) {
    return 'needs-attention';
  }
}

async function sendSelectionState(
  source: 'initial' | 'refresh' | 'selectionchange',
): Promise<void> {
  const requestId = ++latestSelectionRefreshRequestId;
  const selectedNodes = [...figma.currentPage.selection];

  try {
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selection = selectedNode ? await resolveSelection(selectedNode) : null;

    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const connection = selection
      ? readConnectionMetadata(selection.mainComponent)
      : null;
    const state = await createCanvasTargetState(selectedNodes, selection, connection);
    const inspectState = formatInspectCodeState(await createInspectCodeState(
      selectedNodes,
      selectedNode,
      selection,
      connection,
    ), await loadOutputPreferences());

    // Re-check after the async inspection (getCSSAsync + instance resolution):
    // a newer selection may have started meanwhile. Discard stale Inspect Code
    // results so a slow inspection never overwrites the current selection.
    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    emitCanvasTargetState(source, state);
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', inspectState);

    if (selectedNodes.length === 1) {
      const docMetadata = readDocFrameMetadata(selectedNodes[0]);
      if (docMetadata) {
        let drift;
        if (docMetadata.docType === 'tokens') {
          const rawCol = await loadRawCollectionData(docMetadata.targetId);
          if (rawCol) {
            const currentDoc = buildTokenDocDocument(rawCol);
            drift = diffTokenDocument(docMetadata, currentDoc);
          }
        } else if (docMetadata.docType === 'component') {
          const allNodes = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
          const matched = allNodes.find(
            (n) => n.name === docMetadata.targetId || n.name === docMetadata.targetName || n.id === docMetadata.targetId,
          );
          let connectionMeta: ConnectionMetadata = {
            componentName: docMetadata.targetName,
            importPath: `@tashilcar/swiss-army-knife`,
            schemaVersion: 5,
          };
          let figmaSnapshot: FigmaComponentSnapshot | undefined;
          let sourceSnapshot: SourceComponentSnapshot | undefined;
          if (matched) {
            figmaSnapshot = createFigmaComponentSnapshot(matched);
            const connection = readConnectionMetadata(matched);
            if (connection.ok) {
              connectionMeta = connection.metadata;
              sourceSnapshot = connection.metadata.mappingDocument?.sourceSnapshot;
            }
          }
          const currentDoc = buildComponentDocDocument(connectionMeta, sourceSnapshot, figmaSnapshot);
          drift = diffComponentDocument(docMetadata, currentDoc);
        }
        emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {
          frameNodeId: selectedNodes[0].id,
          metadata: docMetadata,
          drift,
        });
      } else {
        emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
      }
    } else {
      emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
    }
  } catch (error) {
    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const message = createSelectionRefreshFailureMessage(error);
    emitCanvasTargetState(source, {
      status: 'empty',
      message,
    });
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', {
      status: 'invalid-selection',
      message,
    });
    emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
  }
}

function formatInspectCodeState(state: InspectCodeState, preferences: OutputPreferences): InspectCodeState {
  if (state.status === 'connected') {
    return { ...state, output: { ...state.output, code: formatGeneratedCode(state.output.code, preferences) } };
  }
  if (state.status === 'layout') {
    return {
      ...state,
      layout: { ...state.layout, tsx: formatGeneratedCode(state.layout.tsx, preferences) },
      ...(state.variantLogic ? { variantLogic: { ...state.variantLogic, code: formatGeneratedCode(state.variantLogic.code, preferences) } } : {}),
    };
  }
  return state;
}

function emitCanvasTargetState(
  source: 'initial' | 'refresh' | 'selectionchange',
  state: UiTargetState,
): void {
  emit<CanvasTargetStateHandler>('CANVAS_TARGET_STATE', { source, state });
}

function isCurrentSelectionRefresh(
  requestId: number,
  selectedNodes: ReadonlyArray<SceneNode>,
): boolean {
  return requestId === latestSelectionRefreshRequestId
    && matchesCurrentSelection(selectedNodes);
}

function createSelectionRefreshFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const summary = detail === ''
    ? 'Could not refresh the current selection.'
    : `Could not refresh the current selection: ${detail}`;

  return [
    summary,
    'Try changing the selection or reopening the plugin.',
  ].join('\n');
}

function createTargetRefreshFailureMessage(error: unknown): string {
  const detail = error instanceof Error && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not open this component.${detail}`;
}

function matchesCurrentSelection(selectedNodes: ReadonlyArray<SceneNode>): boolean {
  const currentSelection = figma.currentPage.selection;

  return currentSelection.length === selectedNodes.length
    && currentSelection.every((node, index) => node.id === selectedNodes[index].id);
}

async function createInspectCodeState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selectedNode: SceneNode | null,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): Promise<InspectCodeState> {
  if (selectedNodes.length === 0) {
    return { status: 'invalid-selection' };
  }

  if (selectedNodes.length > 1) {
    return {
      status: 'invalid-selection',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single layer to generate its React layout.',
      ].join('\n'),
    };
  }

  // Connected component path (instance / component / component-set).
  if (selection) {
    if (!connection || !connection.ok) {
      if (connection?.issue) {
        return {
          status: 'connection-issue',
          connectionIssue: connection.issue,
          message: connection.message,
        };
      }
      if (selectedNode && supportsReactLayout(selectedNode)) {
        const context = new GenerationContext();
        const [layout, inspection] = await Promise.all([
          generateReactLayout(
            selectedNode as unknown as LayoutSourceNode,
            {
              context,
              rootName: createSelectionLayoutName(selection),
            },
          ),
          inspectSceneNode(selectedNode, context),
        ]);
        return {
          status: 'layout',
          ...(isOutsideMainComponent(selectedNode)
            ? { showUnconnectedComponents: true }
            : {}),
          layout,
          inspection,
          variantLogic: createSelectionVariantLogic(selection),
        };
      }
      return { status: 'not-connected' };
    }

    const output = await createConnectedOutput(
      connection.metadata,
      selection,
      selectedNode ?? selection.mainComponent,
    );
    return {
      status: 'connected',
      output: {
        code: output.code,
        deprecation: output.deprecation,
        diagnostics: output.diagnostics,
        explanation: output.explanation,
        references: createConnectionReferences(connection.metadata),
        runtimeRequirements: output.runtimeRequirements,
      },
    };
  }

  if (selectedNode) {
    if (supportsReactLayout(selectedNode)) {
      return {
        status: 'layout',
        ...(isOutsideMainComponent(selectedNode)
          ? { showUnconnectedComponents: true }
          : {}),
        layout: await generateReactLayout(
          selectedNode as unknown as LayoutSourceNode,
        ),
      };
    }

    // Leaves that are not meaningful React tree roots retain selected-node
    // Dev-Mode-parity CSS inspection.
    return {
      status: 'inspection',
      inspection: await inspectSceneNode(selectedNode),
    };
  }

  return { status: 'invalid-selection' };
}

function isOutsideMainComponent(node: SceneNode): boolean {
  // A component/component-set is itself a main component, even when the
  // design file visually groups it inside an ordinary frame.
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return false;
  }

  let parent: BaseNode | null = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    // Any selected layer below a main component belongs to that component's
    // implementation and should receive the full React view without an
    // unconnected warning.
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') {
      return false;
    }
    parent = parent.parent;
  }

  // A generated layout outside a main component is a Frame structure. Its
  // individual unresolved component instances may be labeled in Inspect Code.
  return true;
}

function createSelectionVariantLogic(
  selection: ResolvedSelection,
): VariantLogicResult | undefined {
  if (selection.mainComponent.type !== 'COMPONENT_SET') {
    return undefined;
  }

  return generateVariantLogic(
    selection.mainComponent,
    selection.componentProperties,
  );
}

function createSelectionLayoutName(
  selection: ResolvedSelection,
): string | undefined {
  return selection.mainComponent.type === 'COMPONENT_SET'
    ? selection.mainComponent.name
    : undefined;
}

async function createCanvasTargetState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): Promise<UiTargetState> {
  if (selectedNodes.length === 0) {
    return {
      status: 'empty',
      message: 'Select a component instance, main component, or component set to connect it.',
    };
  }

  if (selectedNodes.length > 1) {
    return {
      status: 'empty',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  if (!selection) {
    const node = selectedNodes[0];
    return {
      status: 'empty',
      message: [
        `"${node.name}" (${node.type}) is not connectable.`,
        'Select a component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  return createTargetState(
    selection,
    connection ?? readConnectionMetadata(selection.mainComponent),
  );
}


async function createTargetState(
  selection: ResolvedSelection,
  connection: ConnectionReadResult,
): Promise<Extract<UiTargetState, { status: 'ready' }>> {
  const connectionIssue = !connection.ok ? connection.issue : undefined;

  return {
    status: 'ready',
    targetToken: selection.mainComponent.id,
    componentName: selection.mainComponent.name,
    figmaSnapshot: createFigmaComponentSnapshot(selection.mainComponent),
    semanticSnapshot: await createTargetSemanticSnapshot(selection.mainComponent),
    existingConnection: connection.ok ? connection.metadata : undefined,
    connectionIssue,
    message: connectionIssue
      ? connectionIssue.message
      : connection.ok
      ? 'This component already has a Storybook connection.'
      : 'This component is ready to connect.',
  };
}

/**
 * Bounded semantic scan of the connect target for authoring. A component set
 * scans its default (first) variant so locators stay variant-relative. Never
 * throws: authoring simply loses nested options when extraction fails.
 */
async function createTargetSemanticSnapshot(
  component: ConnectableComponentNode,
): Promise<FigmaSemanticSnapshot | undefined> {
  try {
    const scanRoot = component.type === 'COMPONENT_SET'
      ? component.children.find((child) => child.type === 'COMPONENT')
      : component;
    if (!scanRoot) {
      return undefined;
    }

    const tree = await createSemanticNodeTree(scanRoot);
    const { snapshot } = extractFigmaSemanticSnapshot(tree, component.id);
    return { ...snapshot, componentName: component.name };
  } catch (_error) {
    return undefined;
  }
}

function createFigmaComponentSnapshot(
  component: ConnectableComponentNode,
): FigmaComponentSnapshot {
  const properties: FigmaPropertyDescriptor[] = [];
  const description = typeof component.description === 'string'
    ? component.description.trim()
    : '';

  for (const [rawKey, definition] of Object.entries(
    component.componentPropertyDefinitions,
  )) {
    if (definition.type === 'SLOT') {
      continue;
    }

    const name = normalizeComponentPropertyName(rawKey);
    const hashIndex = rawKey.lastIndexOf('#');
    const id = hashIndex >= 0 ? rawKey.slice(hashIndex + 1) : rawKey;
    const options = definition.type === 'VARIANT'
      ? [...(definition.variantOptions ?? [])]
      : definition.type === 'BOOLEAN' ? ['False', 'True'] : [];

    properties.push({
      id,
      name,
      options,
      rawKey,
      type: definition.type,
      ...(typeof definition.defaultValue === 'string'
        || typeof definition.defaultValue === 'boolean'
        ? { defaultValue: definition.defaultValue }
        : {}),
    });
  }

  return {
    componentId: component.id,
    componentName: component.name,
    ...(description ? { description } : {}),
    properties,
  };
}

function collectComponentProperties(
  selectedNode: InstanceNode | ComponentNode,
  mainComponent: ComponentNode,
  connectionTarget: ConnectableComponentNode,
): Record<string, string | boolean> {
  const properties = createDictionary<string | boolean>();

  for (const source of [
    readComponentProperties(connectionTarget),
    readComponentProperties(mainComponent),
    readComponentProperties(selectedNode),
  ]) {
    for (const [propertyName, value] of Object.entries(source)) {
      properties[propertyName] = value;
    }
  }

  return properties;
}

function getConnectionTarget(component: ComponentNode): ConnectableComponentNode {
  if (component.parent?.type === 'COMPONENT_SET') {
    return component.parent;
  }

  return component;
}

function readComponentProperties(
  node: InstanceNode | ComponentNode | ComponentSetNode,
): Record<string, string | boolean> {
  const properties = createDictionary<string | boolean>();

  if ('componentProperties' in node) {
    for (const [propertyName, property] of Object.entries(node.componentProperties)) {
      properties[normalizeComponentPropertyName(propertyName)] = property.value;
    }
  }

  if ('variantProperties' in node) {
    const variantProperties = node.variantProperties;

    if (variantProperties) {
      for (const [propertyName, value] of Object.entries(variantProperties)) {
        if (typeof value === 'string') {
          properties[normalizeComponentPropertyName(propertyName)] = value;
        }
      }
    }
  }

  return properties;
}

function normalizeComponentPropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}

function readConnectionMetadata(
  mainComponent: ConnectableComponentNode,
): ConnectionReadResult {
  const rawConnection = mainComponent.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);

  if (!rawConnection) {
    return {
      ok: false,
      message: [
        '⚠️ **Not connected**',
        '',
        'This component is not connected to Storybook/source code yet.',
        '',
        'Ask the design system owner to connect this Figma main component to its production component.',
      ].join('\n'),
    };
  }

  return parsePersistedConnectionMetadata(rawConnection);
}

function preflightStoredConnection(
  mainComponent: ConnectableComponentNode,
): { ok: true } | { message: string; ok: false } {
  const rawConnection = mainComponent.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);

  if (!rawConnection) {
    return { ok: true };
  }

  const connection = parsePersistedConnectionMetadata(rawConnection);
  return connection.ok
    ? { ok: true }
    : { message: connection.message, ok: false };
}

function parsePersistedConnectionMetadata(rawConnection: string): ConnectionReadResult {
  let parsedConnection: unknown;

  try {
    parsedConnection = JSON.parse(rawConnection);
  } catch (_error) {
    const issue: ConnectionIssue = {
      reason: 'malformed-json',
      message: [
        'Stored Storybook connection data is malformed JSON.',
        'The data was left unchanged; repair it with a compatible plugin version before saving or clearing.',
      ].join(' '),
    };
    return { issue, message: issue.message, ok: false };
  }

  const validation = validatePersistedConnectionMetadata(parsedConnection);

  if (!validation.ok) {
    return {
      issue: validation.issue,
      message: validation.issue.message,
      ok: false,
    };
  }

  return {
    metadata: migratePersistedConnectionMetadata(validation.metadata),
    ok: true,
  };
}

function createConnectionReferences(metadata: ConnectionMetadata): ConnectionReferences {
  return {
    storybookUrl: metadata.storybookUrl,
    sourcePath: metadata.sourcePath,
    sourceUrl: metadata.sourceUrl,
    updatedAt: metadata.updatedAt,
  };
}

function createReferenceText(metadata: ConnectionMetadata): string {
  const references = createConnectionReferences(metadata);

  return [
    references.storybookUrl ? `Storybook: ${references.storybookUrl}` : '',
    references.sourcePath ? `Source path: ${references.sourcePath}` : '',
    references.sourceUrl ? `Source URL: ${references.sourceUrl}` : '',
    references.updatedAt ? `Last updated: ${formatDateTime(references.updatedAt)}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeConnectionReferenceUrlsForSave(metadata: ConnectionMetadata):
  | { ok: true; sourceUrl?: string; storybookUrl?: string }
  | { ok: false; message: string } {
  const storybookUrl = metadata.storybookUrl === undefined
    ? undefined
    : normalizeOptionalHttpUrl(metadata.storybookUrl);

  if (metadata.storybookUrl !== undefined && storybookUrl === null) {
    return {
      ok: false,
      message: 'Storybook URL must be a complete HTTP or HTTPS URL without credentials.',
    };
  }

  const sourceUrl = metadata.sourceUrl === undefined
    ? undefined
    : normalizeOptionalHttpUrl(metadata.sourceUrl);

  if (metadata.sourceUrl !== undefined && sourceUrl === null) {
    return {
      ok: false,
      message: 'Source URL must be a complete HTTP or HTTPS URL without credentials.',
    };
  }

  return {
    ok: true,
    sourceUrl: sourceUrl ?? undefined,
    storybookUrl: storybookUrl ?? undefined,
  };
}

function openExternalReference(payload: unknown): void {
  if (
    !isRecord(payload)
    || (payload.target !== 'source' && payload.target !== 'storybook')
    || typeof payload.url !== 'string'
  ) {
    figma.notify('Could not open the reference because its URL is invalid.');
    return;
  }

  const url = normalizeHttpUrl(payload.url);

  if (!url) {
    figma.notify('Only complete HTTP or HTTPS reference URLs can be opened.');
    return;
  }

  try {
    figma.openExternal(url);
  } catch (_error) {
    figma.notify('Could not open the reference in your browser.');
  }
}

function getDisplayText(node: SceneNode): string {
  if ('characters' in node && typeof node.characters === 'string' && node.characters.length > 0) {
    return node.characters;
  }

  return node.name;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function createPlainTextBlock(title: string, code: string): CodegenBlock {
  return {
    title,
    language: 'PLAINTEXT',
    code,
  };
}

/**
 * Render inspection diagnostics as a concise plaintext block for Dev Mode. Each
 * line is the diagnostic message, prefixed with its severity. Layer paths are
 * included to make the note actionable. Returns null when there are none.
 */
function formatDiagnostics(
  diagnostics: ReadonlyArray<{
    layerPath?: string[];
    message: string;
    severity: 'error' | 'info' | 'warning';
  }>,
): string | null {
  if (diagnostics.length === 0) {
    return null;
  }
  return diagnostics
    .map((diagnostic) => {
      const severity = diagnostic.severity === 'error'
        ? '⛔'
        : diagnostic.severity === 'warning'
          ? '⚠️'
          : 'ℹ️';
      const path = diagnostic.layerPath?.length ? ` (${diagnostic.layerPath.join(' / ')})` : '';
      return `${severity} ${diagnostic.message}${path}`;
    })
    .join('\n');
}

// --- Automated Documentation Generator ---

async function loadRawCollectionData(collectionId: string): Promise<RawCollectionData | null> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return null;

    const variables = await figma.variables.getLocalVariablesAsync();
    const variablesById = new Map(variables.map((v) => [v.id, v]));

    const tokens: RawCollectionData['tokens'] = [];
    for (const varId of collection.variableIds) {
      const variable = variablesById.get(varId);
      if (!variable) continue;

      const valuesByMode: Record<string, RawVariableValue> = {};
      for (const mode of collection.modes) {
        const val = variable.valuesByMode[mode.modeId];
        let aliasTargetName: string | undefined;
        let resolvedValue: unknown = val;

        if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'VARIABLE_ALIAS') {
          const targetVar = variablesById.get((val as { id: string }).id);
          if (targetVar) {
            aliasTargetName = targetVar.name;
            const targetVal = targetVar.valuesByMode[mode.modeId] ?? Object.values(targetVar.valuesByMode)[0];
            resolvedValue = targetVal;
          }
        }

        valuesByMode[mode.modeId] = {
          aliasTargetName,
          isColor: variable.resolvedType === 'COLOR',
          isFloat: variable.resolvedType === 'FLOAT',
          value: (resolvedValue as ColorValue | number | string | boolean) ?? '',
        };
      }

      tokens.push({
        id: variable.id,
        name: variable.name,
        description: variable.description,
        scopes: variable.scopes,
        valuesByMode,
      });
    }

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      tokens,
    };
  } catch (_e) {
    return null;
  }
}

async function generateTokenDocs(
  collectionId: string,
  targetFormat: 'canvas' | 'markdown' = 'canvas',
): Promise<void> {
  const reportProgress = (message: string, percent: number) => {
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Reading token collection…', 5);
    const rawCollection = await loadRawCollectionData(collectionId);
    if (!rawCollection) {
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: false,
        message: 'Could not load token collection data.',
      });
      return;
    }

    reportProgress('Building token models…', 10);
    const doc = buildTokenDocDocument(rawCollection);
    if (targetFormat === 'markdown') {
      reportProgress('Formatting Markdown documentation…', 70);
      const markdown = emitTokenDocMarkdown(doc);
      reportProgress('Done!', 100);
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: true,
        message: 'Markdown documentation generated.',
        markdown,
      });
    } else {
      const frame = await createTokenDocFrame(doc, undefined, reportProgress);
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: true,
        message: `Created documentation frame for "${doc.title}".`,
        frameNodeId: frame.id,
      });
    }
  } catch (error) {
    console.error('[Tashil Doc Generation Error]', error);
    emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
      ok: false,
      message: errorMessage(error, 'generate token documentation'),
    });
  }
}

async function updateDocsInPlace(frameNodeId: string): Promise<void> {
  const reportProgress = (message: string, percent: number) => {
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Locating selected documentation frame…', 5);
    const node = await figma.getNodeByIdAsync(frameNodeId);
    if (!node || node.type !== 'FRAME') {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: 'Selected documentation frame could not be found.',
      });
      return;
    }

    reportProgress('Validating documentation frame metadata…', 10);
    const metadata = readDocFrameMetadata(node);
    if (!metadata) {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: 'This frame is not recognized as a Tashil documentation frame.',
      });
      return;
    }

    if (metadata.docType === 'tokens') {
      reportProgress('Loading updated variable collection…', 15);
      const rawCollection = await loadRawCollectionData(metadata.targetId);
      if (!rawCollection) {
        emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
          ok: false,
          message: `Variable collection "${metadata.targetName}" could not be found.`,
        });
        return;
      }

      const doc = buildTokenDocDocument(rawCollection);
      const result = await updateTokenDocFrameInPlace(node, doc, reportProgress);
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: result.ok,
        message: result.message,
        updatedTokensCount: result.updatedTokensCount,
      });
    } else if (metadata.docType === 'component') {
      reportProgress('Locating master component node…', 15);
      let componentNode: ComponentNode | ComponentSetNode | undefined;
      const allNodes = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
      const matched = allNodes.find(
        (n) => n.name === metadata.targetId || n.name === metadata.targetName || n.id === metadata.targetId,
      );
      if (matched) {
        componentNode = matched as ComponentNode | ComponentSetNode;
      }

      let connectionMeta: ConnectionMetadata = {
        componentName: metadata.targetName,
        importPath: `@tashilcar/swiss-army-knife`,
        schemaVersion: 5,
      };
      let figmaSnapshot: FigmaComponentSnapshot | undefined;
      let sourceSnapshot: SourceComponentSnapshot | undefined;

      if (componentNode) {
        figmaSnapshot = createFigmaComponentSnapshot(componentNode);
        const connection = readConnectionMetadata(componentNode);
        if (connection.ok) {
          connectionMeta = connection.metadata;
          sourceSnapshot = connection.metadata.mappingDocument?.sourceSnapshot;
        }
      }

      const doc = buildComponentDocDocument(connectionMeta, sourceSnapshot, figmaSnapshot);
      const result = await updateComponentDocFrameInPlace(node, doc, componentNode, reportProgress);
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: result.ok,
        message: result.message,
        updatedTokensCount: result.updatedPropsCount,
      });
    } else {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: `In-place update for ${metadata.docType} is not supported.`,
      });
    }
  } catch (error) {
    console.error('[Tashil Doc Update Error]', error);
    emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
      ok: false,
      message: errorMessage(error, 'update documentation frame'),
    });
  }
}

async function generateComponentDocs(
  targetToken: string,
  targetFormat: 'canvas' | 'markdown' = 'canvas',
): Promise<void> {
  const reportProgress = (message: string, percent: number) => {
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Resolving target component…', 5);
    const targetResult = await resolveTargetById(targetToken);
    if (!targetResult.ok) {
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: false,
        message: targetResult.message,
      });
      return;
    }

    reportProgress('Reading connection metadata…', 10);
    const connection = readConnectionMetadata(targetResult.selection.mainComponent);
    if (!connection.ok) {
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: false,
        message: 'Component is not connected.',
      });
      return;
    }

    reportProgress('Extracting props & schema…', 15);
    const figmaSnapshot = createFigmaComponentSnapshot(targetResult.selection.mainComponent);
    const sourceSnapshot = connection.metadata.mappingDocument?.sourceSnapshot;
    const doc = buildComponentDocDocument(connection.metadata, sourceSnapshot, figmaSnapshot);

    if (targetFormat === 'markdown') {
      reportProgress('Formatting Markdown specification…', 70);
      const markdown = emitComponentDocMarkdown(doc);
      reportProgress('Done!', 100);
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: true,
        message: 'Component markdown documentation generated.',
        markdown,
      });
    } else {
      const frame = await createComponentDocFrame(
        doc,
        { componentNode: targetResult.selection.mainComponent },
        reportProgress,
      );
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: true,
        message: `Generated variant matrix for <${doc.componentName} />.`,
        frameNodeId: frame.id,
      });
    }
  } catch (error) {
    emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
      ok: false,
      message: errorMessage(error, 'generate component documentation'),
    });
  }
}

