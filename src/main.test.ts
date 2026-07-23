import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type CodegenBlock,
  type ComponentInventoryState,
  type ConnectionMetadata,
  type InspectCodeState,
  type MappingDocument,
  type ScaffoldResultHandler,
  type UiTargetState,
} from './types';

type MessageHandler = (payload: unknown) => void;

const utilityMocks = vi.hoisted(() => {
  const handlers = new Map<string, MessageHandler>();

  return {
    emit: vi.fn(),
    handlers,
    on: vi.fn((name: string, handler: MessageHandler) => {
      handlers.set(name, (payload) => {
        if (
          typeof payload === 'object'
          && payload !== null
          && 'selectionToken' in payload
          && !('targetToken' in payload)
        ) {
          handler({
            ...payload,
            targetToken: payload.selectionToken,
          });
          return;
        }
        handler(payload);
      });
      return () => handlers.delete(name);
    }),
    showUI: vi.fn(),
  };
});

vi.mock('@create-figma-plugin/utilities', () => ({
  emit: utilityMocks.emit,
  on: utilityMocks.on,
  showUI: utilityMocks.showUI,
}));

type ComponentDouble = ComponentNode & {
  getSharedPluginData: ReturnType<typeof vi.fn>;
  setSharedPluginData: ReturnType<typeof vi.fn>;
};

type InstanceDouble = InstanceNode & {
  getMainComponentAsync: ReturnType<typeof vi.fn>;
};

type PageDouble = PageNode & {
  findAllWithCriteria: ReturnType<typeof vi.fn>;
  loadAsync: ReturnType<typeof vi.fn>;
};

type ComponentOptions = {
  componentProperties?: InstanceNode['componentProperties'];
  propertyDefinitions?: ComponentNode['componentPropertyDefinitions'];
  sharedPluginData?: string;
};

type CodegenGenerateHandler = (event: { node: SceneNode }) => Promise<CodegenBlock[]>;

function createComponent(
  id: string,
  name: string,
  options: ComponentOptions = {},
): ComponentDouble {
  return {
    componentProperties: options.componentProperties ?? {},
    componentPropertyDefinitions: options.propertyDefinitions ?? {},
    getSharedPluginData: vi.fn(() => options.sharedPluginData ?? ''),
    id,
    name,
    parent: { type: 'PAGE' },
    setSharedPluginData: vi.fn(),
    type: 'COMPONENT',
    variantProperties: null,
  } as unknown as ComponentDouble;
}

function createInstance(
  id: string,
  mainComponent: Promise<ComponentNode | null>,
  componentProperties: InstanceNode['componentProperties'] = {},
): InstanceDouble {
  return {
    componentProperties,
    getMainComponentAsync: vi.fn(() => mainComponent),
    id,
    name: id,
    parent: { type: 'PAGE' },
    type: 'INSTANCE',
  } as unknown as InstanceDouble;
}

