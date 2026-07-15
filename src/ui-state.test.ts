import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION, type UiSelectionState } from './types';
import {
  createFormDraft,
  createFormValues,
  createPendingMutationState,
  finishPendingMutation,
  formatConnectionUpdatedAt,
  getClearAction,
  getConnectionStatusSummary,
  getCopyFeedback,
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
} from './ui-state';

const EMPTY_FORM: ConnectionFormValues = {
  childrenMode: 'text',
  childrenTextProperty: 'label',
  componentName: '',
  iconComponentName: '',
  iconImportPath: '',
  importPath: '',
  propMappings: '',
  sourcePath: '',
  sourceUrl: '',
  storybookUrl: '',
};

function readyState(
  selectionToken: string,
  componentName: string,
  importPath = '',
): UiSelectionState {
  return {
    status: 'ready',
    selectionToken,
    componentName,
    existingConnection: importPath === '' ? undefined : {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName,
      importPath,
    },
    message: 'Ready',
  };
}

describe('connection form validation', () => {
  it('returns trimmed metadata for a valid form', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: ' Button ',
      importPath: ' tashil-ui ',
      propMappings: '{"size":{"small":{"prop":"size","value":"sm"}}}',
      sourcePath: ' src/Button.tsx ',
      sourceUrl: ' https://github.test/tashil/Button.tsx ',
      storybookUrl: ' https://storybook.test/button ',
      childrenTextProperty: ' Button Text ',
    });

    expect(result).toEqual({
      ok: true,
      metadata: {
        schemaVersion: 3,
        componentName: 'Button',
        importPath: 'tashil-ui',
        propMappings: {
          size: { small: { prop: 'size', value: 'sm' } },
        },
        sourcePath: 'src/Button.tsx',
        sourceUrl: 'https://github.test/tashil/Button.tsx',
        storybookUrl: 'https://storybook.test/button',
        childrenMode: 'text',
        childrenTextProperty: 'Button Text',
      },
    });
  });

  it('conditionally validates and persists icon-only fields', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
      iconComponentName: ' TrashIcon ',
      iconImportPath: ' tashil-icons ',
    });

    expect(result).toMatchObject({
      ok: true,
      metadata: {
        childrenMode: 'icon-only',
        childrenTextProperty: 'label',
        iconComponentName: 'TrashIcon',
        iconImportPath: 'tashil-icons',
      },
    });
  });

  it('requires icon fields only in icon-only mode', () => {
    const invalidIcon = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'IconButton',
      importPath: 'tashil-ui',
      childrenMode: 'icon-only',
    });
    expect(invalidIcon).toMatchObject({
      ok: false,
      errors: {
        iconComponentName: expect.any(String),
        iconImportPath: expect.any(String),
      },
    });

    const noChildren = validateConnectionForm({
      ...EMPTY_FORM,
      childrenMode: 'none',
      childrenTextProperty: '',
      componentName: 'Divider',
      iconComponentName: 'IgnoredIcon',
      iconImportPath: 'ignored-icons',
      importPath: 'tashil-ui',
    });
    expect(noChildren).toEqual({
      ok: true,
      metadata: {
        schemaVersion: 3,
        childrenMode: 'none',
        componentName: 'Divider',
        importPath: 'tashil-ui',
        propMappings: {},
        sourcePath: undefined,
        sourceUrl: undefined,
        storybookUrl: undefined,
      },
    });
  });

  it('rejects prop mappings whose shape is invalid (missing value, bad prop name)', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: JSON.stringify({
        intent: { primary: { prop: 'intent' } }, // missing `value`
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      errors: { propMappings: expect.stringMatching(/valid `prop`/i) },
    });
  });

  it('rejects prop mappings with an invalid prop identifier', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: JSON.stringify({
        intent: { primary: { prop: 'intent={evil}', value: 'primary' } },
      }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.propMappings).toMatch(/valid `prop`/i);
    }
  });

  it('identifies and orders invalid fields for accessible error focus', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'button-name',
      propMappings: '[]',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected invalid form');
    }
    expect(result.errors).toEqual({
      componentName: 'Use a valid exported component name, for example Button.',
      importPath: 'Enter an import path.',
      propMappings: 'Prop mappings must be a JSON object.',
    });
    expect(getFirstInvalidField(result.errors)).toBe('componentName');
  });

  it('reports malformed prop-mapping JSON', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: '{',
    });

    expect(result).toMatchObject({
      ok: false,
      errors: { propMappings: 'Prop mappings must be valid JSON.' },
    });
  });

  it('rejects unsafe Storybook and source URLs and focuses them in field order', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourceUrl: '//github.test/tashil/Button.tsx',
      storybookUrl: 'javascript:alert(1)',
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error('Expected invalid form');
    }

    expect(result.errors).toMatchObject({
      sourceUrl: expect.stringMatching(/http:\/\/ or https:\/\//i),
      storybookUrl: expect.stringMatching(/http:\/\/ or https:\/\//i),
    });
    expect(getFirstInvalidField(result.errors)).toBe('storybookUrl');
  });

  it('rejects control characters in an otherwise valid-looking URL', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourceUrl: 'https://github.test/source\nhttps://attacker.test',
    });

    expect(result).toMatchObject({
      ok: false,
      errors: { sourceUrl: expect.any(String) },
    });
  });

  it('treats whitespace-only optional URLs as omitted after trimming', () => {
    const result = validateConnectionForm({
      ...EMPTY_FORM,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourceUrl: '   ',
      storybookUrl: '  ',
    });

    expect(result).toMatchObject({
      ok: true,
      metadata: {
        sourceUrl: undefined,
        storybookUrl: undefined,
      },
    });
  });
});

