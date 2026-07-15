import { describe, expect, it } from 'vitest';
import type { UiSelectionState } from './types';
import {
  clearFormDraft,
  createFormDraft,
  createFormValues,
  getClearAction,
  getCopyFeedback,
  getFirstInvalidField,
  markFormDraftSaved,
  selectFormDraft,
  updateFormDraft,
  validateConnectionForm,
  type ConnectionFormValues,
  type DraftStore,
} from './ui-state';

const EMPTY_FORM: ConnectionFormValues = {
  componentName: '',
  importPath: '',
  propMappings: '',
  sourcePath: '',
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
      componentName,
      importPath,
    },
    message: 'Ready',
  };
}

describe('connection form validation', () => {
  it('returns trimmed metadata for a valid form', () => {
    const result = validateConnectionForm({
      componentName: ' Button ',
      importPath: ' tashil-ui ',
      propMappings: '{"size":{"small":{"prop":"size","value":"sm"}}}',
      sourcePath: ' src/Button.tsx ',
      storybookUrl: ' https://storybook.test/button ',
    });

    expect(result).toEqual({
      ok: true,
      metadata: {
        schemaVersion: 2,
        componentName: 'Button',
        importPath: 'tashil-ui',
        propMappings: {
          size: { small: { prop: 'size', value: 'sm' } },
        },
        sourcePath: 'src/Button.tsx',
        storybookUrl: 'https://storybook.test/button',
      },
    });
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
    const submitted = createFormValues({ componentName: 'Button', importPath: 'tashil-ui' });
    const submittedDraft = updateFormDraft(
      createFormDraft({ ...submitted, importPath: 'old-package' }),
      'importPath',
      submitted.importPath,
    );
    const editedAgain = updateFormDraft(submittedDraft, 'sourcePath', 'newer-edit.tsx');

    expect(markFormDraftSaved(submittedDraft, submitted).isDirty).toBe(false);
    expect(markFormDraftSaved(editedAgain, submitted)).toBe(editedAgain);
  });

  it('clears every input for only the requested selection', () => {
    const otherDraft = createFormDraft({ ...EMPTY_FORM, componentName: 'Card' });
    const currentDraft = createFormDraft({
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: '{}',
      sourcePath: 'src/Button.tsx',
      storybookUrl: 'https://storybook.test/button',
    });
    const cleared = clearFormDraft(new Map([
      ['current', currentDraft],
      ['other', otherDraft],
    ]), 'current');

    expect(cleared.draft).toEqual({
      baseline: EMPTY_FORM,
      isDirty: false,
      values: EMPTY_FORM,
    });
    expect(cleared.drafts.get('current')).toBe(cleared.draft);
    expect(cleared.drafts.get('other')).toBe(otherDraft);
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
