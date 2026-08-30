import { on, showUI } from '@create-figma-plugin/utilities';
import {
  type ApplyConnectionImportHandler,
  type CancelDocGenerationHandler,
  type ClearConnectionHandler,
  type CloseHandler,
  type ExportConnectionsHandler,
  type ExportTokensHandler,
  type GenerateCodeConnectHandler,
  type GenerateComponentDocsHandler,
  type GenerateStoriesHandler,
  type GenerateStyleDocsHandler,
  type GenerateTokenDocsHandler,
  type LoadDocSourcePreviewHandler,
  type LoadDocStyleSourcesHandler,
  type LoadOutputPreferencesHandler,
  type LoadTokenCollectionsHandler,
  type OpenComponentTargetHandler,
  type OpenExternalHandler,
  type PreviewConnectionImportHandler,
  type PreviewTokensHandler,
  type RefreshSelectionHandler,
  type ResizeWindowHandler,
  type SaveConnectionHandler,
  type SaveOutputPreferencesHandler,
  type ScanComponentsHandler,
  type ScaffoldPropMappingsHandler,
  type UpdateDocsInPlaceHandler,
} from './types';
import { runBestEffort } from './main/types';
import {
  emitOutputPreferences,
  saveOutputPreferences,
} from './main/preferences';
import {
  registerCodegenHandler,
} from './main/codegen-adapter';
import {
  exportTokens,
  loadTokenCollections,
  previewTokens,
} from './main/token-adapter';
import {
  cancelDocumentationGeneration,
  generateComponentDocs,
  generateStyleDocs,
  generateTokenDocs,
  loadDocSourcePreview,
  loadDocStyleSources,
  updateDocsInPlace,
} from './main/doc-adapter';
import {
  applyConnectionImport,
  clearConnection,
  exportConnections,
  generateCodeConnect,
  generateStories,
  openExternalReference,
  previewConnectionImport,
  saveConnection,
  scaffoldPropMappings,
  scanComponents,
  sendComponentTargetState,
} from './main/connection-adapter';
import {
  sendSelectionState,
} from './main/selection-adapter';

// Register Dev Mode codegen handler at module evaluation
registerCodegenHandler();

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 560, height: 680 });

  on<ExportConnectionsHandler>('EXPORT_CONNECTIONS', () => { void exportConnections(); });
  on<PreviewConnectionImportHandler>('PREVIEW_CONNECTION_IMPORT', ({ raw }) => { void previewConnectionImport(raw); });
  on<ApplyConnectionImportHandler>('APPLY_CONNECTION_IMPORT', ({ choices }) => { void applyConnectionImport(choices); });
  on<GenerateStoriesHandler>('GENERATE_STORIES', (payload) => { void generateStories(payload.targetToken, payload.selectedVariantTokens); });
  on<GenerateCodeConnectHandler>('GENERATE_CODE_CONNECT', ({ targetToken }) => { void generateCodeConnect(targetToken); });
  on<LoadOutputPreferencesHandler>('LOAD_OUTPUT_PREFERENCES', () => { void emitOutputPreferences(); });
  on<SaveOutputPreferencesHandler>('SAVE_OUTPUT_PREFERENCES', ({ preferences }) => { void saveOutputPreferences(preferences); });

  on<SaveConnectionHandler>('SAVE_CONNECTION', (payload) => {
    void saveConnection(
      payload.metadata,
      payload.targetToken,
      payload.operationId,
      () => sendSelectionState('refresh'),
    );
  });

  on<ClearConnectionHandler>('CLEAR_CONNECTION', (payload) => {
    void clearConnection(
      payload.targetToken,
      payload.operationId,
      () => sendSelectionState('refresh'),
    );
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
    void generateTokenDocs(
      payload.collectionId,
      payload.targetFormat,
      payload.tokenGroupingDepth,
    );
  });

  on<LoadDocStyleSourcesHandler>('LOAD_DOC_STYLE_SOURCES', () => {
    void loadDocStyleSources();
  });

  on<GenerateStyleDocsHandler>('GENERATE_STYLE_DOCS', (payload) => {
    void generateStyleDocs(payload.styleKind, payload.tokenGroupingDepth);
  });

  on<CancelDocGenerationHandler>('CANCEL_DOC_GENERATION', () => {
    cancelDocumentationGeneration();
  });

  on<LoadDocSourcePreviewHandler>('LOAD_DOC_SOURCE_PREVIEW', (payload) => {
    void loadDocSourcePreview(payload);
  });

  on<UpdateDocsInPlaceHandler>('UPDATE_DOCS_IN_PLACE', (payload) => {
    void updateDocsInPlace(payload.frameNodeId, payload.tokenGroupingDepth);
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
