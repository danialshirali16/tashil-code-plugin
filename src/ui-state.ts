import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CHILDREN_TEXT_PROPERTY,
  type ChildrenMode,
  type ConnectionMetadata,
  type UiTargetState,
} from './types';
import { isPropMappings, isRecord } from './codegen';
import { normalizeOptionalHttpUrl } from './external-url';
import { compileMappingDocument, isMappingDocument } from './mapping-document';
import { extractAdvancedPropMappings } from './mapping-editor';
import { findMappingConflicts } from './connection-health';

export type ConnectionFormValues = {
  childrenMode: ChildrenMode;
  childrenTextProperty: string;
  componentName: string;
  customPropMappings: string;
  iconComponentName: string;
  iconImportPath: string;
  importPath: string;
  mappingDocument: string;
  propMappings: string;
  sourcePath: string;
  sourceUrl: string;
  storybookUrl: string;
};

export type FormField = keyof ConnectionFormValues;
export type FormErrors = Partial<Record<FormField, string>>;

export type FormDraft = {
  baseline: ConnectionFormValues;
  isDirty: boolean;
  values: ConnectionFormValues;
};

export type DraftStore = ReadonlyMap<string, FormDraft>;

export type FormValidationResult =
  | { errors: FormErrors; message: string; ok: false }
  | { metadata: ConnectionMetadata; ok: true };

export type CopyStatus = 'copied' | 'error' | 'idle';

export type ConnectionStatusSummary = {
  connectionLabel: 'Connected' | 'Not connected';
  unsavedLabel?: 'Unsaved changes' | 'Unsaved setup';
};

export type FormattedConnectionUpdatedAt = {
  dateTime: string;
  label: string;
};

export type MutationOperation = 'clear' | 'save' | 'scaffold';

export type PendingMutation =
  | {
      operation: 'save';
      operationId: string;
      targetToken: string;
      submittedValues: ConnectionFormValues;
    }
  | {
      operation: 'clear' | 'scaffold';
      operationId: string;
      targetToken: string;
    };

export type PendingMutationState = {
  byOperationId: ReadonlyMap<string, PendingMutation>;
  operationIdByTarget: ReadonlyMap<string, string>;
};

export type MutationResultIdentity = {
  operation: MutationOperation;
  operationId: string;
  targetToken: string;
};

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;

export const FORM_FIELD_IDS: Record<FormField, string> = {
  childrenMode: 'tashil-children-mode',
  childrenTextProperty: 'tashil-children-text-property',
  componentName: 'tashil-component-name',
  customPropMappings: 'tashil-custom-prop-mappings',
  iconComponentName: 'tashil-icon-component-name',
  iconImportPath: 'tashil-icon-import-path',
  importPath: 'tashil-import-path',
  mappingDocument: 'tashil-mapping-document',
  propMappings: 'tashil-prop-mappings',
  sourcePath: 'tashil-source-path',
  sourceUrl: 'tashil-source-url',
  storybookUrl: 'tashil-storybook-url',
};

let nextMutationOperationSequence = 0;

/** Create an ID unique for the lifetime of this UI session. */
export function createMutationOperationId(): string {
  nextMutationOperationSequence += 1;
  return `mutation-${Date.now().toString(36)}-${nextMutationOperationSequence.toString(36)}`;
}

export function createPendingMutationState(): PendingMutationState {
  return {
    byOperationId: new Map(),
    operationIdByTarget: new Map(),
  };
}

/**
 * Register a mutation unless that target already has one in flight. The
 * operation-id index is authoritative, which lets result handlers reject late
 * or duplicated messages without disturbing a newer request.
 */
export function startPendingMutation(
  state: PendingMutationState,
  mutation: PendingMutation,
): { started: boolean; state: PendingMutationState } {
  if (
    state.byOperationId.has(mutation.operationId)
    || state.operationIdByTarget.has(mutation.targetToken)
  ) {
    return { started: false, state };
  }

  const byOperationId = new Map(state.byOperationId);
  const operationIdByTarget = new Map(state.operationIdByTarget);
  byOperationId.set(mutation.operationId, mutation);
  operationIdByTarget.set(mutation.targetToken, mutation.operationId);

  return {
    started: true,
    state: { byOperationId, operationIdByTarget },
  };
}