function createPage(
  id: string,
  name: string,
  nodes: ReadonlyArray<ComponentNode | ComponentSetNode>,
  loadAsync: () => Promise<void> = () => Promise.resolve(),
): PageDouble {
  return {
    findAllWithCriteria: vi.fn(() => [...nodes]),
    id,
    loadAsync: vi.fn(loadAsync),
    name,
    type: 'PAGE',
  } as unknown as PageDouble;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
} {
  let rejectPromise!: (reason?: unknown) => void;
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });

  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function emittedPayloads<T>(name: string): T[] {
  if (name === 'SELECTION_STATE') {
    return utilityMocks.emit.mock.calls
      .filter(([eventName]) => eventName === 'CANVAS_TARGET_STATE')
      .map(([, payload]) => (
        payload as { state: UiTargetState }
      ).state as T);
  }

  return utilityMocks.emit.mock.calls
    .filter(([eventName]) => eventName === name)
    .map(([, payload]) => payload as T);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function startPlugin(): Promise<{
  codegenEvents: Map<string, CodegenGenerateHandler>;
  figmaEvents: Map<string, () => void>;
  notify: ReturnType<typeof vi.fn>;
  nodesById: Map<string, BaseNode>;
  openExternal: ReturnType<typeof vi.fn>;
  pages: PageNode[];
  selection: SceneNode[];
}> {
  const codegenEvents = new Map<string, CodegenGenerateHandler>();
  const figmaEvents = new Map<string, () => void>();
  const notify = vi.fn();
  const nodesById = new Map<string, BaseNode>();
  const openExternal = vi.fn();
  const pages: PageNode[] = [];
  const selection: SceneNode[] = [];
  const pushSelection = selection.push.bind(selection);
  const spliceSelection = selection.splice.bind(selection);
  selection.push = (...nodes: SceneNode[]): number => {
    for (const node of nodes) {
      nodesById.set(node.id, node);
    }
    return pushSelection(...nodes);
  };
  selection.splice = (
    start: number,
    deleteCount?: number,
    ...nodes: SceneNode[]
  ): SceneNode[] => {
    for (const node of nodes) {
      nodesById.set(node.id, node);
    }
    return spliceSelection(start, deleteCount ?? selection.length - start, ...nodes);
  };

  vi.stubGlobal('figma', {
    closePlugin: vi.fn(),
    codegen: {
      on: vi.fn((name: string, handler: CodegenGenerateHandler) => {
        codegenEvents.set(name, handler);
      }),
    },
    currentPage: { selection },
    getNodeByIdAsync: vi.fn((id: string) => Promise.resolve(nodesById.get(id) ?? null)),
    mode: 'default',
    notify,
    openExternal,
    on: vi.fn((name: string, handler: () => void) => {
      figmaEvents.set(name, handler);
    }),
    root: { children: pages },
    ui: { resize: vi.fn() },
  });

  const plugin = await import('./main');
  plugin.default();

  return {
    codegenEvents,
    figmaEvents,
    nodesById,
    notify,
    openExternal,
    pages,
    selection,
  };
}

beforeEach(() => {
  vi.resetModules();
  utilityMocks.emit.mockClear();
  utilityMocks.handlers.clear();
  utilityMocks.on.mockClear();
  utilityMocks.showUI.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('selection synchronization', () => {
  it('publishes stable Figma property descriptors with the ready selection', async () => {
    const propertyDefinitions = {
      'Style#style-id': {
        defaultValue: 'Solid',
        type: 'VARIANT',
        variantOptions: ['Solid', 'Outline'],
      },
      'Disabled#disabled-id': {
        defaultValue: false,
        type: 'BOOLEAN',
      },
    } as ComponentNode['componentPropertyDefinitions'];
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', { propertyDefinitions });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toContainEqual(
        expect.objectContaining({
          figmaSnapshot: {
            componentId: 'component-a',
            componentName: 'Button',
            properties: [
              {
                defaultValue: 'Solid',
                id: 'style-id',
                name: 'Style',
                options: ['Solid', 'Outline'],
                rawKey: 'Style#style-id',
                type: 'VARIANT',
              },
              {
                defaultValue: false,
                id: 'disabled-id',
                name: 'Disabled',
                options: ['False', 'True'],
                rawKey: 'Disabled#disabled-id',
                type: 'BOOLEAN',
              },
            ],
          },
          status: 'ready',
        }),
      );
    });
  });

  it('publishes actionable unavailable states when current selection resolution rejects', async () => {
    const { selection } = await startPlugin();
    const instance = createInstance(
      'instance-a',
      Promise.reject(new Error('Main component unavailable.')),
    );
    const message = [
      'Could not refresh the current selection: Main component unavailable.',
      'Try changing the selection or reopening the plugin.',
    ].join('\n');
    selection.push(instance);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toEqual([{
        status: 'empty',
        message,
      }]);
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toEqual([{
        status: 'invalid-selection',
        message,
      }]);
    });
  });

  it('publishes actionable unavailable states when current state construction throws', async () => {
    const { figmaEvents, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    component.getSharedPluginData.mockImplementationOnce(() => {
      throw new Error('Connection data unavailable.');
    });
    const message = [
      'Could not refresh the current selection: Connection data unavailable.',
      'Try changing the selection or reopening the plugin.',
    ].join('\n');
    selection.push(component);

    figmaEvents.get('selectionchange')?.();

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toEqual([{
        status: 'empty',
        message,
      }]);
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toEqual([{
        status: 'invalid-selection',
        message,
      }]);
    });
  });

  it('waits for the UI handshake and drops an older async refresh', async () => {
    const { figmaEvents, selection } = await startPlugin();
    expect(utilityMocks.emit).not.toHaveBeenCalled();

    const mainComponentA = createComponent('component-a', 'ButtonA');
    const mainComponentB = createComponent('component-b', 'ButtonB');
    const deferredMainComponentA = createDeferred<ComponentNode | null>();
    const instanceA = createInstance('instance-a', deferredMainComponentA.promise);
    const instanceB = createInstance('instance-b', Promise.resolve(mainComponentB));

    selection.splice(0, selection.length, instanceA);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    selection.splice(0, selection.length, instanceB);
    figmaEvents.get('selectionchange')?.();

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toEqual([
        expect.objectContaining({
          componentName: 'ButtonB',
          targetToken: 'component-b',
          status: 'ready',
        }),
      ]);
    });

    const emittedCallCount = utilityMocks.emit.mock.calls.length;
    deferredMainComponentA.resolve(mainComponentA);
    await flushPromises();

    expect(utilityMocks.emit).toHaveBeenCalledTimes(emittedCallCount);
  });

  it('drops an older rejected refresh after a newer selection succeeds', async () => {
    const { figmaEvents, selection } = await startPlugin();
    const deferredMainComponentA = createDeferred<ComponentNode | null>();
    const instanceA = createInstance('instance-a', deferredMainComponentA.promise);
    const mainComponentB = createComponent('component-b', 'ButtonB');
    const instanceB = createInstance('instance-b', Promise.resolve(mainComponentB));

    selection.splice(0, selection.length, instanceA);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    selection.splice(0, selection.length, instanceB);
    figmaEvents.get('selectionchange')?.();

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toEqual([
        expect.objectContaining({
          componentName: 'ButtonB',
          targetToken: 'component-b',
          status: 'ready',
        }),
      ]);
    });

    const emittedCallCount = utilityMocks.emit.mock.calls.length;
    deferredMainComponentA.reject(new Error('Stale selection unavailable.'));
    await flushPromises();

    expect(utilityMocks.emit).toHaveBeenCalledTimes(emittedCallCount);
  });

  it('rejects an inaccessible mutation target without consulting canvas selection', async () => {
    const { selection } = await startPlugin();
    const mainComponent = createComponent('component-b', 'ButtonB');
    const instance = createInstance('instance-b', Promise.resolve(mainComponent));
    selection.splice(0, selection.length, instance);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'save-stale-selection',
      selectionToken: 'instance-a',
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<{ message: string; ok: boolean }>('SAVE_RESULT')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/no longer available/i),
          ok: false,
          operationId: 'save-stale-selection',
        }),
      ]);
    });

    expect(instance.getMainComponentAsync).not.toHaveBeenCalled();
    expect(mainComponent.setSharedPluginData).not.toHaveBeenCalled();
  });

  it('keeps a target-ID mutation valid when canvas selection changes', async () => {
    const { nodesById, selection } = await startPlugin();
    const mainComponentA = createComponent('component-a', 'ButtonA');
    const mainComponentB = createComponent('component-b', 'ButtonB');
    const instanceA = createInstance('instance-a', Promise.resolve(mainComponentA));
    const instanceB = createInstance('instance-b', Promise.resolve(mainComponentB));
    nodesById.set(mainComponentA.id, mainComponentA);
    selection.splice(0, selection.length, instanceA);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'save-selection-race',
      targetToken: mainComponentA.id,
    });

    selection.splice(0, selection.length, instanceB);

    await vi.waitFor(() => {
      expect(mainComponentA.setSharedPluginData).toHaveBeenCalledOnce();
    });

    expect(mainComponentB.setSharedPluginData).not.toHaveBeenCalled();
  });
});

