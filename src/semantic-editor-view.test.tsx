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

/** Focus a code prop on the board; its editing controls then appear below. */
function selectTarget(targetPath: string): void {
  // The name also appears in the detail header, so pick the board entry.
  const button = screen.getAllByText(targetPath)
    .map((node) => node.closest('button'))
    .find((node): node is HTMLButtonElement => node !== null);
  if (!button) {
    throw new Error(`No board row for ${targetPath}`);
  }
  fireEvent.click(button);
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

    // Both sides of the connection are on the board.
    expect(screen.getByText('Figma')).toBeTruthy();
    expect(screen.getByText('Code')).toBeTruthy();

    selectTarget('confirmAction.label');
    // The detail names the chosen Figma value rather than hiding it in a select.
    expect(document.body.textContent).toContain('Using');
    expect(document.body.textContent).toContain('Primary action / label');
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

    selectTarget('title');
    // The kind of source is a named choice, not an anonymous dropdown entry.
    fireEvent.click(screen.getByRole('button', { name: 'In the app' }));
    expect(onOptionChange).toHaveBeenCalledWith(['title'], 'runtime');
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
    const inApp = screen.getByRole('button', { name: 'In the app' });
    expect(inApp.getAttribute('aria-pressed')).toBe('true');
    expect(document.body.textContent).toContain('No design value is read');
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

    expect(screen.getByText('State')).toBeTruthy();
    expect(screen.getAllByText('Header / Title').length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/\d+ unused/);
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
    // Clicking the compatible Figma property binds it to the focused prop.
    const figmaRow = screen.getAllByText('intent')
      .map((node) => node.closest('button'))
      .filter((node): node is HTMLButtonElement => node !== null)
      .find((node) => node.title.startsWith('Connect'));
    fireEvent.click(figmaRow!);

    expect(onOptionChange).toHaveBeenCalledWith(['intent'], 'prop:prop-intent');
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
    // The board tells the user what clicking will do...
    expect(document.body.textContent).toContain('Click a value to connect it to');

    // ...and the boolean Figma property is live, not greyed out.
    const booleanRow = screen.getAllByText('hasLeadingIcon')
      .map((node) => node.closest('button'))
      .find((node): node is HTMLButtonElement => node !== null);
    expect(booleanRow?.disabled).toBe(false);

    fireEvent.click(booleanRow!);
    expect(onOptionChange).toHaveBeenCalledWith(['disabled'], 'prop:p-hasicon');
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
    const control = screen.getByLabelText('Static value for fullWidth') as HTMLSelectElement;
    expect(control.tagName).toBe('SELECT');
    expect(control.value).toBe('false');

    // Choosing true stores a real boolean, never the string "true".
    fireEvent.input(control, { target: { value: 'true' } });
    expect(onOptionChange).toHaveBeenCalledWith(['fullWidth'], OPTION_STATIC, true);
  });

  it('constrains a literal-union static value to its legal options', () => {
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
    const control = screen.getByLabelText('Static value for size') as HTMLSelectElement;
    expect(control.tagName).toBe('SELECT');
    expect(Array.from(control.options).map((o) => o.value)).toEqual(['sm', 'md', 'lg']);

    fireEvent.input(control, { target: { value: 'lg' } });
    expect(onOptionChange).toHaveBeenCalledWith(['size'], OPTION_STATIC, 'lg');
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
    fireEvent.click(screen.getByRole('button', { name: 'In the app' }));
    expect(document.body.textContent).toContain('No design value is read');
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
