/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SemanticMappingView } from './semantic-editor-view';
import {
  createRecipeDraft,
  setTargetOption,
  OPTION_RUNTIME,
  OPTION_STATIC,
} from './semantic/authoring';
import { extractFigmaSemanticSnapshot } from './semantic/figma-extractor';
import { DIALOG_SOURCE_FIXTURE, createDialogNode } from './semantic/fixtures';
import { extractSourceContract } from './semantic/source-contract';
import type { FigmaComponentSnapshot } from './types';

function createDialogFigmaSnapshot(): FigmaComponentSnapshot {
  return {
    componentId: '1:23',
    componentName: 'Dialog',
    properties: [
      {
        defaultValue: 'Danger',
        id: 'prop-intent',
        name: 'intent',
        options: ['Danger', 'Default'],
        rawKey: 'intent',
        type: 'VARIANT',
      },
    ],
  };
}

function createDialogRecipeDraft() {
  const contractResult = extractSourceContract([
    { contents: DIALOG_SOURCE_FIXTURE, fileName: 'confirmation-dialog.tsx' },
  ]);
  if (!contractResult.ok) {
    throw new Error(contractResult.message);
  }
  const semanticSnapshot = extractFigmaSemanticSnapshot(createDialogNode(), '1:23').snapshot;
  return createRecipeDraft(contractResult.contract, createDialogFigmaSnapshot(), semanticSnapshot);
}

/** Open a code prop; its decision then appears inline beneath it. */
function selectTarget(targetPath: string): void {
  const head = screen.getAllByText(targetPath)
    .map((node) => node.closest('.prop-head'))
    .find((node): node is HTMLElement => node !== null);
  if (!head) {
    throw new Error(`No prop row for ${targetPath}`);
  }
  if (head.getAttribute('aria-expanded') !== 'true') {
    fireEvent.click(head);
  }
}

/** Pick one of the grouped answers for the open prop. */
function chooseAnswer(name: string): void {
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(name) }));
}

afterEach(cleanup);