describe('file-wide component inventory', () => {
  it('scans pages sequentially, sorts rows, classifies status, and deduplicates component sets', async () => {
    const { pages } = await startPlugin();
    const connected = createComponent('connected', 'Zeta', {
      sharedPluginData: JSON.stringify({
        componentName: 'Zeta',
        importPath: 'library',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      }),
    });
    const standalone = createComponent('standalone', 'Alpha');
    const remote = createComponent('remote', 'Remote');
    Object.assign(remote, { remote: true });
    const set = {
      componentProperties: {},
      componentPropertyDefinitions: {},
      getSharedPluginData: vi.fn(() => ''),
      id: 'set-a',
      name: 'Control',
      parent: { type: 'PAGE' },
      remote: false,
      setSharedPluginData: vi.fn(),
      type: 'COMPONENT_SET',
    } as unknown as ComponentSetNode;
    const variant = createComponent('variant-a', 'Control / Size=Small');
    Object.assign(variant, { parent: set });
    const pageTwo = createPage('page-2', 'Foundations', [connected]);
    const pageOne = createPage(
      'page-1',
      'Components',
      [standalone, remote, set, variant],
    );
    pages.push(pageOne, pageTwo);

    utilityMocks.handlers.get('SCAN_COMPONENTS')?.({ scanId: 'scan-a' });

    await vi.waitFor(() => {
      const states = emittedPayloads<{
        scanId: string;
        state: ComponentInventoryState;
      }>('COMPONENT_INVENTORY_STATE');
      expect(states[states.length - 1]).toEqual({
        scanId: 'scan-a',
        state: {
          items: [
            expect.objectContaining({
              componentName: 'Alpha',
              pageName: 'Components',
              status: 'not-connected',
              targetToken: 'standalone',
            }),
            expect.objectContaining({
              componentName: 'Control',
              nodeType: 'COMPONENT_SET',
              targetToken: 'set-a',
            }),
            expect.objectContaining({
              componentName: 'Zeta',
              pageName: 'Foundations',
              status: 'connected',
              targetToken: 'connected',
            }),
          ],
          scannedPages: 2,
          status: 'ready',
          totalPages: 2,
        },
      });
    });

    expect(pageOne.loadAsync.mock.invocationCallOrder[0]).toBeLessThan(
      pageTwo.loadAsync.mock.invocationCallOrder[0],
    );
    expect(pageOne.findAllWithCriteria).toHaveBeenCalledWith({
      types: ['COMPONENT', 'COMPONENT_SET'],
    });
  });

  it('continues after a page failure and reports a partial result', async () => {
    const { pages } = await startPlugin();
    const component = createComponent('button', 'Button');
    pages.push(
      createPage('broken', 'Broken page', [], () => Promise.reject(new Error('no access'))),
      createPage('healthy', 'Healthy page', [component]),
    );

    utilityMocks.handlers.get('SCAN_COMPONENTS')?.({ scanId: 'scan-partial' });

    await vi.waitFor(() => {
      const states = emittedPayloads<{
        scanId: string;
        state: ComponentInventoryState;
      }>('COMPONENT_INVENTORY_STATE');
      expect(states[states.length - 1]).toEqual({
        scanId: 'scan-partial',
        state: expect.objectContaining({
          items: [expect.objectContaining({ targetToken: 'button' })],
          skippedPageNames: ['Broken page'],
          status: 'partial',
        }),
      });
    });
  });

  it('suppresses a stale scan after a newer rescan completes', async () => {
    const { pages } = await startPlugin();
    const deferred = createDeferred<void>();
    pages.push(createPage('slow', 'Slow page', [], () => deferred.promise));

    utilityMocks.handlers.get('SCAN_COMPONENTS')?.({ scanId: 'scan-old' });
    await flushPromises();

    pages.splice(
      0,
      pages.length,
      createPage('fast', 'Fast page', [createComponent('fast-component', 'Fast')]),
    );
    utilityMocks.handlers.get('SCAN_COMPONENTS')?.({ scanId: 'scan-new' });

    await vi.waitFor(() => {
      const newStates = emittedPayloads<{
        scanId: string;
        state: ComponentInventoryState;
      }>('COMPONENT_INVENTORY_STATE').filter(({ scanId }) => scanId === 'scan-new');
      expect(newStates[newStates.length - 1]).toEqual({
        scanId: 'scan-new',
        state: expect.objectContaining({
          items: [expect.objectContaining({ targetToken: 'fast-component' })],
          status: 'ready',
        }),
      });
    });

    deferred.resolve();
    await flushPromises();
    const oldStates = emittedPayloads<{
      scanId: string;
      state: ComponentInventoryState;
    }>('COMPONENT_INVENTORY_STATE').filter(({ scanId }) => scanId === 'scan-old');
    expect(oldStates).toEqual([
      {
        scanId: 'scan-old',
        state: {
          scannedPages: 0,
          status: 'scanning',
          totalPages: 1,
        },
      },
    ]);
  });

  it('opens and mutates an explicit local target without selecting it', async () => {
    const { nodesById, selection } = await startPlugin();
    const selected = createComponent('selected', 'Selected');
    const target = createComponent('target', 'Target');
    nodesById.set(target.id, target);
    selection.push(selected);

    utilityMocks.handlers.get('OPEN_COMPONENT_TARGET')?.({
      requestId: 'open-target',
      targetToken: target.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('COMPONENT_TARGET_STATE')).toContainEqual({
        requestId: 'open-target',
        state: expect.objectContaining({
          componentName: 'Target',
          status: 'ready',
          targetToken: target.id,
        }),
      });
    });

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        componentName: 'Target',
        importPath: 'library',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      },
      operationId: 'save-target',
      targetToken: target.id,
    });

    await vi.waitFor(() => {
      expect(target.setSharedPluginData).toHaveBeenCalledOnce();
    });
    expect(selected.setSharedPluginData).not.toHaveBeenCalled();
    expect(selection).toHaveLength(1);
    expect(selection[0]).toBe(selected);
  });
});

