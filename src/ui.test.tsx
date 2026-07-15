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
  type UiSelectionState,
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
  selectionToken = 'selection-a',
): UiSelectionState {
  return {
    status: 'ready',
    selectionToken,
    componentName: 'Button',
    existingConnection: connection,
    message,
  };
}

function receive(name: string, payload: unknown): void {
  const handlers = messageBus.handlers.get(name);
  if (!handlers || handlers.size === 0) {
    throw new Error(`No UI handler registered for ${name}.`);
  }

  act(() => {
    for (const handler of handlers) {
      handler(payload);
    }
  });
}

function emittedPayloads<T>(name: string): T[] {
  return messageBus.emit.mock.calls
    .filter(([eventName]) => eventName === name)
    .map(([, payload]) => payload as T);
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
  it('renders through the real Preact component library and moves tab focus with arrows/Home/End', () => {
    renderPlugin();

    const connectTab = screen.getByRole('tab', { name: 'Connect Component' });
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
    expect(screen.getByRole('status').textContent).toBe(
      'Select a component instance to continue.',
    );
  });

  it('opens final reference URLs and copies the source path', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
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
    fireEvent.click(screen.getByRole('button', { name: 'Open Source in browser' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Copy source path' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('src/Button.tsx');
    });
    expect(screen.getByText('source path copied to clipboard.')).toBeTruthy();
  });
});
