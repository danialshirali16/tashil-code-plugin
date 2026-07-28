import { emit, on, showUI } from '@create-figma-plugin/utilities';
import {
  createUsageSnippet,
  formatMappingDiagnostics,
  isPropMappings,
  isRecord,
  migratePersistedConnectionMetadata,
  validatePersistedConnectionMetadata,
  validateConnectionMetadata,
  type ResolvedInstanceSwap,
} from './codegen';
import { normalizeHttpUrl, normalizeOptionalHttpUrl } from './external-url';
import { renderImportLines } from './layout/imports';
import { GenerationContext } from './layout/generation-context';
import type { LayoutSourceNode } from './layout/figma-layout-extractor';
import {
  generateReactLayout,
  supportsReactLayout,
} from './layout/react-layout';
import type { ReactLayoutResult } from './layout/types';
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
import type { FrameInspection } from './inspect/types';
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
  type ComponentInventoryStateHandler,
  type ComponentTargetStateHandler,
  type ConnectionIssue,
  type ConnectionMetadata,
  type ConnectionReferences,
  type FigmaComponentSnapshot,
  type FigmaPropertyDescriptor,
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
} from './types';
import { serializeCollection } from './sync-tokens/serialize';
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

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 880, height: 680 });

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
    void scanComponents(payload.scanId);
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

figma.codegen.on('generate', async (event) => generateCodegenBlocks(event.node));

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

  return blocks;
}

type ConnectedOutput = {
  code: string;
  diagnostics?: string;
  explanation?: string;
  runtimeRequirements?: string;
  deprecation?: string;
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
        root,
      },
    );

    return {
      code: [renderImportLines(result.usage.imports), '', result.usage.jsx].join('\n'),
      diagnostics: result.issues.length > 0 ? result.issues.join('\n') : undefined,
      explanation: formatSemanticExplanations(result.explanations),
      runtimeRequirements: formatRuntimeRequirements(result.runtimeRequirements),
      deprecation: result.deprecation,
    };
  }

  const usage = createUsageSnippet(metadata, selection);
  return {
    code: usage.code,
    diagnostics: formatMappingDiagnostics(usage.diagnostics) || undefined,
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
      return `${requirement.targetPath}: ${requirement.typeName}${note}`;
    })
    .join('\n');
}

/** Inspect any single scene node through the shared inspection service. */
async function inspectSceneNode(
  node: SceneNode,
  context?: GenerationContext,
): Promise<FrameInspection> {
  return inspectFrame(node as unknown as InspectableNode, { context });
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

  const layoutCss = formatCssBlock(inspection.css.layout);
  if (layoutCss) {
    blocks.push({ title: 'Layout', language: 'CSS', code: layoutCss });
  }

  const styleCss = formatCssBlock(inspection.css.style);
  if (styleCss) {
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
      files.push({
        name: `${collectionSlug}${suffix}.css`,
        css: serializeCollection(domain, options),
        declarationCount: tokens.length,
        sourceVariableCount: collection.variableIds.length,
        warnings,
      });
    }
  }

  return files;
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

async function scanComponents(scanId: string): Promise<void> {
  latestComponentScanId = scanId;

  try {
    const pages = [...figma.root.children];
    const totalPages = pages.length;
    const items: ComponentInventoryItem[] = [];
    const skippedPageNames: string[] = [];
    const seenTargetTokens = new Set<string>();

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

    items.sort((first, second) => (
      first.componentName.localeCompare(second.componentName, undefined, {
        sensitivity: 'base',
      })
      || first.pageName.localeCompare(second.pageName, undefined, {
        sensitivity: 'base',
      })
    ));

    if (skippedPageNames.length > 0) {
      emitInventoryState(scanId, {
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
    const inspectState = await createInspectCodeState(
      selectedNodes,
      selectedNode,
      selection,
      connection,
    );

    // Re-check after the async inspection (getCSSAsync + instance resolution):
    // a newer selection may have started meanwhile. Discard stale Inspect Code
    // results so a slow inspection never overwrites the current selection.
    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    emitCanvasTargetState(source, state);
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', inspectState);
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
  }
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
