import { emit, on } from '@create-figma-plugin/utilities';
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
  type ChildrenMode,
  type ClearConnectionHandler,
  type ComponentInventoryState,
  type ComponentInventoryStateHandler,
  type ComponentTargetStateHandler,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type MappingDocument,
  type OpenComponentTargetHandler,
  type PropMappings,
  type RefreshSelectionHandler,
  type ScanComponentsHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type CanvasTargetStateHandler,
  type SourcePropValue,
  type UiTargetState,
} from './types';

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
  rescanComponents: () => void;
  save: () => void;
  scaffold: () => void;
  targetOrigin?: 'inventory' | 'canvas';
  targetState: UiTargetState;
  targetStatusAnnouncement: string;
  setChildrenMode: (value: ChildrenMode) => void;
  setCustomPropMappings: (value: string) => void;
  setFormField: (field: FormField, value: string) => void;
  setMappedProperty: (sourcePropName: string, figmaPropertyId: string) => void;
  setMappedValue: (
    sourcePropName: string,
    sourceValue: SourcePropValue,
    figmaValue: string,
  ) => void;
  statusMessage: string;
  uploadSourceFiles: (files: readonly File[]) => Promise<void>;
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
  const [isDirty, setIsDirty] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FormErrors>({});
  const [errorMessage, setErrorMessage] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [isClearConfirmationOpen, setIsClearConfirmationOpen] = useState(false);
  const [inspectCodeState, setInspectCodeState] = useState<InspectCodeState>({
    status: 'invalid-selection',
  });
  const [isSourceUploading, setIsSourceUploading] = useState(false);
  const sourceUploadIdRef = useRef(0);
  const sourceVerifiedSelectionsRef = useRef<Set<string>>(new Set());
  const savedMappingDocumentsRef = useRef<Map<string, MappingDocument>>(new Map());

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

    rescanComponents();
    emit<RefreshSelectionHandler>('REFRESH_SELECTION');

    return () => {
      offCanvasTargetState();
      offComponentTargetState();
      offInventoryState();
      offSaveResult();
      offInspectCodeState();
      offScaffoldResult();
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

  function rescanComponents(): void {
    const scanId = `scan-${Date.now()}-${++scanSequenceRef.current}`;
    currentScanIdRef.current = scanId;
    setInventoryState({
      scannedPages: 0,
      status: 'scanning',
      totalPages: 0,
    });
    emit<ScanComponentsHandler>('SCAN_COMPONENTS', { scanId });
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

  async function uploadSourceFiles(files: readonly File[]): Promise<void> {
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
      const inputs = await Promise.all(files.map(async (file) => ({
        contents: await file.text(),
        fileName: file.name,
      })));
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
      )
    : undefined;

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
    setChildrenMode,
    setCustomPropMappings,
    setFormField,
    setMappedProperty,
    setMappedValue,
    statusMessage,
    uploadSourceFiles,
  };
}