/**
 * Consume only the exact pending request identified by a result. A stale,
 * duplicated, or mismatched result leaves all pending state untouched.
 */
export function finishPendingMutation(
  state: PendingMutationState,
  result: MutationResultIdentity,
): { mutation?: PendingMutation; state: PendingMutationState } {
  const mutation = state.byOperationId.get(result.operationId);

  if (
    !mutation
    || mutation.operation !== result.operation
    || mutation.targetToken !== result.targetToken
    || state.operationIdByTarget.get(result.targetToken) !== result.operationId
  ) {
    return { state };
  }

  const byOperationId = new Map(state.byOperationId);
  const operationIdByTarget = new Map(state.operationIdByTarget);
  byOperationId.delete(result.operationId);
  operationIdByTarget.delete(result.targetToken);

  return {
    mutation,
    state: { byOperationId, operationIdByTarget },
  };
}

export function getPendingMutationForTarget(
  state: PendingMutationState,
  targetToken: string,
): PendingMutation | undefined {
  const operationId = state.operationIdByTarget.get(targetToken);
  return operationId === undefined ? undefined : state.byOperationId.get(operationId);
}

export function getTargetStatusAnnouncement(state: UiTargetState): string {
  return state.status === 'ready'
    ? `${state.componentName} selected. ${state.message}`
    : state.message;
}

export function getConnectionStatusSummary(
  hasConnection: boolean,
  isDirty: boolean,
): ConnectionStatusSummary {
  return {
    connectionLabel: hasConnection ? 'Connected' : 'Not connected',
    ...(isDirty
      ? { unsavedLabel: hasConnection ? 'Unsaved changes' : 'Unsaved setup' }
      : {}),
  };
}

export function formatConnectionUpdatedAt(
  value: string | undefined,
): FormattedConnectionUpdatedAt | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return {
    dateTime: date.toISOString(),
    label: date.toLocaleString(),
  };
}

export function createFormValues(
  connection?: ConnectionMetadata,
  fallbackComponentName?: string,
): ConnectionFormValues {
  const childrenMode = connection?.childrenMode === 'icon-only'
    || connection?.childrenMode === 'none'
    ? connection.childrenMode
    : 'text';

  return {
    childrenMode,
    childrenTextProperty: connection?.childrenTextProperty
      || DEFAULT_CHILDREN_TEXT_PROPERTY,
    componentName: connection?.componentName || fallbackComponentName || '',
    customPropMappings: connection?.mappingDocument && connection.propMappings
      ? JSON.stringify(
          extractAdvancedPropMappings(connection.propMappings, connection.mappingDocument),
          null,
          2,
        )
      : '',
    iconComponentName: connection?.iconComponentName || '',
    iconImportPath: connection?.iconImportPath || '',
    importPath: connection?.importPath || '',
    mappingDocument: connection?.mappingDocument
      ? JSON.stringify(connection.mappingDocument, null, 2)
      : '',
    propMappings: connection?.propMappings
      ? JSON.stringify(connection.propMappings, null, 2)
      : '',
    sourcePath: connection?.sourcePath || '',
    sourceUrl: connection?.sourceUrl || '',
    storybookUrl: connection?.storybookUrl || '',
  };
}

export function createFormDraft(values: ConnectionFormValues): FormDraft {
  return {
    baseline: values,
    isDirty: false,
    values,
  };
}

export function clearFormDraft(
  drafts: DraftStore,
  targetToken: string,
): { draft: FormDraft; drafts: DraftStore } {
  const draft = createFormDraft(createFormValues());
  const nextDrafts = new Map(drafts);
  nextDrafts.set(targetToken, draft);
  return { draft, drafts: nextDrafts };
}

