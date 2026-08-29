/** @vitest-environment jsdom */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/preact';
import { h } from 'preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plugin } from './ui';
import type {
  ExportFile,
  ExportOptions,
  TokenExportWarning,
} from './sync-tokens/types';
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

function previewFile(
  name: string,
  css: string,
  options: {
    declarations?: number;
    sourceVariables?: number;
    warnings?: readonly TokenExportWarning[];
  } = {},
): ExportFile {
  return {
    name,
    css,
    declarationCount: options.declarations ?? 294,
    sourceVariableCount: options.sourceVariables ?? 294,
    warnings: options.warnings ?? [],
  };
}

function receiveLatestTokenPreview(files: readonly ExportFile[]): void {
  const requests = emittedPayloads<{ operationId: string }>('PREVIEW_TOKENS');
  const request = requests[requests.length - 1];
  if (!request) {
    throw new Error('Expected a PREVIEW_TOKENS request.');
  }
  receive('PREVIEW_TOKENS_RESULT', {
    ok: true,
    operationId: request.operationId,
    files,
  });
}

function renderPlugin(): void {
  render(h(Plugin, {}));
}

beforeEach(() => {
  messageBus.emit.mockClear();
  messageBus.on.mockClear();
  messageBus.handlers.clear();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:sync-tokens-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
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
    const scanRequest = emittedPayloads<{ includeCoverage?: boolean; scanId: string }>('SCAN_COMPONENTS')[0];
    expect(scanRequest.includeCoverage).toBe(false);

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
    expect(screen.queryByText('0 instances')).toBeNull();

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

    expect((screen.getByLabelText('Source component name') as HTMLInputElement).value)
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
    expect((screen.getByLabelText('Source component name') as HTMLInputElement).value)
      .toBe('Button');

    fireEvent.click(screen.getByRole('button', { name: 'Back to components' }));
    await waitFor(() => {
      expect(document.activeElement?.id).toBe('tashil-component-button');
    });
    expect((screen.getByLabelText('Search components') as HTMLInputElement).value)
      .toBe('components');

    fireEvent.click(screen.getByRole('button', { name: 'Scan coverage' }));
    expect(emittedPayloads<{ includeCoverage?: boolean }>('SCAN_COMPONENTS')[1])
      .toEqual(expect.objectContaining({ includeCoverage: true }));
  });

  it('renders through the real Preact component library and moves tab focus with arrows/Home/End', () => {
    renderPlugin();

    const connectTab = screen.getByRole('tab', { name: 'Components' });
    const inspectTab = screen.getByRole('tab', { name: 'Inspect Code' });
    const settingsTab = screen.getByRole('tab', { name: 'Settings' });
    connectTab.focus();

    fireEvent.keyDown(connectTab, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(inspectTab);
    expect(inspectTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(inspectTab, { key: 'Home' });
    expect(document.activeElement).toBe(connectTab);
    expect(connectTab.getAttribute('aria-selected')).toBe('true');

    fireEvent.keyDown(connectTab, { key: 'End' });
    expect(document.activeElement).toBe(settingsTab);

    // ArrowLeft from the Inspect Code tab returns focus to Components.
    fireEvent.click(inspectTab);
    fireEvent.keyDown(inspectTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(connectTab);
  });

  it('presents documentation sources as native Figma rows with per-scope search', () => {
    renderPlugin();
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));

    receive('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: true,
      collections: [
        {
          defaultModeId: 'light',
          id: 'colors',
          modes: [
            { modeId: 'light', name: 'Light' },
            { modeId: 'dark', name: 'Dark' },
          ],
          name: 'Colors',
          tokenCount: 92,
        },
        {
          defaultModeId: 'default',
          id: 'spacing',
          modes: [{ modeId: 'default', name: 'Default' }],
          name: 'Spacing',
          tokenCount: 28,
        },
      ],
    });
    receive('DOC_FRAME_SELECTED', {
      drift: {
        changes: [
          { kind: 'token-added', message: 'Added Surface/Brand', targetName: 'Colors' },
          { kind: 'token-value-changed', message: 'Changed Text/Primary', targetName: 'Colors' },
        ],
        hasDrift: true,
        targetId: 'colors',
        targetName: 'Colors',
      },
      frameNodeId: 'doc-frame-1',
      metadata: {
        contentHash: 'old-hash',
        docType: 'tokens',
        generatedAt: '2026-08-28T00:00:00.000Z',
        modeIds: ['light', 'dark'],
        schemaVersion: 1,
        targetId: 'colors',
        targetName: 'Colors',
      },
    });

    expect(screen.getByRole('heading', { name: 'Documentation library' })).toBeTruthy();
    const tokenSearch = screen.getByRole('textbox', { name: 'Search token collections' });
    const tokenScope = screen.getByRole('radio', { name: 'Design tokens' });
    const componentScope = screen.getByRole('radio', { name: 'Components' });
    expect(tokenScope.compareDocumentPosition(tokenSearch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const docsHeader = document.querySelector('.docs-library-header');
    const docsToolbar = document.querySelector('.docs-library-toolbar');
    expect(docsHeader).toBeTruthy();
    expect(docsToolbar).toBeTruthy();
    expect(within(docsHeader as HTMLElement).getByRole('button', { name: 'Refresh' })).toBeTruthy();
    expect(within(docsHeader as HTMLElement).queryByRole('button', { name: 'Refresh collections' })).toBeNull();
    expect(within(docsToolbar as HTMLElement).queryByRole('button', { name: 'Refresh' })).toBeNull();
    const sourceList = screen.getByRole('radiogroup', { name: 'Documentation sources' });
    expect(within(sourceList).getAllByRole('radio')).toHaveLength(2);
    expect((within(sourceList).getByRole('radio', { name: /Colors/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(sourceList).getByText('92 tokens · 2 modes')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Documentation sources' })).toBeNull();
    expect(screen.getByText('Selected document “Colors” has 2 source changes.')).toBeTruthy();
    expect(screen.queryByText('Design tokens · 2')).toBeNull();
    expect(screen.queryByText('92 tokens across 2 modes')).toBeNull();
    const docsFooter = document.querySelector('.docs-library-view > .sync-tokens-footer');
    expect(docsFooter).toBeTruthy();
    expect(within(docsFooter as HTMLElement).queryByRole('button', { name: 'Export Markdown' })).toBeNull();
    expect(within(docsFooter as HTMLElement).getByRole('button', { name: 'Generate Document' })).toBeTruthy();

    fireEvent.input(tokenSearch, { target: { value: 'col' } });
    const scanRequestCount = emittedPayloads('SCAN_COMPONENTS').length;
    const activeScan = emittedPayloads<{ scanId: string }>('SCAN_COMPONENTS')[scanRequestCount - 1];
    receive('COMPONENT_INVENTORY_STATE', {
      scanId: activeScan.scanId,
      state: {
        items: [
          {
            componentName: 'Zebra',
            nodeType: 'COMPONENT',
            pageName: 'Components',
            status: 'not-connected',
            targetToken: 'zebra',
          },
          {
            componentName: '.BaseButton',
            nodeType: 'COMPONENT',
            pageName: 'Components',
            status: 'connected',
            targetToken: 'base-button',
          },
          {
            componentName: 'Button',
            nodeType: 'COMPONENT_SET',
            pageName: 'Components',
            status: 'connected',
            targetToken: 'button',
          },
          {
            componentName: 'Alert',
            nodeType: 'COMPONENT',
            pageName: 'Components',
            status: 'not-connected',
            targetToken: 'alert',
          },
        ],
        scannedPages: 1,
        status: 'ready',
        totalPages: 1,
      },
    });
    fireEvent.click(componentScope);
    const componentSearch = screen.getByRole('textbox', { name: 'Search components' }) as HTMLInputElement;
    expect(componentSearch.value).toBe('');
    const componentSourceList = screen.getByRole('radiogroup', { name: 'Documentation sources' });
    expect(within(componentSourceList).getAllByText('Components')).toHaveLength(3);
    expect(within(componentSourceList).queryByText(/0 instances/)).toBeNull();
    expect(within(componentSourceList).queryByText('.BaseButton')).toBeNull();
    const visibleComponentRows = within(componentSourceList).getAllByRole('radio');
    expect(visibleComponentRows.map((radio) => radio.closest('label')?.textContent))
      .toEqual(['AlertComponents', 'ButtonComponents', 'ZebraComponents']);
    const hiddenComponentFilter = screen.getByRole('checkbox', { name: 'Show hidden components' });
    expect((hiddenComponentFilter as HTMLInputElement).checked).toBe(false);
    fireEvent.click(hiddenComponentFilter);
    expect(within(componentSourceList).getByText('.BaseButton')).toBeTruthy();
    fireEvent.click(within(componentSourceList).getByRole('radio', { name: /^\.BaseButton/ }));
    fireEvent.click(hiddenComponentFilter);
    expect(within(componentSourceList).queryByText('.BaseButton')).toBeNull();
    expect((within(componentSourceList).getByRole('radio', { name: /^Button/ }) as HTMLInputElement).checked)
      .toBe(true);
    const componentRefresh = within(docsHeader as HTMLElement).getByRole('button', { name: 'Refresh' });
    fireEvent.click(componentRefresh);
    const scanRequests = emittedPayloads<{ includeCoverage?: boolean }>('SCAN_COMPONENTS');
    expect(scanRequests).toHaveLength(scanRequestCount + 1);
    expect(scanRequests[scanRequests.length - 1]?.includeCoverage).toBe(false);
    fireEvent.input(componentSearch, { target: { value: 'button' } });
    fireEvent.click(tokenScope);
    expect((screen.getByRole('textbox', { name: 'Search token collections' }) as HTMLInputElement).value).toBe('col');
  });

  it('loads and renders a lightweight preview only for the selected token collection', () => {
    renderPlugin();
    fireEvent.click(screen.getByRole('tab', { name: 'Docs' }));

    receive('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: true,
      collections: [
        {
          defaultModeId: 'light',
          id: 'colors',
          modes: [
            { modeId: 'light', name: 'Light' },
            { modeId: 'dark', name: 'Dark' },
          ],
          name: 'Colors',
          tokenCount: 92,
        },
        {
          defaultModeId: 'default',
          id: 'spacing',
          modes: [{ modeId: 'default', name: 'Default' }],
          name: 'Spacing',
          tokenCount: 28,
        },
      ],
    });

    const requests = emittedPayloads<{
      requestId: string;
      scope: 'tokens' | 'components';
      targetId: string;
    }>('LOAD_DOC_SOURCE_PREVIEW');
    expect(requests).toHaveLength(1);
    expect(requests[0]).toEqual(expect.objectContaining({
      scope: 'tokens',
      targetId: 'colors',
      tokenGroupingDepth: '3',
    }));
    if (!requests[0]) return;

    receive('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
      ok: true,
      preview: {
        groupCount: 3,
        groupNames: ['Text', 'Background', 'Border'],
        groupingDepth: '3',
        modeCount: 2,
        scope: 'tokens',
        targetId: 'colors',
        tokenCount: 92,
      },
      requestId: requests[0].requestId,
    });

    const preview = screen.getByRole('region', { name: 'Documentation preview' });
    expect(within(preview).getByText('3 groups will be generated')).toBeTruthy();
    expect(within(preview).getByText('Text · Background · Border')).toBeTruthy();
    expect(within(preview).getByText('Through 3 levels · 92 tokens · 2 modes')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '2' }));
    const updatedRequests = emittedPayloads<{
      requestId: string;
      scope: 'tokens' | 'components';
      targetId: string;
      tokenGroupingDepth?: string;
    }>('LOAD_DOC_SOURCE_PREVIEW');
    expect(updatedRequests).toHaveLength(2);
    expect(updatedRequests[1]).toEqual(expect.objectContaining({
      targetId: 'colors',
      tokenGroupingDepth: '2',
    }));

    const docsFooter = document.querySelector('.docs-library-view > .sync-tokens-footer') as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: 'Generate Document' }));
    expect(emittedPayloads('GENERATE_TOKEN_DOCS')).toContainEqual({
      collectionId: 'colors',
      targetFormat: 'canvas',
      tokenGroupingDepth: '2',
    });
    receive('DOC_GENERATION_PROGRESS', {
      message: 'Building section 2 of 4…',
      percent: 50,
    });
    const progress = screen.getByRole('progressbar', { name: 'Documentation generation progress' });
    expect(docsFooter.contains(progress)).toBe(true);
    expect(within(docsFooter).getByText('Building section 2 of 4…')).toBeTruthy();
    expect(document.querySelector('.docs-library-scroll .docs-library-footer-progress')).toBeNull();
    fireEvent.click(within(docsFooter).getByRole('button', { name: 'Cancel' }));
    expect(emittedPayloads('CANCEL_DOC_GENERATION')).toHaveLength(1);
  });

  it('loads and saves per-user output settings', () => {
    renderPlugin();
    expect(emittedPayloads('LOAD_OUTPUT_PREFERENCES')).toHaveLength(1);
    fireEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    expect(screen.getByRole('heading', { name: 'Output settings' })).toBeTruthy();
    fireEvent.click(screen.getByText('Single'));
    expect(emittedPayloads<{ preferences: { quoteStyle: string } }>('SAVE_OUTPUT_PREFERENCES')[0])
      .toEqual(expect.objectContaining({ preferences: expect.objectContaining({ quoteStyle: 'single' }) }));
  });

  it('builds token outputs with live settings previews and accurate export payloads', async () => {
    renderPlugin();
    fireEvent.click(screen.getByRole('tab', { name: 'Sync Tokens' }));

    expect(emittedPayloads('LOAD_TOKEN_COLLECTIONS')).toHaveLength(1);
    receive('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: true,
      collections: [
        {
          id: 'references',
          name: 'References Color',
          modes: [
            { modeId: 'light', name: 'Light' },
            { modeId: 'dark', name: 'Dark' },
          ],
          defaultModeId: 'light',
          tokenCount: 362,
        },
        {
          id: 'product',
          name: 'Product Tokens',
          modes: [
            { modeId: 'zhina', name: 'Zhina' },
            { modeId: 'tashilpay', name: 'Tashilpay' },
            { modeId: 'zamyad', name: 'Zamyad' },
          ],
          defaultModeId: 'zhina',
          tokenCount: 294,
        },
      ],
    });

    expect(screen.getByRole('heading', { name: 'Sync tokens' })).toBeTruthy();
    expect(screen.getByLabelText('Root font size in pixels')).toBeTruthy();
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('Select a collection to preview its generated token output.');

    const collectionSearch = screen.getByRole('textbox', { name: 'Search collections' });
    fireEvent.input(collectionSearch, { target: { value: 'Product' } });
    expect(screen.getByRole('button', { name: 'Select 1 result' })).toBeTruthy();
    fireEvent.input(collectionSearch, { target: { value: 'Missing' } });
    expect((screen.getByRole('button', {
      name: 'Select 0 results',
    }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.input(collectionSearch, { target: { value: '' } });

    fireEvent.click(screen.getByRole('checkbox', { name: /Product Tokens/ }));
    expect(screen.getByText('product-tokens-zhina.css')).toBeTruthy();
    expect(screen.getByRole('button', {
      name: 'Copy product-tokens-zhina.css',
    })).toBeTruthy();
    expect(screen.queryByRole('button', {
      name: 'Copy product-tokens-zamyad.css',
    })).toBeNull();
    receiveLatestTokenPreview([
      previewFile(
        'product-tokens-zhina.css',
        ':root {\n  --color-text-primary: #0d99ff;\n}',
        {
          declarations: 293,
          warnings: [{
            code: 'unresolved-alias',
            message: 'The referenced variable could not be resolved.',
            tokenName: 'Color/Text/Muted',
          }],
        },
      ),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--color-text-primary: #0d99ff;');
    expect(screen.getAllByText(/294 variables → 293 declarations/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Color\/Text\/Muted: The referenced variable/)).toBeTruthy();

    receiveLatestTokenPreview([
      previewFile(
        'product-tokens-zhina.css',
        ':root {\n  --color-text-primary: #0d99ff;\n}',
        {
          warnings: [{
            code: 'mode-fallback',
            message: 'No “Zhina” mode exists in References Color; using Light.',
            tokenName: 'Color/Text/Primary',
            sourceCollectionId: 'product',
            sourceModeId: 'zhina',
            targetCollectionId: 'references',
            fallbackModeId: 'light',
          }],
        },
      ),
    ]);
    const aliasModeDropdown = screen.getByLabelText('Alias mode for References Color');
    expect(aliasModeDropdown.textContent).toContain('Light');
    fireEvent.keyDown(aliasModeDropdown, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    const overrideRequests = emittedPayloads<{
      options: ExportOptions;
    }>('PREVIEW_TOKENS');
    const overrideRequest = overrideRequests[overrideRequests.length - 1];
    expect(
      overrideRequest?.options.aliasModeOverridesByCollectionMode
        ?.product?.zhina?.references,
    ).toBe('dark');
    receiveLatestTokenPreview([
      previewFile(
        'product-tokens-zhina.css',
        ':root {\n  --color-text-primary: #033366;\n}',
      ),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--color-text-primary: #033366;');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Tashilpay' }));
    expect(screen.getAllByText('product-tokens-zhina.css').length).toBeGreaterThan(0);
    expect(screen.getAllByText('product-tokens-tashilpay.css').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', {
      name: 'Copy product-tokens-tashilpay.css',
    })).toBeTruthy();
    receiveLatestTokenPreview([
      previewFile('product-tokens-zhina.css', ':root {\n  --color-text-primary: #0d99ff;\n}'),
      previewFile('product-tokens-tashilpay.css', ':root {\n  --color-text-primary: #033366;\n}'),
    ]);
    expect(screen.getByText('2 files · 294 variables → 588 declarations')).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: 'a/a' }));
    receiveLatestTokenPreview([
      previewFile('product-tokens-zhina.css', ':root {\n  --color\\/text\\/primary: #0d99ff;\n}'),
      previewFile('product-tokens-tashilpay.css', ':root {\n  --color\\/text\\/primary: #033366;\n}'),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--color\\/text\\/primary: #0d99ff;');

    fireEvent.click(screen.getByRole('radio', { name: 'a.a' }));
    receiveLatestTokenPreview([
      previewFile('product-tokens-zhina.css', ':root {\n  --color\\.text\\.primary: #0d99ff;\n  --spacing\\.4: 1rem;\n}'),
      previewFile('product-tokens-tashilpay.css', ':root {\n  --color\\.text\\.primary: #033366;\n}'),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--color\\.text\\.primary: #0d99ff;');

    fireEvent.click(screen.getByRole('radio', { name: 'a_a' }));
    receiveLatestTokenPreview([
      previewFile('product-tokens-zhina.css', ':root {\n  --color_text_primary: #0d99ff;\n  --spacing_4: 1rem;\n}'),
      previewFile('product-tokens-tashilpay.css', ':root {\n  --color_text_primary: #033366;\n}'),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--color_text_primary: #0d99ff;');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Convert px to rem' }));
    expect(screen.queryByLabelText('Root font size in pixels')).toBeNull();
    receiveLatestTokenPreview([
      previewFile('product-tokens-zhina.css', ':root {\n  --color_text_primary: #0d99ff;\n  --spacing_4: 16;\n}'),
      previewFile('product-tokens-tashilpay.css', ':root {\n  --color_text_primary: #033366;\n}'),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--spacing_4: 16;');

    fireEvent.click(screen.getByRole('button', { name: 'Export 2 files' }));
    const request = emittedPayloads<{
      operationId: string;
      collectionIds: readonly string[];
      options: {
        modesByCollection: Record<string, readonly string[]>;
        aliasModeOverridesByCollectionMode?: ExportOptions[
          'aliasModeOverridesByCollectionMode'
        ];
        convertPxToRem: boolean;
        nameStyle: string;
        outputFormat?: string;
      };
    }>('EXPORT_TOKENS')[0];
    expect(request.collectionIds).toEqual(['product']);
    expect(request.options.modesByCollection.product).toEqual(['zhina', 'tashilpay']);
    expect(request.options.convertPxToRem).toBe(false);
    expect(request.options.nameStyle).toBe('lower-underscore');
    expect(request.options.outputFormat).toBe('css');
    expect(
      request.options.aliasModeOverridesByCollectionMode
        ?.product?.zhina?.references,
    ).toBe('dark');

    receive('EXPORT_TOKENS_RESULT', {
      ok: true,
      operationId: request.operationId,
      files: [
        previewFile('product-tokens-zhina.css', ':root {}'),
      ],
    });
    await waitFor(() => {
      expect(screen.getByText('Downloaded product-tokens-zhina.css.')).toBeTruthy();
    });

    const outputFormatDropdown = screen.getByLabelText('Output format');
    fireEvent.keyDown(outputFormatDropdown, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('radio', { name: 'Markdown — raw token list' }));
    expect(screen.getAllByText('product-tokens-zhina.md').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: 'A.A' }));
    const markdownRequests = emittedPayloads<{
      options: ExportOptions;
    }>('PREVIEW_TOKENS');
    const markdownRequest = markdownRequests[markdownRequests.length - 1];
    expect(markdownRequest?.options.outputFormat).toBe('markdown');
    expect(markdownRequest?.options.nameStyle).toBe('title-dot');
    receiveLatestTokenPreview([
      previewFile(
        'product-tokens-zhina.md',
        '# Product Tokens\n\n```text\n--Color.Text.Default: #101828;\n```\n',
      ),
    ]);
    expect(screen.getByLabelText('Token output preview').textContent)
      .toContain('--Color.Text.Default: #101828;');
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

  it('requests Code Connect download only from the explicit connected action', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection(existingConnection(), undefined, 'button-target'));
    fireEvent.click(screen.getByRole('button', { name: 'Download Code Connect' }));
    expect(emittedPayloads('GENERATE_CODE_CONNECT')).toContainEqual({
      selectionToken: 'button-target',
      targetToken: 'button-target',
    });
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
    });
    expect(screen.getByText('Button → ButtonProps')).toBeTruthy();
    // One mapping card: the Implementation mapping editor takes over once a
    // source contract exists, so the legacy card is gone.
    expect(screen.queryByText('Source & prop mappings')).toBeNull();
    // The Implementation mapping editor owns the per-prop controls; the legacy
    // visual rows are hidden so the same prop is never shown twice.
    // The board lists the code prop; its controls open when it is focused.
    expect(screen.getAllByText('variant').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Figma property for variant')).toBeNull();

    const replacement = new File([], 'Button.next.tsx', { type: 'text/typescript' });
    Object.defineProperty(replacement, 'text', {
      value: vi.fn().mockResolvedValue([
        "export type ButtonVariant = 'primary' | 'secondary';",
        'export interface ButtonProps { variant?: ButtonVariant; }',
      ].join('\n')),
    });
    const dropZone = screen.getByText('Implementation mapping').closest('section');
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
    expect(saveRequests[saveRequests.length - 1]?.metadata).toMatchObject({
      componentName: 'Button',
      figmaComponentName: 'Button',
    });
  });

  it('keeps different Figma and source component names', async () => {
    renderPlugin();
    receive('SELECTION_STATE', {
      componentName: 'Dialogbox',
      figmaSnapshot: {
        componentId: 'dialogbox-set',
        componentName: 'Dialogbox',
        properties: [],
      },
      message: 'This component is ready to connect.',
      status: 'ready',
      targetToken: 'dialogbox-set',
    });

    expect((screen.getByLabelText('Figma component name') as HTMLInputElement).value)
      .toBe('Dialogbox');
    expect((screen.getByLabelText('Source component name') as HTMLInputElement).value)
      .toBe('Dialogbox');

    const source = new File([], 'info-modal.tsx', { type: 'text/typescript' });
    Object.defineProperty(source, 'text', {
      value: vi.fn().mockResolvedValue(`
interface StyleProps { compact?: boolean }
export interface InfoModalProps { title?: string; open?: boolean }
export const TashilInfoModal: React.FC<InfoModalProps> = () => null;
`),
    });
    fireEvent.input(screen.getByLabelText('Upload source'), {
      target: { files: [source] },
    });

    await waitFor(() => {
      expect((screen.getByLabelText('Source component name') as HTMLInputElement).value)
        .toBe('TashilInfoModal');
    });
    expect((screen.getByLabelText('Figma component name') as HTMLInputElement).value)
      .toBe('Dialogbox');

    fireEvent.input(screen.getByLabelText('Import path'), {
      target: { value: '@tashilcar/swiss-army-knife' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const saves = emittedPayloads<{ metadata: ConnectionMetadata }>('SAVE_CONNECTION');
    expect(saves[saves.length - 1]?.metadata).toMatchObject({
      componentName: 'TashilInfoModal',
      figmaComponentName: 'Dialogbox',
    });
  });

  it('presents connect setup as ordered steps with references collapsed', () => {
    renderPlugin();
    receive('SELECTION_STATE', readySelection());

    // The page reads as a sequence, not a flat form.
    expect(screen.getByRole('heading', { name: 'Code component' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Props & mapping' })).toBeTruthy();

    expect(screen.getByLabelText('Figma component name')).toBeTruthy();
    expect(screen.getByLabelText('Source component name')).toBeTruthy();

    // Optional references are present but collapsed out of the primary flow.
    const references = screen.getByText('References (optional)');
    expect(references).toBeTruthy();
    expect(references.closest('details')?.hasAttribute('open')).toBe(false);
    expect(screen.getByLabelText('Storybook URL')).toBeTruthy();
  });

  it('confirms before replacing source over a saved semantic connection', async () => {
    renderPlugin();
    const savedRecipe = {
      bindings: [{
        id: 'binding-variant',
        requirement: 'optional' as const,
        source: { kind: 'component-property' as const, propertyId: 'style-id', propertyName: 'Style' },
        target: { path: ['variant'], typeName: 'string' },
      }],
      figmaSnapshot: { componentId: 'button-set', componentName: 'Button', nestedSources: [] },
      revision: 1,
      schemaVersion: 2 as const,
    };
    receive('SELECTION_STATE', {
      ...readySelection(existingConnection({ semanticRecipe: savedRecipe })),
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
      semanticSnapshot: { componentId: 'button-set', componentName: 'Button', nestedSources: [] },
    });

    const replacement = new File([], 'Button.next.tsx', { type: 'text/typescript' });
    Object.defineProperty(replacement, 'text', {
      value: vi.fn().mockResolvedValue('export interface ButtonProps { variant?: string; }'),
    });
    fireEvent.input(screen.getByLabelText('Upload source'), {
      target: { files: [replacement] },
    });

    // The upload is held behind an explicit confirmation, not applied yet.
    const prompt = await screen.findByText('Replace uploaded source?');
    expect(prompt).toBeTruthy();
    expect(screen.queryByText('Button.next.tsx')).toBeNull();

    // The alertdialog moves focus to the safe "Keep current" choice.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Keep current' }),
      );
    });

    // Cancelling keeps the current source; confirming applies it.
    fireEvent.click(screen.getByRole('button', { name: 'Keep current' }));
    expect(screen.queryByText('Replace uploaded source?')).toBeNull();
    expect(screen.queryByText('Button.next.tsx')).toBeNull();

    fireEvent.input(screen.getByLabelText('Upload source'), {
      target: { files: [replacement] },
    });
    await screen.findByText('Replace uploaded source?');
    fireEvent.click(screen.getByRole('button', { name: 'Replace source' }));
    await waitFor(() => {
      expect(screen.getByText('Button.next.tsx')).toBeTruthy();
    });
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
    expect(saving.parentElement?.querySelector('svg')).not.toBeNull();
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
    expect(screen.getByLabelText('Source component name')).toBeTruthy();
  });

  it('renders the redesigned references and opens final reference URLs', () => {
    renderPlugin();
    const inspectState: InspectCodeState = {
      status: 'connected',
      output: {
        code: 'import { Button } from "tashil-ui";\n\n<Button />',
        references: {
          sourcePath: 'src/Button.tsx',
          sourceUrl: 'https://github.example/components/Button.tsx',
          storybookUrl: 'https://storybook.example/?path=/story/button',
        },
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

  it('shows a deprecation notice in Inspect without hiding the code', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'connected',
      output: {
        code: 'import { ConfirmationDialog } from "@tashilcar/ui";\n\n<ConfirmationDialog />',
        deprecation: 'ConfirmationDialog is deprecated. Use AlertDialog instead.',
      },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    expect(screen.getByText('⚠️ Deprecated')).toBeTruthy();
    expect(screen.getByText('ConfirmationDialog is deprecated. Use AlertDialog instead.')).toBeTruthy();
    // Code is still shown.
    expect(document.body.textContent).toContain('<ConfirmationDialog');
  });

  it('renders semantic runtime requirements and explanation as separate blocks', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'connected',
      output: {
        code: 'import { ConfirmationDialog } from "@tashilcar/ui";\n\n<ConfirmationDialog />',
        explanation: 'title — From nested text "Header / Title".',
        runtimeRequirements: 'onConfirm: () => void',
      },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    expect(screen.getByText('Set in application')).toBeTruthy();
    expect(screen.getByText('Why this structure?')).toBeTruthy();
    expect(document.body.textContent).toContain('onConfirm: () => void');
    expect(document.body.textContent).toContain('title — From nested text "Header / Title".');
    expect(screen.queryByText('Mapping diagnostics')).toBeNull();
  });

  it('highlights JSX nested inside prop expressions as structured TSX', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'connected',
      output: {
        code: [
          '<Button',
          '  color={"primary"}',
          '  renderLeftIcon={<Icon name="chevron-left" />}',
          '/>',
        ].join('\n'),
      },
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    const nestedTag = screen.getByText('<Icon');
    const nestedString = screen.getByText('"chevron-left"');
    const scalarExpression = screen.getByText('"primary"');
    const nestedLine = nestedTag.parentElement;

    expect(nestedTag.classList.contains('syntax-tag')).toBe(true);
    expect(nestedString.classList.contains('syntax-string')).toBe(true);
    expect(scalarExpression.classList.contains('syntax-expression')).toBe(true);
    expect(
      Array.from(nestedLine?.querySelectorAll('.syntax-expression') || [])
        .map((token) => token.textContent),
    ).toEqual(['{', '}']);
  });

  it('renders a full generated styled-components React layout', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'layout',
      showUnconnectedComponents: true,
      layout: {
        componentCount: 1,
        componentName: 'PaymentForm',
        diagnostics: [
          {
            severity: 'info',
            reason: 'unconnected-instance',
            message: 'The button is not connected.',
            layerPath: ['Payment form', 'Submit button'],
          },
          {
            severity: 'warning',
            reason: 'unsupported-paint',
            message: 'A visual layer needs review.',
          },
        ],
        fidelity: {
          unresolvedComponents: 0,
          unsupportedAssets: 1,
          omittedDeclarations: 0,
        },
        nodeName: 'Payment form',
        nodeType: 'FRAME',
        runtimeRequirements: ['onSubmit: () => void'],
        wrapperCount: 2,
        tsx: [
          'import styled from "styled-components";',
          'import { Button } from "@tashilcar/swiss-army-knife";',
          '',
          'const PaymentFormRoot = styled.div`',
          '  display: flex;',
          '`;',
          '',
          'export function PaymentForm() {',
          '  return <PaymentFormRoot><Button /></PaymentFormRoot>;',
          '}',
        ].join('\n'),
      },
    } as InspectCodeState);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    expect(screen.getByText('React frame structure')).toBeTruthy();
    expect(screen.getByText('Not connected')).toBeTruthy();
    expect(screen.getByText('Submit button')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Payment form', level: 2 })).toBeTruthy();
    expect(screen.getByText('PaymentForm.tsx')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy generated React/ })).toBeTruthy();
    expect(document.body.textContent).toContain('export function PaymentForm');
    expect(document.body.textContent).toContain('display: flex;');
    expect(screen.getByText('Set in application')).toBeTruthy();
    expect(document.body.textContent).toContain('onSubmit: () => void');
    expect(screen.getByText('Generation notes')).toBeTruthy();
    expect(document.body.textContent).toContain('A visual layer needs review.');
    expect(document.body.textContent).toContain('Unsupported assets1');
    expect(document.body.textContent).not.toContain('.module.css');
  });

  it('renders the inspection view with Layout, Style, and connected components', () => {
    renderPlugin();
    const inspectionState: InspectCodeState = {
      status: 'inspection',
      inspection: {
        nodeName: 'Payment form',
        nodeType: 'FRAME',
        css: {
          layout: [
            { property: 'display', value: 'flex' },
            { property: 'gap', value: 'var(--spacer-3, 1rem)' },
          ],
          style: [
            { property: 'border-bottom', value: '1px solid var(--color-border)' },
          ],
        },
        connectedComponents: [
          {
            nodeId: 'i-button',
            layerPath: ['Payment form', 'Button / Submit'],
            componentName: 'Button',
            usage: {
              imports: [
                { importedName: 'Button', localName: 'Button', modulePath: '@tashilcar/ui' },
              ],
              jsx: '<Button variant={"primary"} />',
              diagnostics: [],
            },
          },
        ],
        diagnostics: [],
      },
    };
    receive('INSPECT_CODE_STATE', inspectionState);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    // Header card: node name, type, component count.
    expect(screen.getByText('Inspecting')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Payment form', level: 2 })).toBeTruthy();
    expect(screen.getByText('FRAME')).toBeTruthy();

    // Layout and Style sections render the partitioned CSS with copy actions.
    expect(screen.getByText('Layout')).toBeTruthy();
    expect(screen.getByText('Style')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy Layout CSS/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Copy Style CSS/ })).toBeTruthy();
    const content = document.querySelector('.inspect-content')!;
    expect(content.textContent).toContain('display: flex;');
    expect(content.textContent).toContain('gap: var(--spacer-3, 1rem);');
    expect(content.textContent).toContain('border-bottom: 1px solid var(--color-border);');

    // Connected component entry: layer path and byte-identical snippet.
    expect(screen.getByRole('heading', { name: 'Connected components', level: 3 })).toBeTruthy();
    expect(screen.getByText('Payment form / Button / Submit')).toBeTruthy();
    expect(content.textContent).toContain('import { Button } from "@tashilcar/ui";');
    expect(content.textContent).toContain('<Button');
    expect(screen.getByRole('button', { name: /Copy Button/ })).toBeTruthy();
  });

  it('renders structured diagnostics with severity in the inspection view', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'inspection',
      inspection: {
        nodeName: 'Card',
        nodeType: 'FRAME',
        css: { layout: [{ property: 'display', value: 'flex' }], style: [] },
        connectedComponents: [],
        diagnostics: [
          { severity: 'info', reason: 'unconnected-instance', message: '"Chip" is not connected to a production component.' },
          { severity: 'warning', reason: 'missing-main-component', message: '"Badge" has no main component.' },
        ],
      },
    } as InspectCodeState);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    expect(screen.getByText('"Chip" is not connected to a production component.')).toBeTruthy();
    expect(screen.getByText('"Badge" has no main component.')).toBeTruthy();
    // The Notes section renders; a Style section with no declarations does not.
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.queryByText('Style')).toBeNull();
  });

  it('omits CSS sections and shows the css-unavailable note when Figma returns no CSS', () => {
    renderPlugin();
    receive('INSPECT_CODE_STATE', {
      status: 'inspection',
      inspection: {
        nodeName: 'Old runtime',
        nodeType: 'GROUP',
        css: { layout: [], style: [] },
        connectedComponents: [],
        diagnostics: [
          { severity: 'warning', reason: 'css-unavailable', message: 'CSS inspection is not available for this node in the current Figma runtime.' },
        ],
      },
    } as InspectCodeState);
    fireEvent.click(screen.getByRole('tab', { name: 'Inspect Code' }));

    expect(screen.queryByText('Layout')).toBeNull();
    expect(screen.queryByText('Style')).toBeNull();
    expect(screen.getByText(/CSS inspection is not available/)).toBeTruthy();
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
