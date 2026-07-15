import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type CodegenBlock,
  type ConnectionMetadata,
  type ScaffoldResultHandler,
  type UiSelectionState,
} from './types';

type MessageHandler = (payload: unknown) => void;

const utilityMocks = vi.hoisted(() => {
  const handlers = new Map<string, MessageHandler>();

  return {
    emit: vi.fn(),
    handlers,
    on: vi.fn((name: string, handler: MessageHandler) => {
      handlers.set(name, handler);
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

type ComponentOptions = {
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
    componentProperties: {},
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
): InstanceDouble {
  return {
    componentProperties: {},
    getMainComponentAsync: vi.fn(() => mainComponent),
    id,
    name: id,
    parent: { type: 'PAGE' },
    type: 'INSTANCE',
  } as unknown as InstanceDouble;
}

function createDeferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return { promise, resolve: resolvePromise };
}

function emittedPayloads<T>(name: string): T[] {
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
  selection: SceneNode[];
}> {
  const codegenEvents = new Map<string, CodegenGenerateHandler>();
  const figmaEvents = new Map<string, () => void>();
  const notify = vi.fn();
  const selection: SceneNode[] = [];

  vi.stubGlobal('figma', {
    closePlugin: vi.fn(),
    codegen: {
      on: vi.fn((name: string, handler: CodegenGenerateHandler) => {
        codegenEvents.set(name, handler);
      }),
    },
    currentPage: { selection },
    mode: 'default',
    notify,
    on: vi.fn((name: string, handler: () => void) => {
      figmaEvents.set(name, handler);
    }),
    ui: { resize: vi.fn() },
  });

  const plugin = await import('./main');
  plugin.default();

  return { codegenEvents, figmaEvents, notify, selection };
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
      expect(emittedPayloads<UiSelectionState>('SELECTION_STATE')).toEqual([
        expect.objectContaining({
          componentName: 'ButtonB',
          selectionToken: 'instance-b',
          status: 'ready',
        }),
      ]);
    });

    const emittedCallCount = utilityMocks.emit.mock.calls.length;
    deferredMainComponentA.resolve(mainComponentA);
    await flushPromises();

    expect(utilityMocks.emit).toHaveBeenCalledTimes(emittedCallCount);
  });

  it('rejects a mutation token for a selection that is no longer current', async () => {
    const { selection } = await startPlugin();
    const mainComponent = createComponent('component-b', 'ButtonB');
    const instance = createInstance('instance-b', Promise.resolve(mainComponent));
    selection.splice(0, selection.length, instance);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      selectionToken: 'instance-a',
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<{ message: string; ok: boolean }>('SAVE_RESULT')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/selection changed/i),
          ok: false,
        }),
      ]);
    });

    expect(instance.getMainComponentAsync).not.toHaveBeenCalled();
    expect(mainComponent.setSharedPluginData).not.toHaveBeenCalled();
  });

  it('rechecks the selection after resolving an asynchronous instance target', async () => {
    const { selection } = await startPlugin();
    const mainComponentA = createComponent('component-a', 'ButtonA');
    const mainComponentB = createComponent('component-b', 'ButtonB');
    const deferredMainComponentA = createDeferred<ComponentNode | null>();
    const instanceA = createInstance('instance-a', deferredMainComponentA.promise);
    const instanceB = createInstance('instance-b', Promise.resolve(mainComponentB));
    selection.splice(0, selection.length, instanceA);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        componentName: 'Button',
        importPath: 'tashil-ui',
      },
      selectionToken: 'instance-a',
    });

    expect(instanceA.getMainComponentAsync).toHaveBeenCalledOnce();
    selection.splice(0, selection.length, instanceB);
    deferredMainComponentA.resolve(mainComponentA);

    await vi.waitFor(() => {
      expect(emittedPayloads<{ message: string; ok: boolean }>('SAVE_RESULT')).toEqual([
        expect.objectContaining({
          message: expect.stringMatching(/selection changed/i),
          ok: false,
        }),
      ]);
    });

    expect(mainComponentA.setSharedPluginData).not.toHaveBeenCalled();
  });
});

describe('connection persistence', () => {
  it('saves validated metadata with the current schema version and timestamp', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    const metadata: ConnectionMetadata = {
      componentName: 'Button',
      importPath: 'tashil-ui',
      sourcePath: 'src/Button.tsx',
      storybookUrl: 'https://storybook.example/Button',
    };
    selection.push(component);

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata,
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
    expect(emittedPayloads('SAVE_RESULT')).toContainEqual({
      message: 'Connection saved.',
      ok: true,
      operation: 'save',
      selectionToken: component.id,
    });
  });

  it('clears the persisted connection for the selected component', async () => {
    const { notify, selection } = await startPlugin();
    const component = createComponent('component-a', 'Button');
    selection.push(component);

    utilityMocks.handlers.get('CLEAR_CONNECTION')?.({
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
    expect(emittedPayloads('SAVE_RESULT')).toContainEqual({
      message: 'Connection cleared.',
      ok: true,
      operation: 'clear',
      selectionToken: component.id,
    });
  });
});

describe('persisted metadata reads', () => {
  it('reads and migrates legacy metadata before sending it to the UI', async () => {
    const legacyMetadata: ConnectionMetadata = {
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
      expect(emittedPayloads<UiSelectionState>('SELECTION_STATE')).toEqual([
        expect.objectContaining({
          existingConnection: {
            ...legacyMetadata,
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

  it.each([
    {
      expectedMessage: 'invalid Storybook connection metadata',
      rawMetadata: JSON.stringify({ componentName: 'Button', importPath: 42 }),
    },
    {
      expectedMessage: 'malformed Storybook connection metadata',
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
});

describe('prop mapping scaffolding', () => {
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
      },
    });
    selection.push(component);

    utilityMocks.handlers.get('SCAFFOLD_PROP_MAPPINGS')?.({
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([
        {
          mappings: {
            Size: {
              Large: { prop: 'Size', value: 'Large' },
              Small: { prop: 'Size', value: 'Small' },
            },
          },
          ok: true,
          selectionToken: component.id,
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
      selectionToken: component.id,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<Parameters<ScaffoldResultHandler['handler']>[0]>(
        'SCAFFOLD_RESULT',
      )).toEqual([
        {
          message: 'No variant properties found on this component to scaffold.',
          ok: false,
          selectionToken: component.id,
        },
      ]);
    });
  });
});