describe('connection status presentation', () => {
  it('distinguishes saved, unsaved, and not-connected states with text', () => {
    expect(getConnectionStatusSummary(true, false)).toEqual({
      connectionLabel: 'Connected',
    });
    expect(getConnectionStatusSummary(true, true)).toEqual({
      connectionLabel: 'Connected',
      unsavedLabel: 'Unsaved changes',
    });
    expect(getConnectionStatusSummary(false, false)).toEqual({
      connectionLabel: 'Not connected',
    });
    expect(getConnectionStatusSummary(false, true)).toEqual({
      connectionLabel: 'Not connected',
      unsavedLabel: 'Unsaved setup',
    });
  });

  it('returns a safe machine value for valid dates and rejects invalid dates', () => {
    const formatted = formatConnectionUpdatedAt('2026-07-15T10:30:00.000Z');

    expect(formatted).toMatchObject({
      dateTime: '2026-07-15T10:30:00.000Z',
      label: expect.not.stringMatching(/invalid date/i),
    });
    expect(formatConnectionUpdatedAt('not-a-date')).toBeNull();
    expect(formatConnectionUpdatedAt(undefined)).toBeNull();
  });
});

describe('selection status announcements', () => {
  it('announces an invalid or empty selection without inventing connection state', () => {
    expect(getSelectionStatusAnnouncement({
      status: 'empty',
      message: 'Select a single component.',
    })).toBe('Select a single component.');
  });

  it('includes the selected component and the main-process connection message', () => {
    expect(getSelectionStatusAnnouncement({
      ...readyState('A', 'Button', 'tashil-ui'),
      message: 'This component already has a Storybook connection.',
    })).toBe('Button selected. This component already has a Storybook connection.');
  });
});

