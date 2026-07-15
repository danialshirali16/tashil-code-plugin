import {
  CURRENT_SCHEMA_VERSION,
  type ConnectionMetadata,
  type UiSelectionState,
} from './types';

export type ConnectionFormValues = {
  componentName: string;
  importPath: string;
  propMappings: string;
  sourcePath: string;
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

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;

export const FORM_FIELD_IDS: Record<FormField, string> = {
  componentName: 'tashil-component-name',
  importPath: 'tashil-import-path',
  propMappings: 'tashil-prop-mappings',
  sourcePath: 'tashil-source-path',
  storybookUrl: 'tashil-storybook-url',
};

export function createFormValues(
  connection?: ConnectionMetadata,
  fallbackComponentName?: string,
): ConnectionFormValues {
  return {
    componentName: connection?.componentName || fallbackComponentName || '',
    importPath: connection?.importPath || '',
    propMappings: connection?.propMappings
      ? JSON.stringify(connection.propMappings, null, 2)
      : '',
    sourcePath: connection?.sourcePath || '',
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

export function selectFormDraft(
  drafts: DraftStore,
  state: UiSelectionState,
): { draft?: FormDraft; drafts: DraftStore; restored: boolean } {
  if (state.status !== 'ready') {
    return { drafts, restored: false };
  }

  const existing = drafts.get(state.selectionToken);
  if (existing?.isDirty) {
    return { draft: existing, drafts, restored: true };
  }

  const draft = createFormDraft(createFormValues(
    state.existingConnection,
    state.componentName,
  ));
  const nextDrafts = new Map(drafts);
  nextDrafts.set(state.selectionToken, draft);
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
    && first.importPath === second.importPath
    && first.propMappings === second.propMappings
    && first.sourcePath === second.sourcePath
    && first.storybookUrl === second.storybookUrl;
}

export function validateConnectionForm(
  values: ConnectionFormValues,
): FormValidationResult {
  const errors: FormErrors = {};
  const componentName = values.componentName.trim();
  const importPath = values.importPath.trim();

  if (componentName === '') {
    errors.componentName = 'Enter a component name.';
  } else if (!COMPONENT_IDENTIFIER_PATTERN.test(componentName)) {
    errors.componentName = 'Use a valid exported component name, for example Button.';
  }

  if (importPath === '') {
    errors.importPath = 'Enter an import path.';
  }

  let propMappings: ConnectionMetadata['propMappings'] = {};
  if (values.propMappings.trim() !== '') {
    try {
      const parsed = JSON.parse(values.propMappings) as unknown;
      if (!isRecord(parsed)) {
        errors.propMappings = 'Prop mappings must be a JSON object.';
      } else {
        propMappings = parsed as ConnectionMetadata['propMappings'];
      }
    } catch (_error) {
      errors.propMappings = 'Prop mappings must be valid JSON.';
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
      storybookUrl: values.storybookUrl.trim() || undefined,
      sourcePath: values.sourcePath.trim() || undefined,
      propMappings,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
