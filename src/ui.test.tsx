/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin } from './ui';
import {
  CURRENT_SCHEMA_VERSION,
  type ConnectionMetadata,
  type InspectCodeState,
  type MappingDocument,
  type UiTargetState,
} from './types';

type MessageHandler = (payload: unknown) => void;

const messageBus = vi.hoisted(() => {
  const handlers = new Map<string, Set<MessageHandler>>();

  return {
    emit: vi.fn(),
    handlers,
    on: vi.fn((name: string, handler: MessageHandler) => {
      const handlersForName = handlers.get(name) ?? new Set<MessageHandler>();
      handlersForName.add(handler);
      handlers.set(name, handlersForName);
      return () => {
        handlersForName.delete(handler);
      };
    }),
  };
});

vi.mock('@create-figma-plugin/utilities', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@create-figma-plugin/utilities')>();

  return {
    ...actual,
    emit: messageBus.emit,
    on: messageBus.on,
  };
});

vi.mock('@create-figma-plugin/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@create-figma-plugin/ui')>();
  return {
    ...actual,
    render: vi.fn(() => () => undefined),
    useWindowResize: vi.fn(),
  };
});

vi.mock('!./ui.css', () => ({}));

function existingConnection(
  overrides: Partial<ConnectionMetadata> = {},
): ConnectionMetadata {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    childrenMode: 'text',
    childrenTextProperty: 'label',
    componentName: 'Button',
    importPath: 'tashil-ui',
    ...overrides,
  };
}

function readySelection(
  connection?: ConnectionMetadata,
  message = connection
    ? 'This component already has a Storybook connection.'
    : 'This component is ready to connect.',
  targetToken = 'selection-a',
): UiTargetState {
  return {
    status: 'ready',
    targetToken,
    componentName: 'Button',
    existingConnection: connection,
    message,
  };
}

function receive(name: string, payload: unknown): void {
  let eventName = name;
  let eventPayload = payload;

  if (name === 'SELECTION_STATE') {
    const state = payload as UiTargetState & { selectionToken?: string };
    eventName = 'CANVAS_TARGET_STATE';
    eventPayload = {
      source: 'selectionchange',
      state: state.status === 'ready' && !state.targetToken
        ? { ...state, targetToken: state.selectionToken }
        : state,
    };
  } else if (
    typeof payload === 'object'
    && payload !== null
    && 'selectionToken' in payload
    && !('targetToken' in payload)
  ) {
    eventPayload = {
      ...payload,
      targetToken: payload.selectionToken,
    };
  }

  const handlers = messageBus.handlers.get(eventName);
  if (!handlers || handlers.size === 0) {
    throw new Error(`No UI handler registered for ${eventName}.`);
  }

  act(() => {
    for (const handler of handlers) {
      handler(eventPayload);
    }
  });
}

function emittedPayloads<T>(name: string): T[] {
  return messageBus.emit.mock.calls
    .filter(([eventName]) => eventName === name)
    .map(([, payload]) => (
      typeof payload === 'object'
      && payload !== null
      && 'targetToken' in payload
      && !('selectionToken' in payload)
        ? { ...payload, selectionToken: payload.targetToken } as T
        : payload as T
    ));
}

function renderPlugin(): void {
  render(h(Plugin, {}));
}