describe('connection persistence', () => {
  it('saves validated metadata with the current schema version and timestamp', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourcePath: 'src/Button.tsx',
      sourceUrl: 'https://github.example/tashil/Button.tsx',
      storybookUrl: 'https://storybook.example/Button',
    };
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata,
      operationId: 'save-component-a',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    });

    const [namespace, key, rawMetadata] = component.setSharedPluginData.mock.calls[0] as [
      string,
      string,
      string,
    ];
    const persistedMetadata = JSON.parse(rawMetadata) as ConnectionMetadata;

    expect(namespace).toBe(CONNECTION_NAMESPACE);
    expect(key).toBe(CONNECTION_KEY);
    expect(persistedMetadata).toMatchObject({
      ...metadata,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      updatedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(persistedMetadata.updatedAt ?? ''))).toBe(false);
    expect(notify).toHaveBeenCalledWith('Button connected to Storybook');
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: 'save-component-a',
      targetToken: component.id,
    })]);
  });

  it('increments the mapping revision and refreshes the Figma snapshot only after save', async () => {
    const propertyDefinitions = {
      'Style#style-id': {
        defaultValue: 'Primary',
        type: 'VARIANT',
        variantOptions: ['Primary', 'Secondary'],
      },
    } as ComponentNode['componentPropertyDefinitions'];
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', { propertyDefinitions });
    const mappingDocument: MappingDocument = {
      figmaSnapshot: {
        componentId: 'old-component',
        componentName: 'Old Button',
        properties: [],
      },
      mappings: [],
      revision: 3,
    };
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
        mappingDocument,
      },
      operationId: 'save-mapping-revision',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    });
    const persisted = JSON.parse(
      component.setSharedPluginData.mock.calls[0]?.[2] as string,
    ) as ConnectionMetadata;
    expect(mappingDocument.revision).toBe(3);
    expect(persisted.mappingDocument).toMatchObject({
      figmaSnapshot: {
        componentId: 'component-a',
        componentName: 'Button',
        properties: [expect.objectContaining({ id: 'style-id', name: 'Style' })],
      },
      lastValidatedAt: expect.any(String),
      revision: 4,
    });
  });

  it('clears the persisted connection for the selected component', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    selection.push(component);

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
      operationId: 'clear-component-a',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.setSharedPluginData).toHaveBeenCalledWith(
        CONNECTION_NAMESPACE,
        CONNECTION_KEY,
        '',
      );
    });

    expect(notify).toHaveBeenCalledWith('Storybook connection cleared');
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      operationId: 'clear-component-a',
      targetToken: component.id,
    })]);
  });

  it('rejects a crafted save containing an unsafe reference URL', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
        sourceUrl: 'data:text/html,not-source-code',
      },
      operationId: 'save-unsafe-reference',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toContainEqual(expect.objectContaining({
        message: expect.stringMatching(/source url.*http or https/i),
        ok: false,
        operationId: 'save-unsafe-reference',
      }));
    });

    expect(component.setSharedPluginData).not.toHaveBeenCalled();
  });

  it('omits whitespace-only optional URLs in a crafted save', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
        sourceUrl: '   ',
        storybookUrl: '  ',
      },
      operationId: 'save-blank-references',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    });

    const rawMetadata = component.setSharedPluginData.mock.calls[0]?.[2] as string;
    const persisted = JSON.parse(rawMetadata) as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('sourceUrl');
    expect(persisted).not.toHaveProperty('storybookUrl');
  });

  it('rejects a crafted runtime save that omits the current schema version', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: { componentName: 'Button', importPath: 'tashil-ui' },
      operationId: 'save-missing-schema',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(new RegExp(`schema version ${CURRENT_SCHEMA_VERSION}`, 'i')),
          ok: false,
          operation: 'save',
          operationId: 'save-missing-schema',
        }),
      ]);
    });
    expect(component.setSharedPluginData).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not-json'],
    ['invalid current metadata', JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      componentName: 'button',
      importPath: 'tashil-ui',
    })],
    ['unsupported v2 shape', JSON.stringify({
      schemaVersion: 2,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: 'tashil-ui',
    })],
    ['future metadata', JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      componentName: 'Button',
      importPath: 'tashil-ui',
    })],
  ])('leaves %s unchanged and blocks both save and clear', async (_label, rawMetadata) => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      sharedPluginData: rawMetadata,
    });
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'blocked-save',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toHaveLength(1);
    });

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
      operationId: 'blocked-clear',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toEqual([
        expect.objectContaining({ ok: false, operation: 'save', operationId: 'blocked-save' }),
        expect.objectContaining({ ok: false, operation: 'clear', operationId: 'blocked-clear' }),
      ]);
    });

    expect(component.setSharedPluginData).not.toHaveBeenCalled();
    expect(component.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY)).toBe(rawMetadata);
  });

  it('upgrades supported legacy metadata only after an explicit valid current save', async () => {
    const rawLegacy = JSON.stringify({
      schemaVersion: 2,
      childrenMode: 'text',
      componentName: 'LegacyButton',
      importPath: 'legacy-ui',
    });
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'LegacyButton', {
      sharedPluginData: rawLegacy,
    });
    selection.push(component);

    expect(component.setSharedPluginData).not.toHaveBeenCalled();
    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        childrenMode: 'text',
        childrenTextProperty: 'label',
        componentName: 'LegacyButton',
        importPath: 'legacy-ui',
      },
      operationId: 'upgrade-legacy',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    });

    const persisted = JSON.parse(component.setSharedPluginData.mock.calls[0]?.[2] as string);
    expect(persisted).toMatchObject({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'text',
      componentName: 'LegacyButton',
    });
  });
});

