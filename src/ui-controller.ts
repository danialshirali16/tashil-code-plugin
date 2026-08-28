import { emit, on } from '@create-figma-plugin/utilities';
import JSZip from 'jszip';
import { useEffect, useRef, useState } from 'preact/hooks';
import { isPropMappings, isRecord } from './codegen';
import {
  evaluateConnectionHealth,
  type ConnectionHealth,
} from './connection-health';
import { compileMappingDocument, isMappingDocument } from './mapping-document';
import {
  createMappingDocumentDraft,
  extractAdvancedPropMappings,
  setMappedFigmaProperty,
  setMappedFigmaValue,
} from './mapping-editor';
import { mergePropMappingsJson } from './prop-mappings';
import { parseSourceComponent } from './source-schema';
import { collectSourceUploadInputs } from './source-upload';
import {
  createRecipeDraft,
  setRepeatedTargetInstances,
  setTargetOption,
  setTargetValueMapping,
} from './semantic/authoring';
import { SEMANTIC_CONNECT_AUTHORING_ENABLED } from './semantic/flags';
import {
  createConnectionDebugBundle,
  serializeConnectionDebugBundle,
} from './semantic/debug-bundle';
import {
  createComponentAuditReport,
  formatComponentAuditMarkdown,
  serializeComponentAuditJson,
} from './semantic/audit-report';
import { evaluateSemanticHealth } from './semantic/health';
import { validateSemanticRecipe } from './semantic/schema';
import { extractSourceContract } from './semantic/source-contract';
import {
  applyProposal,
  planReconciliation,
  type ReconciliationAction,
  type ReconciliationProposal,
} from './semantic/reconcile';
import type { SemanticConnectionRecipe } from './semantic/types';
import {
  FORM_FIELD_IDS,
  clearFormDraft,
  createFormDraft,
  createFormValues,
  createMutationOperationId,
  createPendingMutationState,
  finishPendingMutation,
  getClearAction,
  getFirstInvalidField,
  getPendingMutationForTarget,
  getTargetStatusAnnouncement,
  markFormDraftSaved,
  parseIntentionalFigmaPropertyPrefixes,
  selectFormDraft,
  startPendingMutation,
  updateFormDraft,
  validateConnectionForm,
  type ConnectionFormValues,
  type DraftStore,
  type FormDraft,
  type FormErrors,
  type FormField,
  type MutationResultIdentity,
  type PendingMutation,
  type PendingMutationState,
} from './ui-state';
import {
  CURRENT_SCHEMA_VERSION,
  type ChildrenMode,
  type ClearConnectionHandler,
  type ComponentInventoryState,
  type ComponentInventoryStateHandler,
  type ComponentTargetStateHandler,
  type ExportTokensHandler,
  type ExportTokensResultHandler,
  type ApplyConnectionImportHandler,
  type ApplyConnectionImportResultHandler,
  type ConnectionImportPlanEntry,
  type ExportConnectionsHandler,
  type ExportConnectionsResultHandler,
  type PreviewConnectionImportHandler,
  type PreviewConnectionImportResultHandler,
  type GenerateStoriesHandler,
  type GenerateStoriesResultHandler,
  type GenerateCodeConnectHandler,
  type GenerateCodeConnectResultHandler,
  type StorybookVariantOption,
  type LoadOutputPreferencesHandler,
  type LoadOutputPreferencesResultHandler,
  type SaveOutputPreferencesHandler,
  type SaveOutputPreferencesResultHandler,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type LoadTokenCollectionsHandler,
  type LoadTokenCollectionsResultHandler,
  type MappingDocument,
  type OpenComponentTargetHandler,
  type PropMappings,
  type PreviewTokensHandler,
  type PreviewTokensResultHandler,
  type RefreshSelectionHandler,
  type ScanComponentsHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type CanvasTargetStateHandler,
  type SourcePropValue,
  type UiTargetState,
  type DocFrameSelectedHandler,
  type GenerateTokenDocsHandler,
  type GenerateTokenDocsResultHandler,
  type UpdateDocsInPlaceHandler,
  type UpdateDocsInPlaceResultHandler,
  type GenerateComponentDocsHandler,
  type GenerateComponentDocsResultHandler,
  type DocGenerationProgressHandler,
} from './types';
import type { DocDriftReport, DocFrameMetadata } from './documentation/types';
import type {
  ExportFile,
  ExportOptions,
  TokenCollectionSummary,
} from './sync-tokens/types';
import { downloadBlob } from './ui-download';
import { DEFAULT_OUTPUT_PREFERENCES, type OutputPreferences } from './output-preferences';

export type ConnectionController = {
  activePendingOperation?: PendingMutation['operation'];
  cancelClear: () => void;
  clear: () => void;
  clearCancelButtonRef: { current: HTMLButtonElement | null };
  errorMessage: string;
  fieldErrors: FormErrors;
  formValues: ConnectionFormValues;
  inspectCodeState: InspectCodeState;
  inventoryState: ComponentInventoryState;
  isClearConfirmationOpen: boolean;
  isDirty: boolean;
  isReady: boolean;
  isSourceUploading: boolean;
  connectionHealth?: ConnectionHealth;
  closeTarget: () => void;
  openInventoryTarget: (targetToken: string) => void;
  reconcileFigma: () => void;
  removeStaleMapping: (sourcePropName: string) => void;
  rescanComponents: (includeCoverage?: boolean) => void;
  save: () => void;
  scaffold: () => void;
  targetOrigin?: 'inventory' | 'canvas';
  targetState: UiTargetState;
  targetStatusAnnouncement: string;
  semanticRecipe?: SemanticConnectionRecipe;
  semanticProposals: ReconciliationProposal[];
  applySemanticProposal: (
    proposal: ReconciliationProposal,
    action: ReconciliationAction,
  ) => void;
  exportDebugBundle: () => void;
  exportReport: (format: 'markdown' | 'json') => void;
  generateCodeConnect: (targetToken: string) => void;
  isSourceReplacementPending: boolean;
  sourceReplacementCancelRef: { current: HTMLButtonElement | null };
  confirmSourceReplacement: () => void;
  cancelSourceReplacement: () => void;
  setChildrenMode: (value: ChildrenMode) => void;
  setCustomPropMappings: (value: string) => void;
  setFormField: (field: FormField, value: string) => void;
  setMappedProperty: (sourcePropName: string, figmaPropertyId: string) => void;
  setMappedValue: (
    sourcePropName: string,
    sourceValue: SourcePropValue,
    figmaValue: string,
  ) => void;
  setSemanticOption: (
    targetPath: readonly string[],
    optionId: string,
    staticValue?: SourcePropValue,
  ) => void;
  setSemanticRepeatedInstances: (
    targetPath: readonly string[],
    orderedOptionIds: readonly string[],
  ) => void;
  setSemanticValueMapping: (
    targetPath: readonly string[],
    sourceValue: SourcePropValue,
    figmaOption: string,
  ) => void;
  statusMessage: string;
  uploadSourceFiles: (files: readonly File[]) => Promise<void>;
  /** Sync Tokens tab. */
  tokenCollections: readonly TokenCollectionSummary[];
  tokenCollectionsStatus: 'idle' | 'loading' | 'error';
  tokenCollectionsError: string;
  tokensExportStatus: 'idle' | 'exporting' | 'error';
  tokensExportError: string;
  tokensExportSuccess: string;
  tokensPreviewStatus: 'idle' | 'loading' | 'error';
  tokensPreviewError: string;
  tokensPreviewFiles: readonly ExportFile[];
  loadTokenCollections: () => void;
  exportTokens: (collectionIds: readonly string[], options: ExportOptions) => void;
  previewTokens: (collectionIds: readonly string[], options: ExportOptions) => void;
  connectionImportEntries: readonly ConnectionImportPlanEntry[];
  connectionPortabilityMessage: string;
  exportConnections: () => void;
  previewConnectionImport: (file: File) => Promise<void>;
  applyConnectionImport: (choices: Array<{ action: 'overwrite' | 'skip'; imported: import('./types').ConnectionMetadata; targetToken: string }>) => void;
  generateStories: (targetToken: string, selectedVariantTokens?: string[]) => void;
  storybookGeneration: {
    code?: string;
    fileName?: string;
    message?: string;
    status: 'idle' | 'loading' | 'ready' | 'select' | 'error';
    variants?: readonly StorybookVariantOption[];
  };
  outputPreferences: OutputPreferences;
  outputPreferencesMessage: string;
  setOutputPreferences: (preferences: OutputPreferences) => void;
  selectedDocFrame: {
    frameNodeId?: string;
    metadata?: DocFrameMetadata;
    drift?: DocDriftReport;
  } | null;
  docGenerationStatus: 'error' | 'idle' | 'running' | 'success';
  docGenerationMessage: string;
  docProgress: { message: string; percent: number } | null;
  cancelDocGeneration: () => void;
  generateTokenDocs: (collectionId: string, targetFormat?: 'canvas' | 'markdown') => void;
  updateDocsInPlace: (frameNodeId: string) => void;
  generateComponentDocs: (targetToken: string, targetFormat?: 'canvas' | 'markdown') => void;
};

