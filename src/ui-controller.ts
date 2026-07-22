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
  getPendingMutationForSelection,
  getSelectionStatusAnnouncement,
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
  type InspectCodeState,
  type InspectCodeStateHandler,
  type MappingDocument,
  type PropMappings,
  type RefreshSelectionHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type SelectionStateHandler,
  type SourcePropValue,
  type UiSelectionState,
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
  isClearConfirmationOpen: boolean;
  isDirty: boolean;
  isReady: boolean;
  isSourceUploading: boolean;
  connectionHealth?: ConnectionHealth;
  reconcileFigma: () => void;
  removeStaleMapping: (sourcePropName: string) => void;
  save: () => void;
  scaffold: () => void;
  selectionState: UiSelectionState;
  selectionStatusAnnouncement: string;
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
  const [selectionState, setSelectionState] = useState<UiSelectionState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
  const initialFormValues = createFormValues();
  const [formValues, setFormValuesState] = useState(initialFormValues);
  const formValuesRef = useRef(initialFormValues);
  const draftsRef = useRef<DraftStore>(new Map());
  const activeSelectionTokenRef = useRef<string>();
  const selectionStateRef = useRef<UiSelectionState>({
    status: 'empty',
    message: 'Select a component instance or main component.',
  });
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

  const isReady = selectionState.status === 'ready';
  const selectionStatusAnnouncement = getSelectionStatusAnnouncement(selectionState);
  const activePendingMutation = selectionState.status === 'ready'
    ? getPendingMutationForSelection(pendingMutations, selectionState.selectionToken)
    : undefined;

  useEffect(() => {
    if (isClearConfirmationOpen) {
      clearCancelButtonRef.current?.focus();
    }
  }, [isClearConfirmationOpen]);

  useEffect(() => {
    const offSelectionState = on<SelectionStateHandler>('SELECTION_STATE', (state) => {
      applySelectionState(state);
    });

    const offSaveResult = on<SaveResultHandler>('SAVE_RESULT', (result) => {
      handleSaveResult(result);
    });

    const offInspectCodeState = on<InspectCodeStateHandler>('INSPECT_CODE_STATE', (state) => {
      setInspectCodeState(state);
    });

    const offScaffoldResult = on<ScaffoldResultHandler>('SCAFFOLD_RESULT', (result) => {
      const pendingMutation = completePendingMutation({
        operation: 'scaffold',
        operationId: result.operationId,
        selectionToken: result.selectionToken,
      });

      if (!pendingMutation) {
        return;
      }

      if (!result.ok) {
        if (activeSelectionTokenRef.current === result.selectionToken) {
          setStatusMessage('');
          setErrorMessage(result.message || 'Could not scaffold prop mappings.');
        }
        return;
      }

      mergePropMappings(result.selectionToken, result.mappings ?? {});
    });

    emit<RefreshSelectionHandler>('REFRESH_SELECTION');

    return () => {
      offSelectionState();
      offSaveResult();
      offInspectCodeState();
      offScaffoldResult();
    };
  }, []);

  function applySelectionState(state: UiSelectionState): void {
    const previousToken = activeSelectionTokenRef.current;
    selectionStateRef.current = state;
    setSelectionState(state);
    setErrorMessage('');
    setFieldErrors({});

    if (state.status !== 'ready') {
      sourceUploadIdRef.current += 1;
      setIsSourceUploading(false);
      activeSelectionTokenRef.current = undefined;
      displayFormDraft(createFormDraft(createFormValues()));
      setStatusMessage('');
      setIsClearConfirmationOpen(false);
      return;
    }

    const result = selectFormDraft(draftsRef.current, state);
    if (state.existingConnection?.mappingDocument) {
      savedMappingDocumentsRef.current.set(
        state.selectionToken,
        state.existingConnection.mappingDocument,
      );
    } else {
      savedMappingDocumentsRef.current.delete(state.selectionToken);
    }
    if (previousToken !== state.selectionToken) {
      sourceUploadIdRef.current += 1;
      setIsSourceUploading(false);
    }
    draftsRef.current = result.drafts;
    activeSelectionTokenRef.current = state.selectionToken;
    displayFormDraft(result.draft!);

    if (previousToken !== state.selectionToken) {
      setStatusMessage(result.restored
        ? 'Restored your unsaved changes for this component.'
        : '');
      setIsClearConfirmationOpen(false);
    } else if (!state.existingConnection || state.connectionIssue) {
      setIsClearConfirmationOpen(false);
    }
  }

  function handleSaveResult(result: Parameters<SaveResultHandler['handler']>[0]): void {
    const pendingMutation = completePendingMutation({
      operation: result.operation,
      operationId: result.operationId,
      selectionToken: result.selectionToken,
    });

    if (!pendingMutation) {
      return;
    }

    const isActiveSelection = activeSelectionTokenRef.current === result.selectionToken;

    if (result.operation === 'save' && pendingMutation.operation === 'save') {
      const draft = draftsRef.current.get(result.selectionToken);

      if (result.ok && draft) {
        let confirmedValues = pendingMutation.submittedValues;
        let confirmedDocument: MappingDocument | undefined;
        const submittedDocument = readMappingDocument(
          pendingMutation.submittedValues.mappingDocument,
        );
        if (submittedDocument) {
          const currentSelection = selectionStateRef.current;
          const savedDocument: MappingDocument = {
            ...submittedDocument,
            figmaSnapshot: currentSelection.status === 'ready'
              && currentSelection.selectionToken === result.selectionToken
              && currentSelection.figmaSnapshot
              ? currentSelection.figmaSnapshot
              : submittedDocument.figmaSnapshot,
            lastValidatedAt: new Date().toISOString(),
            revision: submittedDocument.revision + 1,
          };
          confirmedDocument = savedDocument;
          savedMappingDocumentsRef.current.set(result.selectionToken, savedDocument);
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
        nextDrafts.set(result.selectionToken, savedDraft);
        draftsRef.current = nextDrafts;
        if (isActiveSelection) {
          displayFormDraft(savedDraft);
        }

      }
    } else if (result.ok) {
      const cleared = clearFormDraft(draftsRef.current, result.selectionToken);
      draftsRef.current = cleared.drafts;

      if (isActiveSelection) {
        displayFormDraft(cleared.draft);
      }
    }

    if (isActiveSelection) {
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

  function mergePropMappings(selectionToken: string, incoming: PropMappings): void {
    const draft = draftsRef.current.get(selectionToken);
    if (!draft) {
      return;
    }

    const result = mergePropMappingsJson(draft.values.propMappings, incoming);

    if (!result.ok) {
      if (activeSelectionTokenRef.current === selectionToken) {
        setStatusMessage('');
        setErrorMessage(result.message);
      }
      return;
    }

    const updatedDraft = updateFormDraft(draft, 'propMappings', result.value);
    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(selectionToken, updatedDraft);
    draftsRef.current = nextDrafts;

    if (activeSelectionTokenRef.current === selectionToken) {
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
    const selectionToken = activeSelectionTokenRef.current;
    if (!selectionToken) {
      return;
    }

    const draft = draftsRef.current.get(selectionToken)
      ?? createFormDraft(formValuesRef.current);
    const updatedDraft = updateFormDraft(draft, field, value);
    const nextDrafts = new Map(draftsRef.current);
    nextDrafts.set(selectionToken, updatedDraft);
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
    const selectionToken = activeSelectionTokenRef.current;
    if (!selectionToken) {
      return;
    }

    const previousDocument = readMappingDocument();
    const preservedMappings = previousDocument
      ? readCustomPropMappings() ?? {}
      : extractAdvancedPropMappings(readPropMappings(), document);
    const compiled = compileMappingDocument(document, preservedMappings);
    const draft = draftsRef.current.get(selectionToken)
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
    if (document.sourceSnapshot?.props.some((prop) => prop.role === 'children')) {
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
    nextDrafts.set(selectionToken, updatedDraft);
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
    const currentSelection = selectionStateRef.current;
    if (currentSelection.status !== 'ready' || !currentSelection.figmaSnapshot) {
      setErrorMessage('Select a Figma component with component properties first.');
      return;
    }

    const uploadId = sourceUploadIdRef.current + 1;
    sourceUploadIdRef.current = uploadId;
    const selectionToken = currentSelection.selectionToken;
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
        formValuesRef.current.componentName.trim() || currentSelection.componentName,
      );

      if (
        sourceUploadIdRef.current !== uploadId
        || activeSelectionTokenRef.current !== selectionToken
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
        currentSelection.figmaSnapshot,
        readPropMappings(),
        readMappingDocument(),
      );
      sourceVerifiedSelectionsRef.current.add(selectionToken);
      applyMappingDocument(
        document,
        result.warnings.length > 0
          ? `Source analyzed with ${result.warnings.length} warning${result.warnings.length === 1 ? '' : 's'}.`
          : `Found ${result.snapshot.props.length} props in ${result.snapshot.fileName}.`,
      );
    } catch (_error) {
      if (
        sourceUploadIdRef.current === uploadId
        && activeSelectionTokenRef.current === selectionToken
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
    const currentSelection = selectionStateRef.current;
    const document = readMappingDocument();
    if (
      currentSelection.status !== 'ready'
      || !currentSelection.figmaSnapshot
      || !document?.sourceSnapshot
    ) {
      setErrorMessage('Upload source and select a Figma component before reconciling.');
      return;
    }

    applyMappingDocument(
      createMappingDocumentDraft(
        document.sourceSnapshot,
        currentSelection.figmaSnapshot,
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
    const selectionToken = activeSelectionTokenRef.current;
    if (!selectionToken) {
      return;
    }

    const draft = draftsRef.current.get(selectionToken)
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
    nextDrafts.set(selectionToken, updatedDraft);
    draftsRef.current = nextDrafts;
    displayFormDraft(updatedDraft);
    setFieldErrors((current) => ({ ...current, customPropMappings: undefined }));
    setErrorMessage('');
    setStatusMessage('');
    setIsClearConfirmationOpen(false);
  }

  function save(): void {
    if (
      selectionState.status !== 'ready'
      || activeSelectionTokenRef.current !== selectionState.selectionToken
    ) {
      setErrorMessage('Selection changed. Select one component and try again.');
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
      selectionToken: selectionState.selectionToken,
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
      selectionToken: selectionState.selectionToken,
    });
  }

  function scaffold(): void {
    if (
      selectionState.status !== 'ready'
      || activeSelectionTokenRef.current !== selectionState.selectionToken
    ) {
      setErrorMessage('Selection changed. Select one component and try again.');
      return;
    }

    const operationId = createMutationOperationId();
    if (!beginPendingMutation({
      operation: 'scaffold',
      operationId,
      selectionToken: selectionState.selectionToken,
    })) {
      return;
    }

    setErrorMessage('');
    setStatusMessage('Generating prop mappings…');
    emit<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS', {
      operationId,
      selectionToken: selectionState.selectionToken,
    });
  }

  function clear(): void {
    if (
      selectionState.status !== 'ready'
      || activeSelectionTokenRef.current !== selectionState.selectionToken
    ) {
      setErrorMessage('Selection changed. Select one component and try again.');
      return;
    }

    if (getPendingMutationForSelection(
      pendingMutationsRef.current,
      selectionState.selectionToken,
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
      selectionToken: selectionState.selectionToken,
    })) {
      return;
    }

    setIsClearConfirmationOpen(false);
    setErrorMessage('');
    setStatusMessage('Clearing connection…');
    emit<ClearConnectionHandler>('CLEAR_CONNECTION', {
      operationId,
      selectionToken: selectionState.selectionToken,
    });
  }

  function cancelClear(): void {
    setIsClearConfirmationOpen(false);
    window.setTimeout(() => {
      document.getElementById('tashil-clear-button')?.focus();
    }, 0);
  }

  const connectionHealth = selectionState.status === 'ready'
    ? evaluateConnectionHealth(
        savedMappingDocumentsRef.current.get(selectionState.selectionToken)
          ?? selectionState.existingConnection?.mappingDocument,
        selectionState.figmaSnapshot,
        readMappingDocument(formValues.mappingDocument),
        sourceVerifiedSelectionsRef.current.has(selectionState.selectionToken),
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
    reconcileFigma,
    removeStaleMapping,
    save,
    scaffold,
    selectionState,
    selectionStatusAnnouncement,
    setChildrenMode,
    setCustomPropMappings,
    setFormField,
    setMappedProperty,
    setMappedValue,
    statusMessage,
    uploadSourceFiles,
  };
}