describe('post-mutation effects', () => {
  it('keeps a save successful when the selection refresh rejects', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    component.getSharedPluginData
      .mockImplementationOnce(() => '')
      .mockImplementationOnce(() => {
        throw new Error('refresh unavailable');
      });
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'save-refresh-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.getSharedPluginData).toHaveBeenCalledTimes(2);
    });
    await flushPromises();

    expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: 'save-refresh-throws',
      targetToken: component.id,
    })]);
  });

  it('keeps a clear successful when the selection refresh rejects', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    component.getSharedPluginData
      .mockImplementationOnce(() => '')
      .mockImplementationOnce(() => {
        throw new Error('refresh unavailable');
      });
    selection.push(component);

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
      operationId: 'clear-refresh-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.getSharedPluginData).toHaveBeenCalledTimes(2);
    });
    await flushPromises();

    expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      operationId: 'clear-refresh-throws',
      targetToken: component.id,
    })]);
  });

  it('keeps a save successful and still refreshes when notification throws', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    notify.mockImplementationOnce(() => {
      throw new Error('notifications unavailable');
    });
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'save-notify-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.getSharedPluginData).toHaveBeenCalledTimes(2);
    });

    expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      operationId: 'save-notify-throws',
      targetToken: component.id,
    })]);
  });

  it('keeps a clear successful and still refreshes when notification throws', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    notify.mockImplementationOnce(() => {
      throw new Error('notifications unavailable');
    });
    selection.push(component);

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
      operationId: 'clear-notify-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(component.getSharedPluginData).toHaveBeenCalledTimes(2);
    });

    expect(component.setSharedPluginData).toHaveBeenCalledOnce();
    expect(emittedPayloads('SAVE_RESULT')).toEqual([expect.objectContaining({
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      operationId: 'clear-notify-throws',
      targetToken: component.id,
    })]);
  });
});

