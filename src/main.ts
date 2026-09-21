import { emit, on, showUI } from '@create-figma-plugin/utilities';
import {
  type ApplyConnectionImportHandler,
  type ApplyLibraryUpdatesHandler,
  type ApplyTokenBindingsHandler,
  type CancelDocGenerationHandler,
  type ClearConnectionHandler,
  type CloseHandler,
  type DesignHealthDocumentChangedHandler,
  type ExportConnectionsHandler,
  type ExportTokensHandler,
  type FocusNodeHandler,
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
  type SaveTokenExportPreferencesHandler,
  type ScanComponentsHandler,
  type ScanDesignHealthHandler,
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
  saveTokenExportPreferences,
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
  applyLibraryUpdates,
  applyTokenBindings,
  focusNodeOnCanvas,
  scanDesignHealth,
} from './main/design-health-adapter';
import {
  consumeProgrammaticSelectionMatch,
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

  on<SaveTokenExportPreferencesHandler>('SAVE_TOKEN_EXPORT_PREFERENCES', (payload) => {
    void saveTokenExportPreferences(payload.preferences);
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

  on<ScanDesignHealthHandler>('SCAN_DESIGN_HEALTH', (payload) => {
    attachDocumentChangeListenerOnce();
    void scanDesignHealth(payload.scanId, payload.targetNodeId);
  });

  on<ApplyTokenBindingsHandler>('APPLY_TOKEN_BINDINGS', (payload) => {
    void applyTokenBindings(payload.operationId, payload.bindings);
  });

  on<ApplyLibraryUpdatesHandler>('APPLY_LIBRARY_UPDATES', (payload) => {
    void applyLibraryUpdates(payload.operationId, payload.nodeIds);
  });

  on<FocusNodeHandler>('FOCUS_NODE', (payload) => {
    void focusNodeOnCanvas(payload.nodeId);
  });

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin();
  });

  figma.on('selectionchange', () => {
    // Decided synchronously per event, before the async pipeline: a selection
    // change caused by the FOCUS_NODE reveal must not rescan the audit.
    const suppressDesignHealthRescan = consumeProgrammaticSelectionMatch();
    runBestEffort(() => sendSelectionState('selectionchange', { suppressDesignHealthRescan }));
  });
}

// Debounced signal for the Design Health tab: an audit goes stale after an
// undo or an external edit. Attached lazily on the first Design Health scan
// because under `documentAccess: "dynamic-page"` a documentchange handler can
// only be registered after figma.loadAllPagesAsync() — loading eagerly at
// plugin start would tax every file the plugin opens, so users who never open
// the tab never pay it. Debounced so bulk operations (a scripted restyle
// touching hundreds of layers) notify once, after things settle.
let documentChangeListenerRequested = false;

function attachDocumentChangeListenerOnce(): void {
  if (documentChangeListenerRequested) {
    return;
  }
  documentChangeListenerRequested = true;

  void (async () => {
    try {
      await figma.loadAllPagesAsync();
      let documentChangeNotifyTimer: ReturnType<typeof setTimeout> | undefined;
      figma.on('documentchange', () => {
        if (documentChangeNotifyTimer !== undefined) {
          clearTimeout(documentChangeNotifyTimer);
        }
        documentChangeNotifyTimer = setTimeout(() => {
          documentChangeNotifyTimer = undefined;
          emit<DesignHealthDocumentChangedHandler>('DESIGN_HEALTH_DOCUMENT_CHANGED', {
            changedAt: Date.now(),
          });
        }, 1500);
      });
    } catch {
      // Page loading failed (e.g. an access restriction): the staleness
      // signal degrades to manual re-audits instead of crashing the plugin.
    }
  })();
}