export function selectFormDraft(
  drafts: DraftStore,
  state: UiTargetState,
): { draft?: FormDraft; drafts: DraftStore; restored: boolean } {
  if (state.status !== 'ready') {
    return { drafts, restored: false };
  }

  const existing = drafts.get(state.targetToken);
  if (existing?.isDirty) {
    return { draft: existing, drafts, restored: true };
  }

  const draft = createFormDraft(createFormValues(
    state.existingConnection,
    state.componentName,
  ));
  const nextDrafts = new Map(drafts);
  nextDrafts.set(state.targetToken, draft);
  return { draft, drafts: nextDrafts, restored: false };
}

export function updateFormDraft(
  draft: FormDraft,
  field: FormField,
  value: string,
): FormDraft {
  const values = { ...draft.values, [field]: value };
  return {
    baseline: draft.baseline,
    isDirty: !areFormValuesEqual(values, draft.baseline),
    values,
  };
}

export function markFormDraftSaved(
  draft: FormDraft,
  submittedValues: ConnectionFormValues,
): FormDraft {
  if (!areFormValuesEqual(draft.values, submittedValues)) {
    return draft;
  }

  return createFormDraft(draft.values);
}

export function areFormValuesEqual(
  first: ConnectionFormValues,
  second: ConnectionFormValues,
): boolean {
  return first.componentName === second.componentName
    && first.customPropMappings === second.customPropMappings
    && first.childrenMode === second.childrenMode
    && first.childrenTextProperty === second.childrenTextProperty
    && first.iconComponentName === second.iconComponentName
    && first.iconImportPath === second.iconImportPath
    && first.importPath === second.importPath
    && first.mappingDocument === second.mappingDocument
    && first.propMappings === second.propMappings
    && first.sourcePath === second.sourcePath
    && first.sourceUrl === second.sourceUrl
    && first.storybookUrl === second.storybookUrl;
}

// Compile-time guard: if a field is added to ConnectionFormValues but not
// compared above, isDirty silently never flips for it (Save stays disabled).
// This satisfies check fails tsc until every field is listed here.
void ({
  componentName: true,
  customPropMappings: true,
  childrenMode: true,
  childrenTextProperty: true,
  iconComponentName: true,
  iconImportPath: true,
  importPath: true,
  mappingDocument: true,
  propMappings: true,
  sourcePath: true,
  sourceUrl: true,
  storybookUrl: true,
} satisfies Record<keyof ConnectionFormValues, true>);