describe('external reference opening', () => {
  it('opens a normalized HTTP(S) URL through the Figma host', async () => {
    const { openExternal } = await startPlugin();

    utilityMocks.handlers.get('OPEN_EXTERNAL')?.({
      target: 'storybook',
      url: '  https://EXAMPLE.com/story?id=1#primary  ',
    });

    expect(openExternal).toHaveBeenCalledWith('https://example.com/story?id=1#primary');
  });

  it.each([
    ['source', 'javascript:alert(1)'],
    ['storybook', '//example.com/story'],
    ['source', 'https://user@example.com/source'],
    ['storybook', 'https://example.com/story%0ahttps://attacker.example'],
  ])('rejects an unsafe %s URL before opening it', async (target, url) => {
    const { notify, openExternal } = await startPlugin();

    utilityMocks.handlers.get('OPEN_EXTERNAL')?.({ target, url });

    expect(openExternal).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/http or https/i));
  });

  it('rejects a crafted payload with an unknown reference target', async () => {
    const { notify, openExternal } = await startPlugin();

    utilityMocks.handlers.get('OPEN_EXTERNAL')?.({
      target: 'other',
      url: 'https://example.com/',
    });

    expect(openExternal).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/invalid/i));
  });
});

describe('mutation failure results', () => {
  it('returns a correlated terminal failure when saving throws', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    component.setSharedPluginData.mockImplementationOnce(() => {
      throw new Error('shared data unavailable');
    });
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      operationId: 'save-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toEqual([{
        message: expect.stringContaining('shared data unavailable'),
        ok: false,
        operation: 'save',
        operationId: 'save-throws',
        targetToken: component.id,
      }]);
    });
  });

  it('returns a correlated terminal failure when clearing throws', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    component.setSharedPluginData.mockImplementationOnce(() => {
      throw new Error('cannot clear shared data');
    });
    selection.push(component);

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
      operationId: 'clear-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SAVE_RESULT')).toEqual([{
        message: expect.stringContaining('cannot clear shared data'),
        ok: false,
        operation: 'clear',
        operationId: 'clear-throws',
        targetToken: component.id,
      }]);
    });
  });

  it('returns a correlated terminal failure when scaffolding throws', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    Object.defineProperty(component, 'componentPropertyDefinitions', {
      get: () => {
        throw new Error('definitions unavailable');
      },
    });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-throws',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads('SCAFFOLD_RESULT')).toEqual([{
        message: expect.stringContaining('definitions unavailable'),
        ok: false,
        operationId: 'scaffold-throws',
        targetToken: component.id,
      }]);
    });
  });
});

