import { emit, on } from '@create-figma-plugin/utilities';
import { useEffect, useRef, useState } from 'preact/hooks';
import { mergePropMappingsJson } from './prop-mappings';
import {
  FORM_FIELD_IDS,
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
  type PropMappings,
  type RefreshSelectionHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type SelectionStateHandler,
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
  save: () => void;
  scaffold: () => void;
  selectionState: UiSelectionState;
  selectionStatusAnnouncement: string;
  setChildrenMode: (value: ChildrenMode) => void;
  setFormField: (field: FormField, value: string) => void;
  statusMessage: string;
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
      activeSelectionTokenRef.current = undefined;
      displayFormDraft(createFormDraft(createFormValues()));
      setStatusMessage('');
      setIsClearConfirmationOpen(false);
      return;
    }

    const result = selectFormDraft(draftsRef.current, state);
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
        const savedDraft = markFormDraftSaved(draft, pendingMutation.submittedValues);
        const nextDrafts = new Map(draftsRef.current);
        nextDrafts.set(result.selectionToken, savedDraft);
        draftsRef.current = nextDrafts;
        if (isActiveSelection) {
          displayFormDraft(savedDraft);
        }
      }
    } else if (result.ok) {
      const nextDrafts = new Map(draftsRef.current);
      nextDrafts.delete(result.selectionToken);
      draftsRef.current = nextDrafts;

      if (isActiveSelection) {
        const currentState = selectionStateRef.current;
        const fallbackComponentName = currentState.status === 'ready'
          ? currentState.componentName
          : undefined;
        const clearedDraft = createFormDraft(createFormValues(undefined, fallbackComponentName));
        nextDrafts.set(result.selectionToken, clearedDraft);
        draftsRef.current = nextDrafts;
        displayFormDraft(clearedDraft);
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

  function save(): void {
    if (
      selectionState.status !== 'ready'
      || activeSelectionTokenRef.current !== selectionState.selectionToken
    ) {
      setErrorMessage('Selection changed. Select one component and try again.');
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
    save,
    scaffold,
    selectionState,
    selectionStatusAnnouncement,
    setChildrenMode,
    setFormField,
    statusMessage,
  };
}