export function useConnectionController(): ConnectionController {
  const [targetState, setTargetState] = useState<UiTargetState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
  const [targetOrigin, setTargetOrigin] = useState<'inventory' | 'canvas'>();
  const targetOriginRef = useRef<'inventory' | 'canvas'>();
  const [inventoryState, setInventoryState] = useState<ComponentInventoryState>({
    scannedPages: 0,
    status: 'scanning',
    totalPages: 0,
  });
  const [connectionImportEntries, setConnectionImportEntries] = useState<readonly ConnectionImportPlanEntry[]>([]);
  const [connectionPortabilityMessage, setConnectionPortabilityMessage] = useState('');
  const [storybookGeneration, setStorybookGeneration] = useState<ConnectionController['storybookGeneration']>({ status: 'idle' });
  const [outputPreferences, setOutputPreferencesState] = useState<OutputPreferences>({ ...DEFAULT_OUTPUT_PREFERENCES });
  const [outputPreferencesMessage, setOutputPreferencesMessage] = useState('');
  const initialFormValues = createFormValues();
  const [formValues, setFormValuesState] = useState(initialFormValues);
  const formValuesRef = useRef(initialFormValues);
  const draftsRef = useRef<DraftStore>(new Map());
  const activeTargetTokenRef = useRef<string>();
  const targetStateRef = useRef<UiTargetState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
  const scanSequenceRef = useRef(0);
  const targetRequestSequenceRef = useRef(0);
  const currentScanIdRef = useRef('');
  const currentTargetRequestIdRef = useRef('');
  const initialPendingMutations = createPendingMutationState();
  const pendingMutationsRef = useRef<PendingMutationState>(initialPendingMutations);
  const [pendingMutations, setPendingMutationsState] = useState(initialPendingMutations);
  const clearCancelButtonRef = useRef<HTMLButtonElement>(null);
  const sourceReplacementCancelRef = useRef<HTMLButtonElement>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [inspectCodeState, setInspectCodeState] = useState<InspectCodeState>({
    status: 'invalid-selection',
  });
  // --- Sync Tokens state ---
  const [tokenCollections, setTokenCollections] = useState<readonly TokenCollectionSummary[]>([]);
  const [tokenCollectionsStatus, setTokenCollectionsStatus] =
    useState<'idle' | 'loading' | 'error'>('idle');
  const [tokenCollectionsError, setTokenCollectionsError] = useState('');
  const [tokensExportStatus, setTokensExportStatus] = useState<'idle' | 'exporting' | 'error'>('idle');
  const [tokensExportError, setTokensExportError] = useState('');
  const [tokensExportSuccess, setTokensExportSuccess] = useState('');
  const [tokensPreviewStatus, setTokensPreviewStatus] =
    useState<'idle' | 'loading' | 'error'>('idle');
  const [tokensPreviewError, setTokensPreviewError] = useState('');
  const [tokensPreviewFiles, setTokensPreviewFiles] = useState<readonly ExportFile[]>([]);
  const latestTokensExportIdRef = useRef('');
  const latestTokensPreviewIdRef = useRef('');
  const tokensExportSequenceRef = useRef(0);
  const tokensPreviewSequenceRef = useRef(0);
  const [isSourceUploading, setIsSourceUploading] = useState(false);
  const [isSourceReplacementPending, setIsSourceReplacementPending] = useState(false);
  const pendingSourceFilesRef = useRef<readonly File[]>();
  const sourceUploadIdRef = useRef(0);
  const sourceVerifiedSelectionsRef = useRef<Set<string>>(new Set());
  const savedMappingDocumentsRef = useRef<Map<string, MappingDocument>>(new Map());

  const [selectedDocFrame, setSelectedDocFrame] = useState<{
    frameNodeId?: string;
    metadata?: DocFrameMetadata;
    drift?: DocDriftReport;
  } | null>(null);
  const [docGenerationStatus, setDocGenerationStatus] = useState<'error' | 'idle' | 'running' | 'success'>('idle');
  const [docGenerationMessage, setDocGenerationMessage] = useState<string>('');
  const [docProgress, setDocProgress] = useState<{ message: string; percent: number } | null>(null);

  const isReady = targetState.status === 'ready';
  const targetStatusAnnouncement = getTargetStatusAnnouncement(targetState);
  const activePendingMutation = targetState.status === 'ready'
    ? getPendingMutationForTarget(pendingMutations, targetState.targetToken)
    : undefined;

  useEffect(() => {
    if (isClearConfirmationOpen) {
      clearCancelButtonRef.current?.focus();
    }
  }, [isClearConfirmationOpen]);

  // An alertdialog must receive focus when it opens; land on the safe
  // (non-destructive) "Keep current" choice.
  useEffect(() => {
    if (isSourceReplacementPending) {
      sourceReplacementCancelRef.current?.focus();
    }
  }, [isSourceReplacementPending]);

  useEffect(() => {
    const offCanvasTargetState = on<CanvasTargetStateHandler>(
      'CANVAS_TARGET_STATE',
      ({ source, state }) => {
        if (
          source === 'selectionchange'
          && state.status === 'ready'
          && targetOriginRef.current !== 'inventory'
        ) {
          applyTargetState(state, 'canvas');
        }
      },
    );

    const offComponentTargetState = on<ComponentTargetStateHandler>(
      'COMPONENT_TARGET_STATE',
      ({ requestId, state }) => {
        if (requestId !== currentTargetRequestIdRef.current) {
          return;
        }
        applyTargetState(state, 'inventory');
      },
    );

    const offInventoryState = on<ComponentInventoryStateHandler>(
      'COMPONENT_INVENTORY_STATE',
      ({ scanId, state }) => {
        if (scanId === currentScanIdRef.current) {
          setInventoryState(state);
        }
      },
    );
    const offConnectionExport = on<ExportConnectionsResultHandler>('EXPORT_CONNECTIONS_RESULT', (result) => {
      if (!result.ok || !result.json) { setConnectionPortabilityMessage(result.message || 'Could not export connections.'); return; }
      downloadBlob(new Blob([result.json], { type: 'application/json' }), 'tashil-connections.json');
      setConnectionPortabilityMessage('Downloaded tashil-connections.json.');
    });
    const offConnectionImportPreview = on<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', (result) => {
      setConnectionImportEntries(result.entries ?? []);
      setConnectionPortabilityMessage(result.ok ? 'Import preview ready. Review conflicts before applying.' : result.message || 'Could not read the import.');
    });
    const offConnectionImportApply = on<ApplyConnectionImportResultHandler>('APPLY_CONNECTION_IMPORT_RESULT', (result) => {
      setConnectionPortabilityMessage(result.ok ? `Imported ${result.applied} connection${result.applied === 1 ? '' : 's'}.` : result.message || 'Could not apply the import.');
      if (result.ok) { setConnectionImportEntries([]); rescanComponents(false); }
    });
    const offStories = on<GenerateStoriesResultHandler>('GENERATE_STORIES_RESULT', (result) => {
      if (result.ok && result.code) {
        setStorybookGeneration({ code: result.code, fileName: result.fileName, status: 'ready' });
      } else if (result.variants) {
        setStorybookGeneration({ message: result.message, status: 'select', variants: result.variants });
      } else {
        setStorybookGeneration({ message: result.message || 'Could not generate stories.', status: 'error' });
      }
    });
    const offCodeConnect = on<GenerateCodeConnectResultHandler>('GENERATE_CODE_CONNECT_RESULT', (result) => {
      if (!result.ok || !result.code || !result.fileName) {
        setStatusMessage('');
        setErrorMessage(result.message || 'Could not generate Code Connect output.');
        return;
      }
      downloadBlob(new Blob([result.code], { type: 'text/typescript' }), result.fileName);
      setErrorMessage('');
      setStatusMessage(`Downloaded ${result.fileName}.`);
    });
    const offOutputPreferences = on<LoadOutputPreferencesResultHandler>('LOAD_OUTPUT_PREFERENCES_RESULT', ({ preferences }) => {
      setOutputPreferencesState(preferences);
    });
    const offSaveOutputPreferences = on<SaveOutputPreferencesResultHandler>('SAVE_OUTPUT_PREFERENCES_RESULT', (result) => {
      setOutputPreferencesMessage(result.ok ? 'Settings saved for this user.' : result.message || 'Could not save settings.');
      if (result.ok) emit<RefreshSelectionHandler>('REFRESH_SELECTION');
    });

    const offSaveResult = on<SaveResultHandler>('SAVE_RESULT', (result) => {
      handleSaveResult(result);
    });

    const offInspectCodeState = on<InspectCodeStateHandler>('INSPECT_CODE_STATE', (state) => {
      setInspectCodeState(state);
    });

    const offScaffoldResult = on<ScaffoldResultHandler>('SCAFFOLD_RESULT', (result) => {
      const targetToken = result.targetToken;
      const pendingMutation = completePendingMutation({
        operation: 'scaffold',
        operationId: result.operationId,
        targetToken,
      });

      if (!pendingMutation) {
        return;
      }

      if (!result.ok) {
        if (activeTargetTokenRef.current === targetToken) {
          setStatusMessage('');
          setErrorMessage(result.message || 'Could not scaffold prop mappings.');
        }
        return;
      }

      mergePropMappings(targetToken, result.mappings ?? {});
    });

    const offTokenCollections = on<LoadTokenCollectionsResultHandler>('LOAD_TOKEN_COLLECTIONS_RESULT', (result) => {
      if (result.ok) {
        setTokenCollections(result.collections ?? []);
        setTokenCollectionsError('');
        setTokenCollectionsStatus('idle');
      } else {
        setTokenCollectionsError(result.message || 'Could not load variable collections.');
        setTokenCollectionsStatus('error');
      }
    });

    const offTokensExport = on<ExportTokensResultHandler>('EXPORT_TOKENS_RESULT', (result) => {
      if (result.operationId !== latestTokensExportIdRef.current) {
        return; // superseded
      }
      if (!result.ok) {
        setTokensExportError(result.message || 'Could not export tokens.');
        setTokensExportStatus('error');
        return;
      }
      setTokensExportError('');
      // Deliver files to the user. Deferred so we keep the message handler cheap.
      void deliverTokenFiles(result.files ?? []);
    });

    const offTokensPreview = on<PreviewTokensResultHandler>('PREVIEW_TOKENS_RESULT', (result) => {
      if (result.operationId !== latestTokensPreviewIdRef.current) {
        return; // superseded
      }
      if (!result.ok) {
        setTokensPreviewError(result.message || 'Could not preview tokens.');
        setTokensPreviewStatus('error');
        return;
      }
      setTokensPreviewError('');
      setTokensPreviewFiles(result.files ?? []);
      setTokensPreviewStatus('idle');
    });

    const offDocFrameSelected = on<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', (payload) => {
      setSelectedDocFrame(payload.metadata ? payload : null);
    });

    const offDocProgress = on<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', (payload) => {
      setDocProgress(payload);
      setDocGenerationMessage(payload.message);
    });

    const offTokenDocsResult = on<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', (result) => {
      setDocGenerationStatus(result.ok ? 'success' : 'error');
      setDocGenerationMessage(result.message);
      setDocProgress(null);
    });

    const offUpdateDocsResult = on<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', (result) => {
      setDocGenerationStatus(result.ok ? 'success' : 'error');
      setDocGenerationMessage(result.message);
      setDocProgress(null);
    });

    const offComponentDocsResult = on<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', (result) => {
      setDocGenerationStatus(result.ok ? 'success' : 'error');
      setDocGenerationMessage(result.message);
      setDocProgress(null);
    });

    rescanComponents(false);
    emit<RefreshSelectionHandler>('REFRESH_SELECTION');
    emit<LoadOutputPreferencesHandler>('LOAD_OUTPUT_PREFERENCES');

    return () => {
      offCanvasTargetState();
      offComponentTargetState();
      offInventoryState();
      offConnectionExport();
      offConnectionImportPreview();
      offConnectionImportApply();
      offStories();
      offCodeConnect();
      offOutputPreferences();
      offSaveOutputPreferences();
      offSaveResult();
      offInspectCodeState();
      offScaffoldResult();
      offTokenCollections();
      offTokensExport();
      offTokensPreview();
      offDocFrameSelected();
      offDocProgress();
      offTokenDocsResult();
      offUpdateDocsResult();
      offComponentDocsResult();
    };
  }, []);

  function applyTargetState(
    state: UiTargetState,
    origin: 'inventory' | 'canvas',
  ): void {
    const previousToken = activeTargetTokenRef.current;
    targetStateRef.current = state;
    setTargetState(state);
    setErrorMessage('');
    setFieldErrors({});

    if (state.status !== 'ready') {
      sourceUploadIdRef.current += 1;
      setIsSourceUploading(false);
      if (origin === 'inventory') {
        activeTargetTokenRef.current = undefined;
        displayFormDraft(createFormDraft(createFormValues()));
      }
      setStatusMessage('');
      setIsClearConfirmationOpen(false);
      targetOriginRef.current = origin;
      setTargetOrigin(origin);
      return;
    }

    const result = selectFormDraft(draftsRef.current, state);
    if (state.existingConnection?.mappingDocument) {
      savedMappingDocumentsRef.current.set(
        state.targetToken,
        state.existingConnection.mappingDocument,
      );
    } else {
      savedMappingDocumentsRef.current.delete(state.targetToken);
    }
    if (previousToken !== state.targetToken) {
      setStorybookGeneration({ status: 'idle' });
      sourceUploadIdRef.current += 1;
      setIsSourceUploading(false);
    }
    draftsRef.current = result.drafts;
    activeTargetTokenRef.current = state.targetToken;
    targetOriginRef.current = origin;
    setTargetOrigin(origin);
    displayFormDraft(result.draft!);

    if (previousToken !== state.targetToken) {
      setStatusMessage(result.restored
        ? 'Restored your unsaved changes for this component.'
        : '');
      setIsClearConfirmationOpen(false);
    } else if (!state.existingConnection || state.connectionIssue) {
      setIsClearConfirmationOpen(false);
    }
  }

  function rescanComponents(includeCoverage = true): void {
    const scanId = `scan-${Date.now()}-${++scanSequenceRef.current}`;
    currentScanIdRef.current = scanId;
    setInventoryState({
      scannedPages: 0,
      status: 'scanning',
      totalPages: 0,
    });
    emit<ScanComponentsHandler>('SCAN_COMPONENTS', { includeCoverage, scanId });
  }

  function exportConnections(): void { setConnectionPortabilityMessage('Preparing connection export…'); emit<ExportConnectionsHandler>('EXPORT_CONNECTIONS'); }
  async function previewConnectionImport(file: File): Promise<void> {
    if (file.size > 2_000_000) { setConnectionPortabilityMessage('The import is larger than the 2 MB safety limit.'); return; }
    setConnectionPortabilityMessage('Reading connection import…');
    emit<PreviewConnectionImportHandler>('PREVIEW_CONNECTION_IMPORT', { raw: await file.text() });
  }
  function applyConnectionImport(choices: Array<{ action: 'overwrite' | 'skip'; imported: import('./types').ConnectionMetadata; targetToken: string }>): void {
    setConnectionPortabilityMessage('Applying confirmed connections…');
    emit<ApplyConnectionImportHandler>('APPLY_CONNECTION_IMPORT', { choices });
  }
  function generateStories(targetToken: string, selectedVariantTokens?: string[]): void {
    setStorybookGeneration({ status: 'loading' });
    emit<GenerateStoriesHandler>('GENERATE_STORIES', { selectedVariantTokens, targetToken });
  }
  function generateCodeConnect(targetToken: string): void {
    setErrorMessage('');
    setStatusMessage('Generating Code Connect output…');
    emit<GenerateCodeConnectHandler>('GENERATE_CODE_CONNECT', { targetToken });
  }
  function setOutputPreferences(preferences: OutputPreferences): void {
    setOutputPreferencesState(preferences);
    setOutputPreferencesMessage('Saving settings…');
    emit<SaveOutputPreferencesHandler>('SAVE_OUTPUT_PREFERENCES', { preferences });
  }

  function openInventoryTarget(targetToken: string): void {
    const requestId = `target-${Date.now()}-${++targetRequestSequenceRef.current}`;
    currentTargetRequestIdRef.current = requestId;
    emit<OpenComponentTargetHandler>('OPEN_COMPONENT_TARGET', {
      requestId,
      targetToken,
    });
  }

  function closeTarget(): void {
    sourceUploadIdRef.current += 1;
    setIsSourceUploading(false);
    activeTargetTokenRef.current = undefined;
    targetOriginRef.current = undefined;
    setTargetOrigin(undefined);
    const emptyState: UiTargetState = {
      status: 'empty',
      message: 'Choose a component from the inventory.',
    };
    targetStateRef.current = emptyState;
    setTargetState(emptyState);
    setFieldErrors({});
    setErrorMessage('');
    setStatusMessage('');
    setIsClearConfirmationOpen(false);
  }

  function handleSaveResult(result: Parameters<SaveResultHandler['handler']>[0]): void {
    const targetToken = result.targetToken;
    const pendingMutation = completePendingMutation({
      operation: result.operation,
      operationId: result.operationId,
      targetToken,
    });

    if (!pendingMutation) {
      return;
    }

    const isActiveTarget = activeTargetTokenRef.current === targetToken;

    if (result.operation === 'save' && pendingMutation.operation === 'save') {
      const draft = draftsRef.current.get(targetToken);

      if (result.ok && draft) {
        let confirmedValues = pendingMutation.submittedValues;
        let confirmedDocument: MappingDocument | undefined;
        const submittedDocument = readMappingDocument(
          pendingMutation.submittedValues.mappingDocument,
        );
        if (submittedDocument) {
          const currentTarget = targetStateRef.current;
          const savedDocument: MappingDocument = {
            ...submittedDocument,
            figmaSnapshot: currentTarget.status === 'ready'
              && currentTarget.targetToken === targetToken
              && currentTarget.figmaSnapshot
              ? currentTarget.figmaSnapshot
              : submittedDocument.figmaSnapshot,
            lastValidatedAt: new Date().toISOString(),
            revision: submittedDocument.revision + 1,
          };
          confirmedDocument = savedDocument;
          savedMappingDocumentsRef.current.set(targetToken, savedDocument);
          confirmedValues = {
            ...confirmedValues,
            mappingDocument: JSON.stringify(savedDocument, null, 2),
          };
        }

        let savedDraft = markFormDraftSaved(draft, pendingMutation.submittedValues);
        if (savedDraft !== draft && confirmedValues !== pendingMutation.submittedValues) {
          savedDraft = createFormDraft(confirmedValues);
        } else if (savedDraft === draft) {
          const editedDocument = readMappingDocument(draft.values.mappingDocument);
          const rebasedValues = confirmedDocument && editedDocument
            ? {
                ...draft.values,
                mappingDocument: JSON.stringify({
                  ...editedDocument,
                  revision: confirmedDocument.revision,
                }, null, 2),
              }
            : draft.values;
          savedDraft = {
            baseline: confirmedValues,
            isDirty: true,
            values: rebasedValues,
          };
        }
        const nextDrafts = new Map(draftsRef.current);
        nextDrafts.set(targetToken, savedDraft);
        draftsRef.current = nextDrafts;
        if (isActiveTarget) {
          displayFormDraft(savedDraft);
        }

      }
    } else if (result.ok) {
      const cleared = clearFormDraft(draftsRef.current, targetToken);
      draftsRef.current = cleared.drafts;

      if (isActiveTarget) {
        displayFormDraft(cleared.draft);
      }
    }

    if (result.ok) {
      const status = result.operation === 'save' ? 'connected' : 'not-connected';
      setInventoryState((current) => (
        current.status === 'ready' || current.status === 'partial'
          ? {
              ...current,
              items: current.items.map((item) => (
                item.targetToken === targetToken
                  ? { ...item, status }
                  : item
              )),
            }
          : current
      ));
    }

    if (isActiveTarget) {
      if (result.ok && result.targetState) {
        targetStateRef.current = result.targetState;
        setTargetState(result.targetState);
      }
      setErrorMessage(result.ok ? '' : result.message);
      setStatusMessage(result.ok ? result.message : '');
      setIsClearConfirmationOpen(false);
    }
  }

  function setPendingMutations(state: PendingMutationState): void {
    pendingMutationsRef.current = state;
    setPendingMutationsState(state);
  }

  function beginPendingMutation(mutation: PendingMutation): boolean {
    const result = startPendingMutation(pendingMutationsRef.current, mutation);
    if (!result.started) {
      return false;
    }

    setPendingMutations(result.state);
    setIsClearConfirmationOpen(false);
    return true;
  }

  function completePendingMutation(identity: MutationResultIdentity): PendingMutation | undefined {
    const result = finishPendingMutation(pendingMutationsRef.current, identity);
    if (!result.mutation) {
      return undefined;
    }

    setPendingMutations(result.state);
    return result.mutation;
  }

  function mergePropMappings(targetToken: string, incoming: PropMappings): void {
    const draft = draftsRef.current.get(targetToken);
    if (!draft) {
      return;
    }

    const result = mergePropMappingsJson(draft.values.propMappings, incoming);

    if (!result.ok) {
      if (activeTargetTokenRef.current === targetToken) {
        setStatusMessage('');
        setErrorMessage(result.message);
      }
      return;
    }

    const updatedDraft = updateFormDraft(draft, 'propMappings', result.value);
    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(targetToken, updatedDraft);
    draftsRef.current = nextDrafts;

    if (activeTargetTokenRef.current === targetToken) {
      displayFormDraft(updatedDraft);
      setFieldErrors((current) => ({ ...current, propMappings: undefined }));
      setErrorMessage('');
      setStatusMessage('Generated prop mappings from the selected component.');
    }
  }

  function displayFormDraft(draft: FormDraft): void {
    formValuesRef.current = draft.values;
    setFormValuesState(draft.values);
    setIsDirty(draft.isDirty);
  }

  function setFormField(field: FormField, value: string): void {
    const targetToken = activeTargetTokenRef.current;
    if (!targetToken) {
      return;
    }

    const draft = draftsRef.current.get(targetToken)
      ?? createFormDraft(formValuesRef.current);
    const updatedDraft = updateFormDraft(draft, field, value);
    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(targetToken, updatedDraft);
    draftsRef.current = nextDrafts;
    displayFormDraft(updatedDraft);
    setFieldErrors((current) => ({ ...current, [field]: undefined }));
    setErrorMessage('');
    setStatusMessage('');
    setIsClearConfirmationOpen(false);
  }

  function setChildrenMode(value: ChildrenMode): void {
    setFormField('childrenMode', value);
    setFieldErrors((current) => ({
      ...current,
      childrenTextProperty: undefined,
      iconComponentName: undefined,
      iconImportPath: undefined,
    }));
  }

  function readMappingDocument(value = formValuesRef.current.mappingDocument): MappingDocument | undefined {
    if (value.trim() === '') {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      return isMappingDocument(parsed) ? parsed : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function readSemanticRecipe(
    value = formValuesRef.current.semanticRecipe,
  ): SemanticConnectionRecipe | undefined {
    if (value.trim() === '') {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      const validation = validateSemanticRecipe(parsed);
      return validation.ok ? validation.recipe : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function setSemanticOption(
    targetPath: readonly string[],
    optionId: string,
    staticValue?: string | number | boolean,
  ): void {
    const recipe = readSemanticRecipe();
    const currentTarget = targetStateRef.current;
    if (!recipe || currentTarget.status !== 'ready') {
      return;
    }

    const updated = setTargetOption(
      recipe,
      currentTarget.figmaSnapshot,
      targetPath,
      optionId,
      staticValue,
    );
    setFormField('semanticRecipe', JSON.stringify(updated));
  }

  function setSemanticRepeatedInstances(
    targetPath: readonly string[],
    orderedOptionIds: readonly string[],
  ): void {
    const recipe = readSemanticRecipe();
    if (!recipe) {
      return;
    }
    const updated = setRepeatedTargetInstances(recipe, targetPath, orderedOptionIds);
    setFormField('semanticRecipe', JSON.stringify(updated));
  }

  /**
   * Export a redacted debug bundle for the current connection. The bundle is
   * assembled from the working recipe and current health, then downloaded as
   * JSON. It contains no source text, reference URLs, design content, or layer
   * names — see `debug-bundle.ts` for the data policy.
   */
  function exportDebugBundle(): void {
    const target = targetStateRef.current;
    if (target.status !== 'ready') {
      setErrorMessage('Open a component before exporting a debug bundle.');
      return;
    }

    const recipe = readSemanticRecipe();
    const bundle = createConnectionDebugBundle({
      componentName: formValuesRef.current.componentName.trim() || target.componentName,
      connectionSchemaVersion: CURRENT_SCHEMA_VERSION,
      importPath: formValuesRef.current.importPath.trim(),
      ...(recipe
        ? {
            healthIssues: evaluateSemanticHealth(
              recipe,
              target.semanticSnapshot,
              recipe.sourceContract,
            ),
            recipe,
          }
        : {}),
      references: {
        sourcePath: formValuesRef.current.sourcePath.trim() || undefined,
        sourceUrl: formValuesRef.current.sourceUrl.trim() || undefined,
        storybookUrl: formValuesRef.current.storybookUrl.trim() || undefined,
      },
    });

    const fileName = `tashil-connection-debug-${bundle.componentName}.json`;
    try {
      downloadBlob(
        new Blob([serializeConnectionDebugBundle(bundle)], { type: 'application/json' }),
        fileName,
      );
      setErrorMessage('');
      setStatusMessage(`Exported ${fileName}.`);
    } catch (_error) {
      setStatusMessage('');
      setErrorMessage('Could not export the debug bundle.');
    }
  }

  /**
   * Export the compatibility report for the current component (roadmap M7).
   * Derived from the live source contract — target-kind counts and unsupported
   * paths only — so it matches the CI audit without re-parsing source or
   * touching raw uploads. The report never leaves the browser.
   */
  function exportReport(format: 'markdown' | 'json'): void {
    const recipe = readSemanticRecipe();
    const contract = recipe?.pendingSourceContract ?? recipe?.sourceContract;
    if (!contract) {
      setErrorMessage('Upload source before exporting a compatibility report.');
      return;
    }

    const report = createComponentAuditReport(contract);
    const isMarkdown = format === 'markdown';
    const body = isMarkdown
      ? formatComponentAuditMarkdown(report)
      : serializeComponentAuditJson(report);
    const fileName = `tashil-compatibility-${report.componentName}.${isMarkdown ? 'md' : 'json'}`;
    try {
      downloadBlob(
        new Blob([body], { type: isMarkdown ? 'text/markdown' : 'application/json' }),
        fileName,
      );
      setErrorMessage('');
      setStatusMessage(`Exported ${fileName}.`);
    } catch (_error) {
      setStatusMessage('');
      setErrorMessage('Could not export the compatibility report.');
    }
  }

  function setSemanticValueMapping(
    targetPath: readonly string[],
    sourceValue: SourcePropValue,
    figmaOption: string,
  ): void {
    const recipe = readSemanticRecipe();
    if (!recipe) {
      return;
    }
    setFormField(
      'semanticRecipe',
      JSON.stringify(setTargetValueMapping(recipe, targetPath, sourceValue, figmaOption)),
    );
  }

  function applySemanticProposal(
    proposal: ReconciliationProposal,
    action: ReconciliationAction,
  ): void {
    const recipe = readSemanticRecipe();
    if (!recipe) {
      return;
    }
    const updated = applyProposal(recipe, proposal, action);
    setFormField('semanticRecipe', JSON.stringify(updated));
    if (
      action === 'accept'
      && (
        proposal.kind === 'source-contract-update'
        || proposal.kind === 'component-alias-changed'
      )
    ) {
      setFormField('componentName', proposal.newContract.componentName);
    }
    const contractUpdate = proposal.kind === 'source-contract-update'
      || proposal.kind === 'component-alias-changed';
    setStatusMessage(contractUpdate
      ? action === 'accept'
        ? 'Accepted the uploaded source contract.'
        : 'Kept the current source contract.'
      : action === 'remove'
        ? `Removed the stale mapping for ${proposal.targetPath}.`
        : `Remapped ${proposal.targetPath}.`);
  }

  function readPropMappings(): PropMappings {
    try {
      const parsed = JSON.parse(formValuesRef.current.propMappings || '{}') as unknown;
      return isRecord(parsed) && isPropMappings(parsed) ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function readCustomPropMappings(
    value = formValuesRef.current.customPropMappings,
  ): PropMappings | undefined {
    try {
      const parsed = JSON.parse(value || '{}') as unknown;
      return isRecord(parsed) && isPropMappings(parsed) ? parsed : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function applyMappingDocument(document: MappingDocument, message: string): void {
    const targetToken = activeTargetTokenRef.current;
    if (!targetToken) {
      return;
    }

    const previousDocument = readMappingDocument();
    const preservedMappings = previousDocument
      ? readCustomPropMappings() ?? {}
      : extractAdvancedPropMappings(readPropMappings(), document);
    const compiled = compileMappingDocument(document, preservedMappings);
    const draft = draftsRef.current.get(targetToken)
      ?? createFormDraft(formValuesRef.current);
    let updatedDraft = updateFormDraft(
      draft,
      'mappingDocument',
      JSON.stringify(document, null, 2),
    );
    if (!previousDocument) {
      updatedDraft = updateFormDraft(
        updatedDraft,
        'customPropMappings',
        Object.keys(preservedMappings).length > 0
          ? JSON.stringify(preservedMappings, null, 2)
          : '',
      );
    }
    updatedDraft = updateFormDraft(
      updatedDraft,
      'propMappings',
      JSON.stringify(compiled, null, 2),
    );
    const sourceHasChildren = document.sourceSnapshot
      ? document.sourceSnapshot.props.some((prop) => prop.role === 'children')
      : undefined;
    if (sourceHasChildren !== undefined && draft.values.childrenMode !== 'icon-only') {
      updatedDraft = updateFormDraft(
        updatedDraft,
        'childrenMode',
        sourceHasChildren ? 'text' : 'none',
      );
    }
    if (sourceHasChildren) {
      const childrenMapping = document.mappings.find(
        (mapping) => mapping.kind === 'children',
      );
      updatedDraft = updateFormDraft(
        updatedDraft,
        'childrenTextProperty',
        childrenMapping?.figmaPropertyName ?? '',
      );
    }
    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(targetToken, updatedDraft);
    draftsRef.current = nextDrafts;
    displayFormDraft(updatedDraft);
    setFieldErrors((current) => ({
      ...current,
      mappingDocument: undefined,
      propMappings: undefined,
    }));
    setErrorMessage('');
    setStatusMessage(message);
    setIsClearConfirmationOpen(false);
  }

  /**
   * Entry point for a source upload. When replacing source would invalidate
   * existing mappings (a saved semantic recipe with bindings, or a visual
   * mapping document), confirm first so the user does not silently lose work.
   */
  async function uploadSourceFiles(files: readonly File[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    if (sourceReplacementWouldInvalidate()) {
      pendingSourceFilesRef.current = files;
      setIsSourceReplacementPending(true);
      return;
    }
    await runSourceUpload(files);
  }

  /**
   * Replacing source only needs confirmation when it would discard *saved*
   * work: a persisted semantic recipe with bindings. A first-time in-session
   * draft (nothing saved yet) and legacy connections replace freely, so the
   * quick connect flow is never interrupted.
   */
  function sourceReplacementWouldInvalidate(): boolean {
    const target = targetStateRef.current;
    if (target.status !== 'ready') {
      return false;
    }
    const savedRecipe = target.existingConnection?.semanticRecipe;
    return Boolean(savedRecipe && savedRecipe.bindings.length > 0);
  }

  function confirmSourceReplacement(): void {
    const files = pendingSourceFilesRef.current;
    pendingSourceFilesRef.current = undefined;
    setIsSourceReplacementPending(false);
    if (files) {
      void runSourceUpload(files);
    }
  }

  function cancelSourceReplacement(): void {
    pendingSourceFilesRef.current = undefined;
    setIsSourceReplacementPending(false);
  }

  async function runSourceUpload(files: readonly File[]): Promise<void> {
    const currentTarget = targetStateRef.current;
    if (currentTarget.status !== 'ready' || !currentTarget.figmaSnapshot) {
      setErrorMessage('Select a Figma component with component properties first.');
      return;
    }

    const uploadId = sourceUploadIdRef.current + 1;
    sourceUploadIdRef.current = uploadId;
    const targetToken = currentTarget.targetToken;
    setIsSourceUploading(true);
    setErrorMessage('');
    setStatusMessage('Analyzing source files…');

    try {
      const collected = await collectSourceUploadInputs(files);
      if (!collected.ok) {
        setStatusMessage('');
        setErrorMessage(collected.message);
        return;
      }
      const inputs = collected.inputs;
      const result = parseSourceComponent(
        inputs,
        formValuesRef.current.componentName.trim() || currentTarget.componentName,
      );

      if (
        sourceUploadIdRef.current !== uploadId
        || activeTargetTokenRef.current !== targetToken
      ) {
        return;
      }

      if (!result.ok) {
        setStatusMessage('');
        setErrorMessage(result.message);
        return;
      }

      const acceptedRecipe = readSemanticRecipe();
      // Figma and source components have independent identities. A first
      // upload can select the parsed source export immediately; replacement
      // source stays pending so existing generation keeps its prior export.
      if (!acceptedRecipe?.sourceContract) {
        setFormField('componentName', result.snapshot.componentName);
      }

      const document = createMappingDocumentDraft(
        result.snapshot,
        currentTarget.figmaSnapshot,
        readPropMappings(),
        readMappingDocument(),
      );
      sourceVerifiedSelectionsRef.current.add(targetToken);
      applyMappingDocument(
        document,
        result.warnings.length > 0
          ? `Source analyzed with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`
          : `Found ${result.snapshot.props.length} props in ${result.snapshot.fileName}.`,
      );

      if (SEMANTIC_CONNECT_AUTHORING_ENABLED) {
        const contractResult = extractSourceContract(
          inputs,
          formValuesRef.current.componentName.trim() || currentTarget.componentName,
        );
        if (contractResult.ok) {
          const semanticSnapshot = currentTarget.semanticSnapshot ?? {
            componentId: targetToken,
            componentName: currentTarget.componentName,
            nestedSources: [],
          };
          const recipe = createRecipeDraft(
            contractResult.contract,
            currentTarget.figmaSnapshot,
            semanticSnapshot,
            acceptedRecipe,
          );
          setFormField('semanticRecipe', JSON.stringify(recipe));
        }
      }
    } catch (_error) {
      if (
        sourceUploadIdRef.current === uploadId
        && activeTargetTokenRef.current === targetToken
      ) {
        setStatusMessage('');
        setErrorMessage('Could not read the selected source files.');
      }
    } finally {
      if (sourceUploadIdRef.current === uploadId) {
        setIsSourceUploading(false);
      }
    }
  }

  function reconcileFigma(): void {
    const currentTarget = targetStateRef.current;
    const document = readMappingDocument();
    if (
      currentTarget.status !== 'ready'
      || !currentTarget.figmaSnapshot
      || !document?.sourceSnapshot
    ) {
      setErrorMessage('Upload source and select a Figma component before reconciling.');
      return;
    }

    applyMappingDocument(
      createMappingDocumentDraft(
        document.sourceSnapshot,
        currentTarget.figmaSnapshot,
        readPropMappings(),
        document,
      ),
      'Figma changes loaded. Review the mappings, then save to confirm them.',
    );
  }

  function removeStaleMapping(sourcePropName: string): void {
    const document = readMappingDocument();
    if (!document) {
      return;
    }
    applyMappingDocument(
      setMappedFigmaProperty(document, sourcePropName, ''),
      `Removed the stale ${sourcePropName} mapping. Save to confirm this update.`,
    );
  }

  function setMappedProperty(sourcePropName: string, figmaPropertyId: string): void {
    const document = readMappingDocument();
    if (!document) {
      return;
    }
    applyMappingDocument(
      setMappedFigmaProperty(document, sourcePropName, figmaPropertyId),
      'Property mapping updated.',
    );
  }

  function setMappedValue(
    sourcePropName: string,
    sourceValue: SourcePropValue,
    figmaValue: string,
  ): void {
    const document = readMappingDocument();
    if (!document) {
      return;
    }
    applyMappingDocument(
      setMappedFigmaValue(document, sourcePropName, sourceValue, figmaValue),
      'Value mapping updated.',
    );
  }

  function setCustomPropMappings(value: string): void {
    const targetToken = activeTargetTokenRef.current;
    if (!targetToken) {
      return;
    }

    const draft = draftsRef.current.get(targetToken)
      ?? createFormDraft(formValuesRef.current);
    let updatedDraft = updateFormDraft(draft, 'customPropMappings', value);
    const document = readMappingDocument(updatedDraft.values.mappingDocument);
    const customMappings = readCustomPropMappings(value);
    if (document && customMappings) {
      updatedDraft = updateFormDraft(
        updatedDraft,
        'propMappings',
        JSON.stringify(compileMappingDocument(document, customMappings), null, 2),
      );
    }

    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(targetToken, updatedDraft);
    draftsRef.current = nextDrafts;
    displayFormDraft(updatedDraft);
    setFieldErrors((current) => ({ ...current, customPropMappings: undefined }));
    setErrorMessage('');
    setStatusMessage('');
    setIsClearConfirmationOpen(false);
  }

  function save(): void {
    if (
      targetState.status !== 'ready'
      || activeTargetTokenRef.current !== targetState.targetToken
    ) {
      setErrorMessage('This component is no longer available. Open it again and retry.');
      return;
    }

    if (connectionHealth?.status === 'broken') {
      const message = 'Resolve broken source or Figma mappings before saving.';
      setFieldErrors((current) => ({ ...current, mappingDocument: message }));
      setStatusMessage('');
      setErrorMessage(message);
      return;
    }

    const validation = validateConnectionForm(formValuesRef.current);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      setStatusMessage('');
      setErrorMessage(validation.message);
      const firstInvalidField = getFirstInvalidField(validation.errors);
      if (firstInvalidField) {
        window.setTimeout(() => {
          document.getElementById(FORM_FIELD_IDS[firstInvalidField])?.focus();
        }, 0);
      }
      return;
    }

    const operationId = createMutationOperationId();
    if (!beginPendingMutation({
      operation: 'save',
      operationId,
      targetToken: targetState.targetToken,
      submittedValues: { ...formValuesRef.current },
    })) {
      return;
    }

    setFieldErrors({});
    setErrorMessage('');
    setStatusMessage('Saving connection…');
    emit<SaveConnectionHandler>('SAVE_CONNECTION', {
      metadata: validation.metadata,
      operationId,
      targetToken: targetState.targetToken,
    });
  }

  function scaffold(): void {
    if (
      targetState.status !== 'ready'
      || activeTargetTokenRef.current !== targetState.targetToken
    ) {
      setErrorMessage('This component is no longer available. Open it again and retry.');
      return;
    }

    const operationId = createMutationOperationId();
    if (!beginPendingMutation({
      operation: 'scaffold',
      operationId,
      targetToken: targetState.targetToken,
    })) {
      return;
    }

    setErrorMessage('');
    setStatusMessage('Generating prop mappings…');
    emit<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS', {
      operationId,
      targetToken: targetState.targetToken,
    });
  }

  function clear(): void {
    if (
      targetState.status !== 'ready'
      || activeTargetTokenRef.current !== targetState.targetToken
    ) {
      setErrorMessage('This component is no longer available. Open it again and retry.');
      return;
    }

    if (getPendingMutationForTarget(
      pendingMutationsRef.current,
      targetState.targetToken,
    )) {
      return;
    }

    if (getClearAction(isClearConfirmationOpen) === 'request-confirmation') {
      setIsClearConfirmationOpen(true);
      return;
    }

    const operationId = createMutationOperationId();
    if (!beginPendingMutation({
      operation: 'clear',
      operationId,
      targetToken: targetState.targetToken,
    })) {
      return;
    }

    setIsClearConfirmationOpen(false);
    setErrorMessage('');
    setStatusMessage('Clearing connection…');
    emit<ClearConnectionHandler>('CLEAR_CONNECTION', {
      operationId,
      targetToken: targetState.targetToken,
    });
  }

  function cancelClear(): void {
    setIsClearConfirmationOpen(false);
    window.setTimeout(() => {
      document.getElementById('tashil-clear-button')?.focus();
    }, 0);
  }

  const connectionHealth = targetState.status === 'ready'
    ? evaluateConnectionHealth(
        savedMappingDocumentsRef.current.get(targetState.targetToken)
          ?? targetState.existingConnection?.mappingDocument,
        targetState.figmaSnapshot,
        readMappingDocument(formValues.mappingDocument),
        sourceVerifiedSelectionsRef.current.has(targetState.targetToken),
        {
          intentionalFigmaPropertyPrefixes: parseIntentionalFigmaPropertyPrefixes(
            formValues.intentionalFigmaPropertyPrefixes,
          ),
        },
      )
    : undefined;

  const workingRecipe = readSemanticRecipe(formValues.semanticRecipe);
  const semanticProposals: ReconciliationProposal[] = SEMANTIC_CONNECT_AUTHORING_ENABLED
    && workingRecipe
    && targetState.status === 'ready'
      ? planReconciliation(
        workingRecipe,
        targetState.semanticSnapshot,
        workingRecipe.pendingSourceContract ?? workingRecipe.sourceContract,
      )
    : [];

  function loadTokenCollections(): void {
    setTokenCollectionsStatus('loading');
    setTokenCollectionsError('');
    emit<LoadTokenCollectionsHandler>('LOAD_TOKEN_COLLECTIONS');
  }

  function exportTokensAction(
    collectionIds: readonly string[],
    options: ExportOptions,
  ): void {
    if (collectionIds.length === 0) {
      setTokensExportError('Select at least one collection to export.');
      setTokensExportStatus('error');
      return;
    }
    const operationId = `tokens-${Date.now()}-${++tokensExportSequenceRef.current}`;
    latestTokensExportIdRef.current = operationId;
    setTokensExportError('');
    setTokensExportSuccess('');
    setTokensExportStatus('exporting');
    emit<ExportTokensHandler>('EXPORT_TOKENS', { operationId, collectionIds, options });
  }

  function previewTokensAction(
    collectionIds: readonly string[],
    options: ExportOptions,
  ): void {
    if (collectionIds.length === 0) {
      latestTokensPreviewIdRef.current = '';
      setTokensPreviewError('');
      setTokensPreviewFiles([]);
      setTokensPreviewStatus('idle');
      return;
    }
    const operationId = `tokens-preview-${Date.now()}-${++tokensPreviewSequenceRef.current}`;
    latestTokensPreviewIdRef.current = operationId;
    setTokensPreviewError('');
    setTokensPreviewStatus('loading');
    emit<PreviewTokensHandler>('PREVIEW_TOKENS', {
      operationId,
      collectionIds,
      options,
    });
  }

  // ponytail: single-file fast path avoids jszip overhead when there's one
  // collection; otherwise zip into one archive (user's chosen delivery).
  async function deliverTokenFiles(files: readonly ExportFile[]): Promise<void> {
    if (files.length === 0) {
      setTokensExportError('No exportable tokens found for the selected collections.');
      setTokensExportStatus('error');
      return;
    }
    try {
      if (files.length === 1) {
        downloadBlob(new Blob([files[0].css], { type: 'text/plain' }), files[0].name);
        setTokensExportStatus('idle');
        setTokensExportSuccess(`Downloaded ${files[0].name}.`);
        return;
      }
      const zip = new JSZip();
      for (const file of files) {
        zip.file(file.name, file.css);
      }
      const bytes = await zip.generateAsync({ type: 'blob' });
      downloadBlob(bytes, 'sync-tokens.zip');
      setTokensExportStatus('idle');
      setTokensExportSuccess(
          `Downloaded sync-tokens.zip with ${files.length} files.`,
      );
    } catch {
      setTokensExportSuccess('');
      setTokensExportError('Could not package the export for download.');
      setTokensExportStatus('error');
    }
  }

  const generateTokenDocs = (
    collectionId: string,
    targetFormat: 'canvas' | 'markdown' = 'canvas',
  ): void => {
    setDocGenerationStatus('running');
    setDocProgress({ message: 'Generating token documentation…', percent: 0 });
    setDocGenerationMessage('Generating token documentation...');
    emit<GenerateTokenDocsHandler>('GENERATE_TOKEN_DOCS', { collectionId, targetFormat });
  };

  const updateDocsInPlace = (frameNodeId: string): void => {
    setDocGenerationStatus('running');
    setDocProgress({ message: 'Updating documentation in place…', percent: 0 });
    setDocGenerationMessage('Updating documentation in place...');
    emit<UpdateDocsInPlaceHandler>('UPDATE_DOCS_IN_PLACE', { frameNodeId });
  };

  const generateComponentDocs = (
    targetToken: string,
    targetFormat: 'canvas' | 'markdown' = 'canvas',
  ): void => {
    setDocGenerationStatus('running');
    setDocProgress({ message: 'Generating component specification…', percent: 0 });
    setDocGenerationMessage('Generating component specification...');
    emit<GenerateComponentDocsHandler>('GENERATE_COMPONENT_DOCS', { targetToken, targetFormat });
  };

  const cancelDocGeneration = (): void => {
    setDocGenerationStatus('idle');
    setDocProgress(null);
    setDocGenerationMessage('');
  };

  return {
    activePendingOperation: activePendingMutation?.operation,
    cancelClear,
    clear,
    clearCancelButtonRef,
    errorMessage,
    fieldErrors,
    formValues,
    inspectCodeState,
    isClearConfirmationOpen,
    isDirty,
    isReady,
    isSourceUploading,
    connectionHealth,
    closeTarget,
    inventoryState,
    openInventoryTarget,
    reconcileFigma,
    removeStaleMapping,
    rescanComponents,
    save,
    scaffold,
    targetOrigin,
    targetState,
    targetStatusAnnouncement,
    semanticRecipe: workingRecipe,
    semanticProposals,
    applySemanticProposal,
    exportDebugBundle,
    exportReport,
    generateCodeConnect,
    isSourceReplacementPending,
    sourceReplacementCancelRef,
    confirmSourceReplacement,
    cancelSourceReplacement,
    setChildrenMode,
    setCustomPropMappings,
    setFormField,
    setSemanticOption,
    setSemanticRepeatedInstances,
    setSemanticValueMapping,
    setMappedProperty,
    setMappedValue,
    statusMessage,
    uploadSourceFiles,
    tokenCollections,
    tokenCollectionsStatus,
    tokenCollectionsError,
    tokensExportStatus,
    tokensExportError,
    tokensExportSuccess,
    tokensPreviewStatus,
    tokensPreviewError,
    tokensPreviewFiles,
    loadTokenCollections,
    exportTokens: exportTokensAction,
    previewTokens: previewTokensAction,
    connectionImportEntries,
    connectionPortabilityMessage,
    exportConnections,
    previewConnectionImport,
    applyConnectionImport,
    generateStories,
    storybookGeneration,
    outputPreferences,
    outputPreferencesMessage,
    setOutputPreferences,
    selectedDocFrame,
    docGenerationStatus,
    docGenerationMessage,
    docProgress,
    cancelDocGeneration,
    generateTokenDocs,
    updateDocsInPlace,
    generateComponentDocs,
  };
}