describe('persisted metadata reads', () => {
  it('resolves changing icon-swap IDs to Icon elements', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: 'tashil-ui',
      propMappings: {
        leadingIcon: {
          '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
        },
        trailingIcon: {
          '*': { prop: 'renderLeftIcon', value: '$instanceSwap' },
        },
      },
    };
    const { codegenEvents, nodesById } = await startPlugin();
    const mainComponent = createComponent('button-component', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    const instance = createInstance(
      'button-instance',
      Promise.resolve(mainComponent),
      {
        'hasLeadingIcon#guard': { type: 'BOOLEAN', value: true },
        'hasTrailingIcon#guard': { type: 'BOOLEAN', value: true },
        'leadingIcon#swap': { type: 'INSTANCE_SWAP', value: 'shield-id' },
        'trailingIcon#swap': { type: 'INSTANCE_SWAP', value: 'contract-check-id' },
      },
    );
    nodesById.set('shield-id', createComponent('shield-id', 'Shield'));
    nodesById.set(
      'contract-check-id',
      createComponent('contract-check-id', 'ContractCheck'),
    );
    const blocks = await codegenEvents.get('generate')?.({ node: instance });

    expect(blocks).toEqual([
      expect.objectContaining({
        code: [
          'import { Button, Icon } from "tashil-ui";',
          '',
          '<Button renderRightIcon={<Icon name="shield" />} renderLeftIcon={<Icon name="contract-check" />} />',
        ].join('\n'),
        language: 'TYPESCRIPT',
      }),
    ]);
  });

  it('preserves magic component-property names when generating mapped props', async () => {
    const metadata = JSON.parse([
      '{',
      `  "schemaVersion": ${CURRENT_SCHEMA_VERSION},`,
      '  "childrenMode": "none",',
      '  "componentName": "Button",',
      '  "importPath": "tashil-ui",',
      '  "propMappings": {',
      '    "__proto__": {',
      '      "constructor": { "prop": "tone", "value": "safe" }',
      '    }',
      '  }',
      '}',
    ].join('\n')) as ConnectionMetadata;
    const { codegenEvents } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    Object.defineProperty(component, 'componentProperties', {
      configurable: true,
      enumerable: true,
      value: Object.fromEntries([
        ['__proto__#property-id', { type: 'VARIANT', value: 'constructor' }],
      ]),
      writable: true,
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    expect(blocks).toEqual([
      expect.objectContaining({
        code: expect.stringContaining('<Button tone={"safe"} />'),
        language: 'TYPESCRIPT',
      }),
    ]);
  });

  it('emits structured inspect references and keeps native codegen references plaintext', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourcePath: 'src/Button.tsx',
      sourceUrl: 'https://github.example/tashil/Button.tsx',
      storybookUrl: 'https://storybook.example/Button',
      updatedAt: '2026-07-15T10:30:00.000Z',
    };
    const { codegenEvents, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          references: {
            sourcePath: metadata.sourcePath,
            sourceUrl: metadata.sourceUrl,
            storybookUrl: metadata.storybookUrl,
            updatedAt: metadata.updatedAt,
          },
          status: 'connected',
        }),
      );
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });
    const references = blocks?.find((block) => block.title === 'References');

    expect(references).toMatchObject({
      language: 'PLAINTEXT',
      title: 'References',
    });
    expect(references?.code).toContain(`Storybook: ${metadata.storybookUrl}`);
    expect(references?.code).toContain(`Source path: ${metadata.sourcePath}`);
    expect(references?.code).toContain(`Source URL: ${metadata.sourceUrl}`);
  });

  it('keeps historical unsafe reference strings readable without breaking codegen', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'LegacyButton',
      importPath: 'legacy-ui',
      sourceUrl: 'file:///tmp/LegacyButton.tsx',
      storybookUrl: 'javascript:legacy-reference',
    };
    const { codegenEvents, selection } = await startPlugin();
    const component = createComponent('component-a', 'LegacyButton', {
      sharedPluginData: JSON.stringify(metadata),
    });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          references: expect.objectContaining({
            sourceUrl: metadata.sourceUrl,
            storybookUrl: metadata.storybookUrl,
          }),
          status: 'connected',
        }),
      );
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });
    expect(blocks?.[0]).toMatchObject({
      language: 'TYPESCRIPT',
      title: 'LegacyButton',
    });
  });

  it('reads and migrates legacy metadata before sending it to the UI', async () => {
    const legacyMetadata = {
      componentName: 'LegacyButton',
      importPath: 'legacy-ui',
      sourcePath: 'src/LegacyButton.tsx',
    };
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'LegacyButton', {
      sharedPluginData: JSON.stringify(legacyMetadata),
    });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toEqual([
        expect.objectContaining({
          existingConnection: {
            ...legacyMetadata,
            childrenMode: 'text',
            childrenTextProperty: 'label',
            schemaVersion: CURRENT_SCHEMA_VERSION,
          },
          status: 'ready',
        }),
      ]);
    });

    expect(component.getSharedPluginData).toHaveBeenCalledOnce();
    expect(component.getSharedPluginData).toHaveBeenCalledWith(
      CONNECTION_NAMESPACE,
      CONNECTION_KEY,
    );
  });

  it('migrates v2 icon-only metadata to an explicit named icon import', async () => {
    const { codegenEvents } = await startPlugin();
    const component = createComponent('component-a', 'IconButton', {
      sharedPluginData: JSON.stringify({
        schemaVersion: 2,
        componentName: 'IconButton',
        importPath: 'legacy-ui',
        childrenMode: 'icon-only',
      }),
    });
    const blocks = await codegenEvents.get('generate')?.({ node: component });

    expect(blocks?.[0]).toMatchObject({
      code: expect.stringContaining('import { IconButton, Icon } from "legacy-ui";'),
      language: 'TYPESCRIPT',
    });
    expect(blocks?.[0].code).toContain('  <Icon />');
  });

  it.each([
    {
      expectedMessage: 'does not match schema version 1',
      rawMetadata: JSON.stringify({ componentName: 'Button', importPath: 42 }),
    },
    {
      expectedMessage: 'malformed JSON',
      rawMetadata: '{not-json',
    },
  ])('reports $expectedMessage', async ({ expectedMessage, rawMetadata }) => {
    const { codegenEvents } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      sharedPluginData: rawMetadata,
    });
    const generate = codegenEvents.get('generate');

    expect(generate).toBeDefined();
    const blocks = await generate?.({ node: component });

    expect(blocks).toEqual([
      expect.objectContaining({
        code: expect.stringContaining(expectedMessage),
        language: 'PLAINTEXT',
      }),
    ]);
  });

  it('surfaces a future stored schema as a typed issue in Connect, Inspect, and Dev Mode', async () => {
    const rawMetadata = JSON.stringify({
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      componentName: 'Button',
      importPath: 'tashil-ui',
    });
    const { codegenEvents, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', { sharedPluginData: rawMetadata });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<UiTargetState>('SELECTION_STATE')).toContainEqual(
        expect.objectContaining({
          connectionIssue: expect.objectContaining({ reason: 'future-schema-version' }),
          existingConnection: undefined,
          message: expect.stringMatching(/newer.*update the plugin/i),
          status: 'ready',
        }),
      );
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          connectionIssue: expect.objectContaining({ reason: 'future-schema-version' }),
          message: expect.stringMatching(/newer.*update the plugin/i),
          status: 'connection-issue',
        }),
      );
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });
    expect(blocks).toEqual([
      expect.objectContaining({
        code: expect.stringMatching(/newer.*update the plugin/i),
        language: 'PLAINTEXT',
      }),
    ]);
  });
});