beforeEach(() => {
  messageBus.emit.mockClear();
  messageBus.on.mockClear();
  messageBus.handlers.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Plugin rendered interactions', () => {
  it('keeps the inventory visible when the initial canvas selection is empty', () => {
    renderPlugin();

    receive('CANVAS_TARGET_STATE', {
      source: 'initial',
      state: {
        message: 'Select a component instance, main component, or component set to connect it.',
        status: 'empty',
      },
    });

    expect(screen.getByRole('main', { name: 'Scanning components' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Back to components' })).toBeNull();
  });

  it('renders, filters, searches, and opens the file-wide component inventory', async () => {
    renderPlugin();
    const scanRequest = emittedPayloads<{ scanId: string }>('SCAN_COMPONENTS')[0];

    receive('COMPONENT_INVENTORY_STATE', {
      scanId: scanRequest.scanId,
      state: {
        items: [
          {
            componentName: '.InternalButton',
            nodeType: 'COMPONENT',
            pageName: 'Components',
            status: 'not-connected',
            targetToken: 'internal-button',
          },
          {
            componentName: 'Button',
            nodeType: 'COMPONENT',
            pageName: 'Components',
            status: 'not-connected',
            targetToken: 'button',
          },
          {
            componentName: 'Slider',
            nodeType: 'COMPONENT_SET',
            pageName: 'Inputs',
            status: 'needs-attention',
            targetToken: 'slider',
          },
          {
            componentName: 'TextField',
            nodeType: 'COMPONENT',
            pageName: 'Inputs',
            status: 'connected',
            targetToken: 'text-field',
          },
        ],
        scannedPages: 2,
        status: 'ready',
        totalPages: 2,
      },
    });

    expect(screen.getByRole('button', { name: /All/ }).getAttribute('aria-pressed'))
      .toBe('true');
    expect(screen.getByText('Button')).toBeTruthy();
    expect(screen.getByText('Needs attention')).toBeTruthy();
    expect(screen.queryByText('.InternalButton')).toBeNull();

    const dotFilter = screen.getByRole('button', {
      name: /Hide names starting with \./,
    });
    expect(dotFilter.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(dotFilter);
    expect(screen.getByText('.InternalButton')).toBeTruthy();
    expect(screen.getByRole('button', { name: /4 All/ })).toBeTruthy();
    fireEvent.click(dotFilter);
    expect(screen.queryByText('.InternalButton')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Not connected/ }));
    expect(screen.getByText('Button')).toBeTruthy();
    expect(screen.getByText('Slider')).toBeTruthy();
    expect(screen.queryByText('TextField')).toBeNull();

    fireEvent.input(screen.getByLabelText('Search components'), {
      target: { value: 'components' },
    });
    expect(screen.getByText('Button')).toBeTruthy();
    expect(screen.queryByText('Slider')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Button Components/ }));
    const openRequest = emittedPayloads<{
      requestId: string;
      targetToken: string;
    }>('OPEN_COMPONENT_TARGET')[0];
    expect(openRequest.targetToken).toBe('button');

    receive('COMPONENT_TARGET_STATE', {
      requestId: openRequest.requestId,
      state: {
        componentName: 'Button',
        message: 'This component is ready to connect.',
        status: 'ready',
        targetToken: 'button',
      },
    });

    expect((screen.getByLabelText('Component name') as HTMLInputElement).value)
      .toBe('Button');

    receive('CANVAS_TARGET_STATE', {
      source: 'selectionchange',
      state: {
        componentName: 'Other component',
        message: 'This component is ready to connect.',
        status: 'ready',
        targetToken: 'other',
      },
    });
    expect((screen.getByLabelText('Component name') as HTMLInputElement).value)
      .toBe('Button');

    fireEvent.click(screen.getByRole('button', { name: 'Back to components' }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('tashil-component-button');
    });
    expect((screen.getByLabelText('Search components') as HTMLInputElement).value)
      .toBe('components');
  });

  it('renders through the real Preact component library and moves tab focus with arrows/Home/End', () => {
    renderPlugin();

    const connectTab = screen.getByRole('tab', { name: 'Components' });
    const inspectTab = screen.getByRole('tab', { name: 'Inspect Code' });
    connectTab.focus();

    fireEvent.keyDown(connectTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(inspectTab);
    expect(inspectTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(inspectTab, { key: 'Home' });
    expect(document.activeElement).toBe(connectTab);
    expect(connectTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(connectTab, { key: 'End' });
    expect(document.activeElement).toBe(inspectTab);

    fireEvent.keyDown(inspectTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(connectTab);
  });

  it('shows the correct connection status and action availability as setup changes', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection());

    expect(screen.getByRole('heading', { name: 'Not connected' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled)
      .toBe(true);

    fireEvent.input(screen.getByLabelText('Import path'), {
      target: { value: 'tashil-ui' },
    });
    expect(screen.getByText('Unsaved setup')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled)
      .toBe(false);

    const updatedAt = '2026-07-15T08:30:00.000Z';
    receive('SELECTION_STATE', readySelection(
      existingConnection({ updatedAt }),
      'This component already has a Storybook connection.',
      'selection-b',
    ));
    expect(screen.getByRole('heading', { name: 'Connected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled)
      .toBe(true);
    const timestamp = document.querySelector('time');
    expect(timestamp?.dateTime).toBe(updatedAt);

    fireEvent.input(screen.getByLabelText('Source path'), {
      target: { value: 'src/Button.tsx' },
    });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();

    receive('SELECTION_STATE', {
      status: 'ready',
      selectionToken: 'selection-c',
      componentName: 'Button',
      connectionIssue: {
        reason: 'future-schema-version',
        message: 'This connection was saved by a newer plugin version.',
      },
      message: 'Stored connection needs attention.',
    });
    expect(screen.getByRole('heading', {
      name: 'Stored connection needs attention',
    })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    fireEvent.input(screen.getByLabelText('Import path'), {
      target: { value: 'tashil-ui' },
    });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it('renders content and RTL icon-slot mappings as first-class rows', () => {
    const mappingDocument: MappingDocument = {
      figmaSnapshot: {
        componentId: 'button-set',
        componentName: 'Button',
        properties: [
          { id: 'label-id', name: 'label', options: [], rawKey: 'label#label-id', type: 'TEXT' },
          { id: 'leading-id', name: 'LeadingIcon', options: [], rawKey: 'LeadingIcon#leading-id', type: 'INSTANCE_SWAP' },
          { id: 'trailing-id', name: 'TrailingIcon', options: [], rawKey: 'TrailingIcon#trailing-id', type: 'INSTANCE_SWAP' },
          { id: 'has-leading-id', name: 'HasLeadingIcon', options: ['False', 'True'], rawKey: 'HasLeadingIcon#has-leading-id', type: 'BOOLEAN' },
          { id: 'has-trailing-id', name: 'HasTrailingIcon', options: ['False', 'True'], rawKey: 'HasTrailingIcon#has-trailing-id', type: 'BOOLEAN' },
        ],
      },
      mappings: [
        { figmaPropertyId: 'label-id', figmaPropertyName: 'label', kind: 'children', sourceProp: 'children', values: [] },
        { figmaPropertyId: 'leading-id', figmaPropertyName: 'LeadingIcon', kind: 'instance-swap', sourceProp: 'renderRightIcon', values: [] },
        { figmaPropertyId: 'trailing-id', figmaPropertyName: 'TrailingIcon', kind: 'instance-swap', sourceProp: 'renderLeftIcon', values: [] },
      ],
      revision: 1,
      sourceSnapshot: {
        componentName: 'Button',
        contentHash: 'fnv1a-12345678',
        fileName: 'types.ts',
        props: [
          { name: 'children', required: false, role: 'children', typeName: 'ReactNode' },
          { name: 'renderRightIcon', required: false, role: 'advanced', typeName: 'ReactNode' },
          { name: 'renderLeftIcon', required: false, role: 'advanced', typeName: 'ReactNode' },
        ],
      },
    };
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      childrenTextProperty: 'label',
      mappingDocument,
      propMappings: {
        LeadingIcon: { '*': { prop: 'renderRightIcon', value: '$instanceSwap' } },
        TrailingIcon: { '*': { prop: 'renderLeftIcon', value: '$instanceSwap' } },
      },
    })));

    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByText('Slots')).toBeTruthy();
    expect((screen.getByLabelText('Figma property for children') as HTMLSelectElement).value)
      .toBe('label-id');
    expect((screen.getByLabelText('Figma property for renderRightIcon') as HTMLSelectElement).value)
      .toBe('leading-id');
    expect((screen.getByLabelText('Figma property for renderLeftIcon') as HTMLSelectElement).value)
      .toBe('trailing-id');
    expect(screen.getByText('Visibility: HasLeadingIcon')).toBeTruthy();
    expect(screen.getByText('Visibility: HasTrailingIcon')).toBeTruthy();

    fireEvent.input(screen.getByLabelText('Figma property for children'), {
      target: { value: '' },
    });
    expect((screen.getByLabelText('Figma property for children') as HTMLSelectElement).value)
      .toBe('');
    fireEvent.input(screen.getByLabelText('Figma property for children'), {
      target: { value: 'label-id' },
    });
    expect((screen.getByLabelText('Figma property for children') as HTMLSelectElement).value)
      .toBe('label-id');

    fireEvent.input(screen.getByLabelText('Figma property for renderRightIcon'), {
      target: { value: '' },
    });
    expect((screen.getByLabelText('Figma property for renderRightIcon') as HTMLSelectElement).value)
      .toBe('');
    expect(screen.getByText('Property mapping updated.')).toBeTruthy();
    const mappings = JSON.parse(
      screen.getByLabelText('Generated prop mappings JSON').textContent ?? '{}',
    ) as Record<string, unknown>;
    expect(mappings).not.toHaveProperty('LeadingIcon');
    expect(mappings).toHaveProperty('TrailingIcon');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{
      metadata: ConnectionMetadata;
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const firstSave = saveRequests[saveRequests.length - 1]!;
    expect(firstSave.metadata.mappingDocument?.revision).toBe(1);
    receive('SAVE_RESULT', {
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: firstSave.operationId,
      selectionToken: firstSave.selectionToken,
    });

    fireEvent.input(screen.getByLabelText('Figma property for renderRightIcon'), {
      target: { value: 'leading-id' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const secondSaveRequests = emittedPayloads<{ metadata: ConnectionMetadata }>('SAVE_CONNECTION');
    const secondSave = secondSaveRequests[secondSaveRequests.length - 1]!;
    expect(secondSave.metadata.mappingDocument?.revision).toBe(2);
  });

  it('uploads source through the file input and replaces it by drag and drop', async () => {
    renderPlugin();
    receive('SELECTION_STATE', {
      ...readySelection(),
      figmaSnapshot: {
        componentId: 'button-set',
        componentName: 'Button',
        properties: [{
          id: 'style-id',
          name: 'Style',
          options: ['Primary', 'Secondary'],
          rawKey: 'Style#style-id',
          type: 'VARIANT',
        }],
      },
    });

    const firstFile = new File([], 'Button.types.ts', { type: 'text/typescript' });
    Object.defineProperty(firstFile, 'text', {
      value: vi.fn().mockResolvedValue([
        "export type ButtonVariant = 'primary' | 'secondary';",
        'export interface ButtonProps { variant?: ButtonVariant; }',
      ].join('\n')),
    });
    fireEvent.input(screen.getByLabelText('Upload source'), {
      target: { files: [firstFile] },
    });

    await waitFor(() => {
      expect(screen.getByText('Button.types.ts')).toBeTruthy();
      expect(screen.getByText('Healthy')).toBeTruthy();
    });
    expect(screen.getByLabelText('Figma property for variant')).toBeTruthy();

    const replacement = new File([], 'Button.next.tsx', { type: 'text/typescript' });
    Object.defineProperty(replacement, 'text', {
      value: vi.fn().mockResolvedValue([
        "export type ButtonVariant = 'primary' | 'secondary';",
        'export interface ButtonProps { variant?: ButtonVariant; }',
      ].join('\n')),
    });
    const dropZone = screen.getByText('Source & prop mappings').closest('section');
    expect(dropZone).not.toBeNull();
    fireEvent.drop(dropZone!, { dataTransfer: { files: [replacement] } });

    await waitFor(() => {
      expect(screen.getByText('Button.next.tsx')).toBeTruthy();
    });

    fireEvent.input(screen.getByLabelText('Import path'), {
      target: { value: 'tashil-ui' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{ metadata: ConnectionMetadata }>('SAVE_CONNECTION');
    expect(saveRequests[saveRequests.length - 1]?.metadata.childrenMode).toBe('none');
  });

  it('keeps a save pending through stale results, then accepts exact success and failure', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      sourcePath: 'src/Button.tsx',
    })));

    const sourcePath = screen.getByLabelText('Source path') as HTMLInputElement;
    fireEvent.input(sourcePath, { target: { value: 'src/Button.next.tsx' } });
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    const saveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const firstRequest = saveRequests[saveRequests.length - 1]!;
    const saving = screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    expect(screen.getByText('Saving connection…')).toBeTruthy();

    receive('SAVE_RESULT', {
      message: 'Stale save should be ignored.',
      ok: true,
      operation: 'save',
      operationId: `${firstRequest.operationId}-stale`,
      selectionToken: firstRequest.selectionToken,
    });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect(screen.queryByText('Stale save should be ignored.')).toBeNull();

    receive('SAVE_RESULT', {
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: firstRequest.operationId,
      selectionToken: firstRequest.selectionToken,
    });
    expect(screen.getByText('Connection saved.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.input(sourcePath, { target: { value: 'src/Button.failed.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const updatedSaveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const secondRequest = updatedSaveRequests[updatedSaveRequests.length - 1]!;

    receive('SAVE_RESULT', {
      message: 'Could not save the connection.',
      ok: false,
      operation: 'save',
      operationId: secondRequest.operationId,
      selectionToken: secondRequest.selectionToken,
    });
    expect(screen.getByRole('alert').textContent).toContain('Could not save the connection.');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('merges scaffold success and reports main-process and invalid-current failures', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      propMappings: {
        Size: { Small: { prop: 'size', value: 'sm' } },
      },
    })));

    const generate = screen.getByRole('button', { name: 'Generate from component' });
    fireEvent.click(generate);
    const scaffoldRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SCAFFOLD_PROP_MAPPINGS');
    const firstRequest = scaffoldRequests[scaffoldRequests.length - 1]!;

    receive('SCAFFOLD_RESULT', {
      mappings: {
        Size: {
          Large: { prop: 'size', value: 'lg' },
          Small: { prop: 'size', value: 'small-generated' },
        },
      },
      ok: true,
      operationId: firstRequest.operationId,
      selectionToken: firstRequest.selectionToken,
    });

    const propMappings = screen.getByLabelText('Prop mappings JSON') as HTMLTextAreaElement;
    expect(JSON.parse(propMappings.value)).toEqual({
      Size: {
        Large: { prop: 'size', value: 'lg' },
        Small: { prop: 'size', value: 'sm' },
      },
    });
    expect(screen.getByText('Generated prop mappings from the selected component.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Generate from component' }));
    const updatedScaffoldRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SCAFFOLD_PROP_MAPPINGS');
    const failureRequest = updatedScaffoldRequests[updatedScaffoldRequests.length - 1]!;
    receive('SCAFFOLD_RESULT', {
      message: 'No variant properties found.',
      ok: false,
      operationId: failureRequest.operationId,
      selectionToken: failureRequest.selectionToken,
    });
    expect(screen.getByRole('alert').textContent).toContain('No variant properties found.');

    fireEvent.input(propMappings, { target: { value: '{' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate from component' }));
    const finalScaffoldRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SCAFFOLD_PROP_MAPPINGS');
    const invalidRequest = finalScaffoldRequests[finalScaffoldRequests.length - 1]!;
    receive('SCAFFOLD_RESULT', {
      mappings: { Size: { Large: { prop: 'size', value: 'lg' } } },
      ok: true,
      operationId: invalidRequest.operationId,
      selectionToken: invalidRequest.selectionToken,
    });
    expect(screen.getByRole('alert').textContent).toContain(
      'Fix the existing prop mappings JSON before scaffolding.',
    );
    expect(propMappings.value).toBe('{');
  });

  it('focuses clear confirmation, returns focus on cancel, and completes a correlated clear', () => {
    vi.useFakeTimers();
    renderPlugin();
    const connectedState = readySelection(existingConnection());
    receive('SELECTION_STATE', connectedState);

    let clear = screen.getByRole('button', { name: 'Clear' });
    fireEvent.click(clear);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    expect(document.activeElement).toBe(cancel);

    fireEvent.click(cancel);
    act(() => {
      vi.runAllTimers();
    });
    clear = screen.getByRole('button', { name: 'Clear' });
    expect(document.activeElement).toBe(clear);

    fireEvent.click(clear);
    receive('SELECTION_STATE', readySelection());
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();

    receive('SELECTION_STATE', connectedState);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear connection' }));
    const clearRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('CLEAR_CONNECTION');
    const request = clearRequests[clearRequests.length - 1]!;
    expect((screen.getByRole('button', { name: 'Clearing…' }) as HTMLButtonElement).disabled)
      .toBe(true);

    receive('SAVE_RESULT', {
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      operationId: request.operationId,
      selectionToken: request.selectionToken,
    });
    expect(screen.getByText('Connection cleared.')).toBeTruthy();
    expect((screen.getByLabelText('Import path') as HTMLInputElement).value).toBe('');
  });

  it('moves focus into Help and returns it to the Help button', () => {
    vi.useFakeTimers();
    renderPlugin();

    const help = screen.getByRole('button', { name: 'Open how it works' });
    fireEvent.click(help);
    const heading = screen.getByRole('heading', { name: 'Workflow' });
    expect(document.activeElement).toBe(heading);

    fireEvent.click(screen.getByRole('button', { name: 'Back to connect component' }));
    act(() => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Open how it works' }),
    );
  });

  it('announces selection changes in the polite live region', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection()));
    expect(screen.getByText(
      'Button selected. This component already has a Storybook connection.',
    )).toBeTruthy();

    receive('SELECTION_STATE', {
      status: 'empty',
      message: 'Select a component instance to continue.',
    });
    expect(screen.getByText(
      'Button selected. This component already has a Storybook connection.',
    )).toBeTruthy();
    expect(screen.getByLabelText('Component name')).toBeTruthy();
  });

  it('renders the redesigned references and opens final reference URLs', () => {
    renderPlugin();
    const inspectState: InspectCodeState = {
      status: 'connected',
      code: 'import { Button } from "tashil-ui";\n\n<Button />',
      references: {
        sourcePath: 'src/Button.tsx',
        sourceUrl: 'https://github.example/components/Button.tsx',
        storybookUrl: 'https://storybook.example/?path=/story/button',
      },
    };
    receive('INSPECT_CODE_STATE', inspectState);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open Storybook in browser' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Source URL in browser' }));
    expect(emittedPayloads('OPEN_EXTERNAL')).toEqual([
      {
        target: 'storybook',
        url: 'https://storybook.example/?path=/story/button',
      },
      {
        target: 'source',
        url: 'https://github.example/components/Button.tsx',
      },
    ]);
    expect(screen.getByText('Source URL')).toBeTruthy();
    expect(screen.getByText('Source path')).toBeTruthy();
    expect(screen.getByText('src/Button.tsx')).toBeTruthy();
  });

  it('blocks a scaffold request while a save is pending on the same selection, then allows it once the save resolves', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      sourcePath: 'src/Button.tsx',
    })));

    const sourcePath = screen.getByLabelText('Source path') as HTMLInputElement;
    fireEvent.input(sourcePath, { target: { value: 'src/Button.next.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const saveRequest = saveRequests[saveRequests.length - 1]!;
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Generate from component' }));
    expect(emittedPayloads('SCAFFOLD_PROP_MAPPINGS').length).toBe(0);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();

    receive('SAVE_RESULT', {
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: saveRequest.operationId,
      selectionToken: saveRequest.selectionToken,
    });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled)
      .toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Generate from component' }));
    expect(emittedPayloads('SCAFFOLD_PROP_MAPPINGS').length).toBe(1);
    expect(screen.getByText('Generating prop mappings…')).toBeTruthy();
  });

  it('consumes a save result for a selection that is no longer active without affecting the active form', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      sourcePath: 'src/Button.tsx',
    }), undefined, 'selection-a'));

    const sourcePath = screen.getByLabelText('Source path') as HTMLInputElement;
    fireEvent.input(sourcePath, { target: { value: 'src/Button.next.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const saveRequest = saveRequests[saveRequests.length - 1]!;

    receive('SELECTION_STATE', readySelection(existingConnection({
      importPath: 'tashil-other',
      sourcePath: 'src/Other.tsx',
    }), undefined, 'selection-b'));
    expect((screen.getByLabelText('Source path') as HTMLInputElement).value)
      .toBe('src/Other.tsx');
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();

    receive('SAVE_RESULT', {
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: saveRequest.operationId,
      selectionToken: 'selection-a',
    });
    expect((screen.getByLabelText('Source path') as HTMLInputElement).value)
      .toBe('src/Other.tsx');
    expect(screen.queryByText('Connection saved.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
  });

  it('keeps a save pending when a save result arrives with a mismatched selection token', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      sourcePath: 'src/Button.tsx',
    }), undefined, 'selection-a'));

    const sourcePath = screen.getByLabelText('Source path') as HTMLInputElement;
    fireEvent.input(sourcePath, { target: { value: 'src/Button.next.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const saveRequest = saveRequests[saveRequests.length - 1]!;
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect(screen.getByText('Saving connection…')).toBeTruthy();

    receive('SAVE_RESULT', {
      message: 'Saved for a different selection.',
      ok: true,
      operation: 'save',
      operationId: saveRequest.operationId,
      selectionToken: 'selection-b',
    });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect(screen.queryByText('Saved for a different selection.')).toBeNull();
  });

  it('keeps a save pending when a save result reports a different operation type', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection({
      sourcePath: 'src/Button.tsx',
    })));

    const sourcePath = screen.getByLabelText('Source path') as HTMLInputElement;
    fireEvent.input(sourcePath, { target: { value: 'src/Button.next.tsx' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saveRequests = emittedPayloads<{
      operationId: string;
      selectionToken: string;
    }>('SAVE_CONNECTION');
    const saveRequest = saveRequests[saveRequests.length - 1]!;

    receive('SAVE_RESULT', {
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      operationId: saveRequest.operationId,
      selectionToken: saveRequest.selectionToken,
    });
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeTruthy();
    expect(screen.queryByText('Connection cleared.')).toBeNull();
  });
});