describe('SemanticMappingView', () => {
  it('renders grouped code targets as the primary column with one control each', () => {
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    expect(screen.getByText('Implementation mapping')).toBeTruthy();
    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByText('Variants & states')).toBeTruthy();
    expect(screen.getByText('Actions')).toBeTruthy();
    expect(screen.getByText('Application behavior')).toBeTruthy();
    expect(screen.getByText('confirmAction.label')).toBeTruthy();
    expect(screen.getByLabelText('6 of 6 code props resolved')).toBeTruthy();

    selectTarget('confirmAction.label');
    // The chosen Figma value is one of the grouped answers, and it is selected.
    const chosen = screen.getByRole('radio', { name: /Primary action: label - Delete/ });
    expect((chosen as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Component properties')).toBeTruthy();
    expect(screen.getByText('Nested instances')).toBeTruthy();
    expect(screen.getByRole('radio', { name: /Title: text - Delete account\?/ })).toBeTruthy();
  });

  it('shows the structural mismatch note as information, not an error', () => {
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    expect(screen.getByRole('note').textContent).toContain(
      'The Figma layers and the code structure differ.',
    );
  });

  it('renders the inline generated-code preview from captured samples', () => {
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    const preview = screen.getByLabelText('Generated semantic usage preview');
    expect(preview.textContent).toContain('<ConfirmationDialog');
    expect(preview.textContent).toContain('title={"Delete account?"}');
    expect(preview.textContent).toContain('onConfirm={undefined /* Set in application. */}');
    expect(preview.textContent).not.toContain('Dialog.Header');
    expect(preview.textContent).toMatch(/<ConfirmationDialog\n {2}[A-Za-z_$]/);
    expect(preview.textContent).toMatch(/\n {2}title=/);
    expect(preview.textContent).toMatch(/\n {2}onConfirm=/);
  });

  it('reports unresolved required targets and forwards control changes', () => {
    const onOptionChange = vi.fn();
    const figmaSnapshot = createDialogFigmaSnapshot();
    const recipe = setTargetOption(createDialogRecipeDraft(), figmaSnapshot, ['title'], '');

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={onOptionChange}
        recipe={recipe}
      />,
    );

    expect(screen.getByText(/Map, set, or mark "title" before saving/).textContent)
      .toContain('required');
    expect(screen.getByLabelText('5 of 6 code props resolved')).toBeTruthy();

    selectTarget('title');
    fireEvent.click(screen.getByRole('radio', { name: 'Set in code' }));
    expect(onOptionChange).toHaveBeenCalledWith(['title'], 'runtime', undefined);
  });

  it('keeps the focused prop selected after its mapping changes', () => {
    const figmaSnapshot = createDialogFigmaSnapshot();
    let recipe = setTargetOption(
      createDialogRecipeDraft(),
      figmaSnapshot,
      ['title'],
      '',
    );

    const renderView = () => (
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={(path, optionId, staticValue) => {
          recipe = setTargetOption(recipe, figmaSnapshot, path, optionId, staticValue);
          view.rerender(renderView());
        }}
        recipe={recipe}
      />
    );

    const view = render(renderView());
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('title');

    fireEvent.click(screen.getByRole('radio', { name: 'Set in code' }));

    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe('title');
    expect(screen.getByRole('button', { name: /Resolved title/ })
      .getAttribute('aria-expanded')).toBe('true');
  });

  it('shows only the controls for the selected source mode', () => {
    const figmaSnapshot = createDialogFigmaSnapshot();
    let recipe = setTargetOption(
      createDialogRecipeDraft(),
      figmaSnapshot,
      ['intent'],
      'prop:prop-intent',
    );
    const renderView = () => (
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={recipe}
      />
    );
    const view = render(renderView());

    selectTarget('intent');
    expect(screen.getByText('Figma properties')).toBeTruthy();
    expect(screen.getByText('Includes exposed properties from nested instances.')).toBeTruthy();
    expect(screen.queryByText('Code value')).toBeNull();

    recipe = setTargetOption(recipe, figmaSnapshot, ['intent'], OPTION_RUNTIME);
    view.rerender(renderView());
    expect(screen.queryByText('Figma properties')).toBeNull();
    expect(screen.getByText('Code value')).toBeTruthy();
    expect(screen.queryByLabelText('Static value for intent')).toBeNull();

    recipe = setTargetOption(recipe, figmaSnapshot, ['intent'], OPTION_STATIC, 'Danger');
    view.rerender(renderView());
    expect(screen.getByLabelText('Static value for intent')).toBeTruthy();

    selectTarget('description');
    expect(screen.getByRole('radio', { name: 'Left out' })).toBeTruthy();
  });

  it('labels runtime targets as set in application', () => {
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    selectTarget('onConfirm');
    const inApp = screen.getByRole('radio', { name: /In the app/ });
    expect(inApp.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the Figma side, including values nothing maps to', () => {
    const figmaSnapshot = createDialogFigmaSnapshot();
    // A variant the recipe never uses: the board must surface it, since a
    // dropdown of options could never tell you it exists.
    figmaSnapshot.properties.push({
      id: 'prop-state',
      name: 'State',
      options: ['Default', 'Disabled'],
      rawKey: 'State',
      type: 'VARIANT',
    });

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    // The audit question is answered by one summary line, not a whole column.
    expect(document.body.textContent).toMatch(/design values are unused/);
    expect(screen.getByText('State')).toBeTruthy();
  });

  it('connects a Figma value to the focused code prop in one click', () => {
    const onOptionChange = vi.fn();
    const figmaSnapshot = createDialogFigmaSnapshot();
    const recipe = setTargetOption(createDialogRecipeDraft(), figmaSnapshot, ['intent'], '');

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={onOptionChange}
        recipe={recipe}
      />,
    );

    selectTarget('intent');
    // The Figma value is chosen from the same grouped set as everything else.
    chooseAnswer('intent');
    expect(onOptionChange).toHaveBeenCalledWith(['intent'], 'prop:prop-intent', undefined);
  });

  it('lets a boolean prop take a Figma boolean property', () => {
    const onOptionChange = vi.fn();
    const figmaSnapshot = createDialogFigmaSnapshot();
    figmaSnapshot.properties.push({
      id: 'p-hasicon',
      name: 'hasLeadingIcon',
      options: ['False', 'True'],
      rawKey: 'hasLeadingIcon',
      type: 'BOOLEAN',
    });
    const recipe = createDialogRecipeDraft();
    recipe.sourceContract!.targets.push({
      kind: 'visual',
      ownerProp: 'disabled',
      path: ['disabled'],
      required: false,
      typeName: 'boolean',
      values: [false, true],
    });

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={onOptionChange}
        recipe={recipe}
      />,
    );

    selectTarget('disabled');
    // The boolean Figma property is offered as a normal answer, never greyed.
    const booleanChoice = screen.getByRole('radio', { name: /hasLeadingIcon/ });
    expect((booleanChoice as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(booleanChoice);
    expect(onOptionChange).toHaveBeenCalledWith(['disabled'], 'prop:p-hasicon', undefined);
  });

  it('renders nothing without a source contract', () => {
    const { container } = render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={undefined}
      />,
    );

    expect(container.innerHTML).toBe('');
  });

  it('renders reconciliation proposals with the correct actions', () => {
    const onApplyProposal = vi.fn();
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onApplyProposal={onApplyProposal}
        onOptionChange={vi.fn()}
        proposals={[
          {
            bindingId: 'binding-confirm-label',
            kind: 'locator-moved',
            message: 'The Figma source for "confirmAction.label" moved.',
            newLocator: { componentKey: 'k', fragile: false, namePath: ['Actions', 'Primary action'] },
            targetPath: 'confirmAction.label',
          },
          {
            bindingId: 'binding-title',
            kind: 'design-removed',
            message: 'The Figma source for "title" was not found.',
            targetPath: 'title',
          },
        ]}
        recipe={createDialogRecipeDraft()}
      />,
    );

    expect(screen.getByText('Changes need review')).toBeTruthy();

    // Each control has a unique accessible name naming its target, so a screen
    // reader can distinguish otherwise-identical Accept/Remove buttons.
    fireEvent.click(
      screen.getByRole('button', { name: 'Accept remap for confirmAction.label' }),
    );
    expect(onApplyProposal).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: 'binding-confirm-label', kind: 'locator-moved' }),
      'accept',
    );

    // The remove-only proposal exposes only a Remove action.
    expect(screen.queryByRole('button', { name: 'Accept remap for title' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove mapping for title' }));
    expect(onApplyProposal).toHaveBeenCalledWith(
      expect.objectContaining({ bindingId: 'binding-title', kind: 'design-removed' }),
      'remove',
    );
  });

  it('offers a debug-bundle export and forwards the click', () => {
    const onExportDebugBundle = vi.fn();
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onExportDebugBundle={onExportDebugBundle}
        onOptionChange={vi.fn()}
        recipe={createDialogRecipeDraft()}
      />,
    );

    const button = screen.getByRole('button', { name: 'Export debug bundle' });
    fireEvent.click(button);
    expect(onExportDebugBundle).toHaveBeenCalledTimes(1);
    // The redaction promise is stated where the user acts on it.
    expect(document.body.textContent).toContain('Redacted: structure and health only.');
    expect(button.getAttribute('title')).toContain('no source code');
  });

  it('gives a boolean static value a true/false control, not free text', () => {
    const onOptionChange = vi.fn();
    const figmaSnapshot = createDialogFigmaSnapshot();
    let recipe = createDialogRecipeDraft();
    // Add a boolean target and mark it static.
    recipe.sourceContract!.targets.push({
      kind: 'visual',
      ownerProp: 'fullWidth',
      path: ['fullWidth'],
      required: false,
      typeName: 'boolean',
      values: [false, true],
    });
    recipe = setTargetOption(recipe, figmaSnapshot, ['fullWidth'], OPTION_STATIC, false);

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={onOptionChange}
        recipe={recipe}
      />,
    );

    selectTarget('fullWidth');
    const control = screen.getByLabelText('Static value for fullWidth') as HTMLInputElement;
    // A plain text field, without a suggestion dropdown.
    expect(control.tagName).toBe('INPUT');
    expect(control.getAttribute('list')).toBeNull();
    expect(document.querySelector('datalist')).toBeNull();

    // Typing a declared value still stores a real boolean, not the string.
    fireEvent.input(control, { target: { value: 'true' } });
    expect(onOptionChange).toHaveBeenCalledWith(['fullWidth'], OPTION_STATIC, true);
  });

  it('accepts arbitrary text for a literal-union static value', () => {
    const onOptionChange = vi.fn();
    const figmaSnapshot = createDialogFigmaSnapshot();
    let recipe = createDialogRecipeDraft();
    recipe.sourceContract!.targets.push({
      kind: 'visual',
      ownerProp: 'size',
      path: ['size'],
      required: false,
      typeName: "'sm' | 'md' | 'lg'",
      values: ['sm', 'md', 'lg'],
    });
    recipe = setTargetOption(recipe, figmaSnapshot, ['size'], OPTION_STATIC, 'sm');

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={onOptionChange}
        recipe={recipe}
      />,
    );

    selectTarget('size');
    const control = screen.getByLabelText('Static value for size') as HTMLInputElement;
    expect(control.tagName).toBe('INPUT');
    expect(document.body.textContent).not.toContain('only accepts');
    expect(document.body.textContent).not.toContain('Accepts sm, md, lg');

    fireEvent.input(control, { target: { value: 'anything-custom' } });
    expect(onOptionChange).toHaveBeenCalledWith(
      ['size'],
      OPTION_STATIC,
      'anything-custom',
    );
  });

  it('keeps free text for an open string prop', () => {
    const figmaSnapshot = createDialogFigmaSnapshot();
    // `title` is a plain string: no closed set, so any text is legal.
    const recipe = setTargetOption(
      createDialogRecipeDraft(), figmaSnapshot, ['title'], OPTION_STATIC, 'Hello',
    );

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={figmaSnapshot}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={recipe}
      />,
    );

    selectTarget('title');
    const control = screen.getByLabelText('Static value for title') as HTMLInputElement;
    expect(control.tagName).toBe('INPUT');
    expect(control.value).toBe('Hello');
  });

  it('explains what Set in application generates', () => {
    let recipe = createDialogRecipeDraft();
    recipe = setTargetOption(recipe, createDialogFigmaSnapshot(), ['description'], OPTION_RUNTIME);

    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        recipe={recipe}
      />,
    );

    selectTarget('description');
    chooseAnswer('In the app');
    expect(document.body.textContent).toContain('emitted as undefined');
  });

  it('shows no reconciliation panel when there are no proposals', () => {
    render(
      <SemanticMappingView
        componentName="ConfirmationDialog"
        disabled={false}
        figmaSnapshot={createDialogFigmaSnapshot()}
        importPath="@tashilcar/ui"
        onOptionChange={vi.fn()}
        proposals={[]}
        recipe={createDialogRecipeDraft()}
      />,
    );

    expect(screen.queryByText('Changes need review')).toBeNull();
  });
});