describe('prop mapping scaffolding', () => {
  it('scaffolds default instance swaps when the main component is selected', async () => {
    const { nodesById, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      propertyDefinitions: {
        'leadingIcon#leading-property': {
          defaultValue: 'plus-id',
          preferredValues: [],
          type: 'INSTANCE_SWAP',
        },
      },
    });
    nodesById.set('plus-id', createComponent('plus-id', 'Plus'));
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-default-instance-swap',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([{
        mappings: {
          leadingIcon: {
            '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
          },
        },
        ok: true,
        operationId: 'scaffold-default-instance-swap',
        targetToken: component.id,
      }]);
    });
  });

  it('scaffolds target component instance swaps with icon names and render prop targets', async () => {
    const { nodesById, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      propertyDefinitions: {
        'leadingIcon#leading-property': {
          defaultValue: 'default-leading-id',
          preferredValues: [],
          type: 'INSTANCE_SWAP',
        },
        'trailingIcon#trailing-property': {
          defaultValue: 'default-trailing-id',
          preferredValues: [],
          type: 'INSTANCE_SWAP',
        },
      },
    });
    const instance = createInstance(
      'instance-a',
      Promise.resolve(component),
      {
        'leadingIcon#leading-property': {
          type: 'INSTANCE_SWAP',
          value: 'shield-id',
        },
        'trailingIcon#trailing-property': {
          type: 'INSTANCE_SWAP',
          value: 'contract-check-id',
        },
      },
    );
    nodesById.set('shield-id', createComponent('shield-id', 'Shield'));
    nodesById.set(
      'contract-check-id',
      createComponent('contract-check-id', 'ContractCheck'),
    );
    nodesById.set(
      'default-leading-id',
      createComponent('default-leading-id', 'Shield'),
    );
    nodesById.set(
      'default-trailing-id',
      createComponent('default-trailing-id', 'ContractCheck'),
    );
    nodesById.set(component.id, component);
    selection.push(instance);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-instance-swaps',
      targetToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([{
        mappings: {
          leadingIcon: {
            '*': { prop: 'renderRightIcon', value: '$instanceSwap' },
          },
          trailingIcon: {
            '*': { prop: 'renderLeftIcon', value: '$instanceSwap' },
          },
        },
        ok: true,
        operationId: 'scaffold-instance-swaps',
        targetToken: component.id,
      }]);
    });
  });

  it('scaffolds magic property and option keys as own entries', async () => {
    const propertyDefinitions = Object.fromEntries([
      ['__proto__', {
        defaultValue: '__proto__',
        type: 'VARIANT',
        variantOptions: ['__proto__', 'constructor', 'toString'],
      }],
    ]) as ComponentNode['componentPropertyDefinitions'];
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', { propertyDefinitions });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-magic-keys',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      const payload = emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )[0];

      if (!payload?.mappings) {
        throw new Error('Expected scaffolded mappings.');
      }

      expect(payload).toMatchObject({
        ok: true,
        operationId: 'scaffold-magic-keys',
        targetToken: component.id,
      });
      expect(Object.keys(payload.mappings)).toEqual(['__proto__']);
      expect(Object.keys(payload.mappings['__proto__'])).toEqual([
        '__proto__',
        'constructor',
        'toString',
      ]);
      expect(payload.mappings['__proto__']['__proto__']).toEqual({
        prop: 'proto',
        value: '__proto__',
      });
    });
  });

  it('scaffolds variant options and skips non-variant properties', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      propertyDefinitions: {
        Disabled: { defaultValue: false, type: 'BOOLEAN' },
        Size: {
          defaultValue: 'Small',
          type: 'VARIANT',
          variantOptions: ['Small', 'Large'],
        },
        'Icon Position': {
          defaultValue: 'Leading',
          type: 'VARIANT',
          variantOptions: ['Leading', 'Trailing'],
        },
        'Visual/Style': {
          defaultValue: 'Solid',
          type: 'VARIANT',
          variantOptions: ['Solid'],
        },
      },
    });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-component-a',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([
        {
          mappings: {
            'Icon Position': {
              Leading: { prop: 'iconPosition', value: 'Leading' },
              Trailing: { prop: 'iconPosition', value: 'Trailing' },
            },
            Size: {
              Large: { prop: 'size', value: 'Large' },
              Small: { prop: 'size', value: 'Small' },
            },
            'Visual/Style': {
              Solid: { prop: 'visualStyle', value: 'Solid' },
            },
          },
          ok: true,
          operationId: 'scaffold-component-a',
          targetToken: component.id,
        },
      ]);
    });
  });

  it('reports when no variant properties can be scaffolded', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      propertyDefinitions: {
        Disabled: { defaultValue: false, type: 'BOOLEAN' },
      },
    });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-empty-component-a',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([
        {
          message: 'No variant or active instance-swap properties found on this component to scaffold.',
          ok: false,
          operationId: 'scaffold-empty-component-a',
          targetToken: component.id,
        },
      ]);
    });
  });

  it('reports an actionable failure when a property cannot become a safe React prop', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('component-a', 'Button', {
      propertyDefinitions: {
        '***': {
          defaultValue: 'Solid',
          type: 'VARIANT',
          variantOptions: ['Solid'],
        },
      },
    });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      operationId: 'scaffold-invalid-property',
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/rename.*letters or numbers.*manually/i),
          ok: false,
          operationId: 'scaffold-invalid-property',
          targetToken: component.id,
        }),
      ]);
    });
  });
});