export function validateConnectionForm(
  values: ConnectionFormValues,
): FormValidationResult {
  const errors: FormErrors = {};
  const componentName = values.componentName.trim();
  const importPath = values.importPath.trim();
  const childrenTextProperty = values.childrenTextProperty.trim();
  const iconComponentName = values.iconComponentName.trim();
  const iconImportPath = values.iconImportPath.trim();
  const storybookUrl = normalizeOptionalHttpUrl(values.storybookUrl);
  const sourceUrl = normalizeOptionalHttpUrl(values.sourceUrl);

  if (componentName === '') {
    errors.componentName = 'Enter a component name.';
  } else if (!COMPONENT_IDENTIFIER_PATTERN.test(componentName)) {
    errors.componentName = 'Use a valid exported component name, for example Button.';
  }

  if (importPath === '') {
    errors.importPath = 'Enter an import path.';
  }

  if (storybookUrl === null) {
    errors.storybookUrl = 'Use a complete http:// or https:// URL without credentials.';
  }

  if (sourceUrl === null) {
    errors.sourceUrl = 'Use a complete http:// or https:// URL without credentials.';
  }

  if (values.childrenMode !== 'none' && childrenTextProperty === '') {
    errors.childrenTextProperty = 'Enter the Figma property used for child text.';
  }

  if (values.childrenMode === 'icon-only') {
    if (iconComponentName === '') {
      errors.iconComponentName = 'Enter the exported icon component name.';
    } else if (!COMPONENT_IDENTIFIER_PATTERN.test(iconComponentName)) {
      errors.iconComponentName = 'Use a valid exported component name, for example TrashIcon.';
    } else if (iconComponentName === componentName && iconImportPath !== importPath) {
      errors.iconComponentName = 'Use a different local component name for a different import path.';
    }

    if (iconImportPath === '') {
      errors.iconImportPath = 'Enter the icon import path.';
    }
  }

  let propMappings: ConnectionMetadata['propMappings'] = {};
  if (values.propMappings.trim() !== '') {
    try {
      const parsed = JSON.parse(values.propMappings) as unknown;
      if (!isRecord(parsed)) {
        errors.propMappings = 'Prop mappings must be a JSON object.';
      } else if (!isPropMappings(parsed)) {
        errors.propMappings = 'Each mapping needs a valid `prop` and a string/number/boolean `value`.';
      } else {
        propMappings = parsed;
      }
    } catch (_error) {
      errors.propMappings = 'Prop mappings must be valid JSON.';
    }
  }

  let mappingDocument: ConnectionMetadata['mappingDocument'];
  if (values.mappingDocument.trim() !== '') {
    let customMappings: ConnectionMetadata['propMappings'] = {};
    if (values.customPropMappings.trim() !== '') {
      try {
        const parsedCustom = JSON.parse(values.customPropMappings) as unknown;
        if (!isRecord(parsedCustom) || !isPropMappings(parsedCustom)) {
          errors.customPropMappings = 'Custom mappings must use the same valid prop-mapping JSON format.';
        } else {
          customMappings = parsedCustom;
        }
      } catch (_error) {
        errors.customPropMappings = 'Custom mappings must be valid JSON.';
      }
    }

    try {
      const parsed = JSON.parse(values.mappingDocument) as unknown;
      if (!isMappingDocument(parsed)) {
        errors.mappingDocument = 'The visual mapping document is invalid. Upload the source files again.';
      } else {
        mappingDocument = parsed;
        const conflicts = findMappingConflicts(mappingDocument);
        if (conflicts.length > 0) {
          errors.mappingDocument = conflicts[0].message;
        }
        propMappings = compileMappingDocument(
          mappingDocument,
          customMappings,
        );
      }
    } catch (_error) {
      errors.mappingDocument = 'The visual mapping document is invalid. Upload the source files again.';
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      errors,
      message: 'Fix the highlighted fields before saving.',
      ok: false,
    };
  }

  return {
    metadata: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName,
      importPath,
      storybookUrl: storybookUrl ?? undefined,
      sourcePath: values.sourcePath.trim() || undefined,
      sourceUrl: sourceUrl ?? undefined,
      childrenMode: values.childrenMode,
      ...(values.childrenMode === 'none' ? {} : { childrenTextProperty }),
      ...(values.childrenMode === 'icon-only'
        ? { iconComponentName, iconImportPath }
        : {}),
      propMappings,
      ...(mappingDocument ? { mappingDocument } : {}),
    },
    ok: true,
  };
}

export function getFirstInvalidField(errors: FormErrors): FormField | undefined {
  const fieldOrder: FormField[] = [
    'componentName',
    'importPath',
    'storybookUrl',
    'sourcePath',
    'sourceUrl',
    'childrenTextProperty',
    'iconComponentName',
    'iconImportPath',
    'customPropMappings',
    'mappingDocument',
    'propMappings',
  ];
  return fieldOrder.find((field) => Boolean(errors[field]));
}

export function getClearAction(
  isConfirmationOpen: boolean,
): 'clear' | 'request-confirmation' {
  return isConfirmationOpen ? 'clear' : 'request-confirmation';
}

export function getCopyFeedback(
  status: CopyStatus,
  title: string,
): { ariaLabel: string; message: string } {
  if (status === 'copied') {
    return {
      ariaLabel: `${title} copied`,
      message: `${title} copied to clipboard.`,
    };
  }
  if (status === 'error') {
    return {
      ariaLabel: `Copy ${title} failed`,
      message: `Could not copy ${title}.`,
    };
  }
  return {
    ariaLabel: `Copy ${title}`,
    message: '',
  };
}