describe('selection-scoped drafts', () => {
  it('marks edits dirty and clears dirty state when reverted to the baseline', () => {
    const original = createFormDraft({ ...EMPTY_FORM, componentName: 'Button' });
    const edited = updateFormDraft(original, 'componentName', 'IconButton');
    const reverted = updateFormDraft(edited, 'componentName', 'Button');

    expect(edited.isDirty).toBe(true);
    expect(reverted.isDirty).toBe(false);
  });

  it('preserves a dirty draft when the same selection refreshes', () => {
    const token = '1:2';
    const first = selectFormDraft(new Map(), readyState(token, 'Button', 'old-package'));
    const edited = updateFormDraft(first.draft!, 'importPath', 'local-package');
    const drafts = new Map(first.drafts).set(token, edited);
    const refreshed = selectFormDraft(drafts, readyState(token, 'Button', 'server-package'));

    expect(refreshed.restored).toBe(true);
    expect(refreshed.draft?.values.importPath).toBe('local-package');
  });

  it('keeps drafts isolated by selection token and restores them when switching back', () => {
    const selectionA = selectFormDraft(new Map(), readyState('A', 'Button', 'package-a'));
    const draftA = updateFormDraft(selectionA.draft!, 'sourcePath', 'draft-a.tsx');
    let drafts: DraftStore = new Map(selectionA.drafts).set('A', draftA);

    const selectionB = selectFormDraft(drafts, readyState('B', 'Card', 'package-b'));
    drafts = selectionB.drafts;
    const draftB = updateFormDraft(selectionB.draft!, 'sourcePath', 'draft-b.tsx');
    drafts = new Map(drafts).set('B', draftB);

    const restoredA = selectFormDraft(drafts, readyState('A', 'Button', 'server-a'));

    expect(selectionB.draft?.values).toMatchObject({
      componentName: 'Card',
      importPath: 'package-b',
    });
    expect(restoredA.draft?.values.sourcePath).toBe('draft-a.tsx');
    expect(restoredA.draft?.values.sourcePath).not.toBe('draft-b.tsx');
  });

  it('refreshes a clean draft from persisted metadata', () => {
    const first = selectFormDraft(new Map(), readyState('A', 'Button', 'old-package'));
    const refreshed = selectFormDraft(first.drafts, readyState('A', 'Button', 'new-package'));

    expect(refreshed.restored).toBe(false);
    expect(refreshed.draft?.values.importPath).toBe('new-package');
  });

  it('only marks the exact submitted snapshot as saved', () => {
    const submitted = createFormValues({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
    });
    const submittedDraft = updateFormDraft(
      createFormDraft({ ...submitted, importPath: 'old-package' }),
      'importPath',
      submitted.importPath,
    );
    const editedAgain = updateFormDraft(submittedDraft, 'sourcePath', 'newer-edit.tsx');

    expect(markFormDraftSaved(submittedDraft, submitted).isDirty).toBe(false);
    expect(markFormDraftSaved(editedAgain, submitted)).toBe(editedAgain);
  });
});

describe('mutation result correlation', () => {
  it('serializes a selection and ignores a late result after a newer operation starts', () => {
    const submittedValues = { ...EMPTY_FORM, componentName: 'Button' };
    const first = startPendingMutation(createPendingMutationState(), {
      operation: 'save',
      operationId: 'save-1',
      selectionToken: 'A',
      submittedValues,
    });
    expect(first.started).toBe(true);
    expect(first.state.byOperationId.get('save-1')).toMatchObject({ submittedValues });

    const blocked = startPendingMutation(first.state, {
      operation: 'clear',
      operationId: 'clear-1',
      selectionToken: 'A',
    });
    expect(blocked.started).toBe(false);

    const completed = finishPendingMutation(first.state, {
      operation: 'save',
      operationId: 'save-1',
      selectionToken: 'A',
    });
    const second = startPendingMutation(completed.state, {
      operation: 'clear',
      operationId: 'clear-2',
      selectionToken: 'A',
    });
    const lateFirstResult = finishPendingMutation(second.state, {
      operation: 'save',
      operationId: 'save-1',
      selectionToken: 'A',
    });

    expect(lateFirstResult.mutation).toBeUndefined();
    expect(getPendingMutationForSelection(lateFirstResult.state, 'A')).toMatchObject({
      operation: 'clear',
      operationId: 'clear-2',
    });
  });

  it('rejects a result whose selection or operation does not match its operation ID', () => {
    const pending = startPendingMutation(createPendingMutationState(), {
      operation: 'scaffold',
      operationId: 'scaffold-1',
      selectionToken: 'A',
    }).state;

    const mismatched = finishPendingMutation(pending, {
      operation: 'clear',
      operationId: 'scaffold-1',
      selectionToken: 'A',
    });

    expect(mismatched.mutation).toBeUndefined();
    expect(mismatched.state).toBe(pending);
  });
});

describe('destructive and copy feedback', () => {
  it('requires a confirmation step before Clear can mutate metadata', () => {
    expect(getClearAction(false)).toBe('request-confirmation');
    expect(getClearAction(true)).toBe('clear');
  });

  it('provides screen-reader feedback for copy success and failure', () => {
    expect(getCopyFeedback('idle', 'Code')).toEqual({
      ariaLabel: 'Copy Code',
      message: '',
    });
    expect(getCopyFeedback('copied', 'Code')).toEqual({
      ariaLabel: 'Code copied',
      message: 'Code copied to clipboard.',
    });
    expect(getCopyFeedback('error', 'Code')).toEqual({
      ariaLabel: 'Copy Code failed',
      message: 'Could not copy Code.',
    });
  });
});
