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
  type ExportTokensResultHandler,
  type PreviewTokensResultHandler,
  type ScaffoldResultHandler,
  type UiTargetState,
} from './types';
import { createDialogRecipe } from './semantic/fixtures';
import type { ExportOptions } from './sync-tokens/types';

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
    key: `${id}-key`,
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

type FrameDouble = FrameNode;

type FrameOptions = {
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE';
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  layoutSizingHorizontal?: 'FIXED' | 'HUG' | 'FILL';
  layoutSizingVertical?: 'FIXED' | 'HUG' | 'FILL';
  width?: number;
  effectStyleId?: string;
  /** When set, the double exposes `getCSSAsync` resolving to these declarations. */
  css?: { [property: string]: string };
};

/** A FRAME double with the auto-layout fields the layout extractor reads. */
function createFrame(
  id: string,
  name: string,
  children: ReadonlyArray<SceneNode>,
  options: FrameOptions = {},
): FrameDouble {
  return {
    children: [...children],
    id,
    layoutMode: options.layoutMode ?? 'VERTICAL',
    itemSpacing: options.itemSpacing ?? 0,
    paddingTop: options.paddingTop ?? 0,
    paddingRight: options.paddingRight ?? 0,
    paddingBottom: options.paddingBottom ?? 0,
    paddingLeft: options.paddingLeft ?? 0,
    primaryAxisAlignItems: options.primaryAxisAlignItems ?? 'MIN',
    counterAxisAlignItems: options.counterAxisAlignItems ?? 'MIN',
    layoutSizingHorizontal: options.layoutSizingHorizontal ?? 'HUG',
    layoutSizingVertical: options.layoutSizingVertical ?? 'HUG',
    width: options.width ?? 320,
    name,
    parent: { type: 'PAGE' },
    type: 'FRAME',
    ...(options.effectStyleId ? { effectStyleId: options.effectStyleId } : {}),
    ...(options.css ? { getCSSAsync: vi.fn(() => Promise.resolve(options.css)) } : {}),
  } as unknown as FrameDouble;
}

function createPage(
  id: string,
  name: string,
  nodes: ReadonlyArray<SceneNode>,
  loadAsync: () => Promise<void> = () => Promise.resolve(),
): PageDouble {
  return {
    findAllWithCriteria: vi.fn((criteria: { types: string[] }) => (
      nodes.filter((node) => criteria.types.includes(node.type))
    )),
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

type StartPluginOptions = {
  effectStyles?: EffectStyle[];
  textStyles?: TextStyle[];
  variableCollections?: VariableCollection[];
  variables?: Variable[];
};

async function startPlugin(options: StartPluginOptions = {}): Promise<{
  clientStorage: Map<string, unknown>;
  codegenCustomSettings: Record<string, string>;
  codegenEvents: Map<string, CodegenGenerateHandler>;
  figmaEvents: Map<string, () => void>;
  notify: ReturnType<typeof vi.fn>;
  nodesById: Map<string, BaseNode>;
  openExternal: ReturnType<typeof vi.fn>;
  pages: PageNode[];
  selection: SceneNode[];
}> {
  const codegenEvents = new Map<string, CodegenGenerateHandler>();
  const clientStorage = new Map<string, unknown>();
  const codegenCustomSettings: Record<string, string> = {};
  const figmaEvents = new Map<string, () => void>();
  const notify = vi.fn();
  const nodesById = new Map<string, BaseNode>();
  const openExternal = vi.fn();
  const pages: PageNode[] = [];
  const variableCollections = options.variableCollections ?? [];
  const variables = options.variables ?? [];
  const textStyles = options.textStyles ?? [];
  const effectStyles = options.effectStyles ?? [];
  const stylesById = new Map<string, BaseStyle>(
    [...effectStyles, ...textStyles].map((style) => [style.id, style as BaseStyle]),
  );
  const variableCollectionsById = new Map(
    variableCollections.map((collection) => [collection.id, collection]),
  );
  const variablesById = new Map(
    variables.map((variable) => [variable.id, variable]),
  );
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
    clientStorage: {
      getAsync: vi.fn((key: string) => Promise.resolve(clientStorage.get(key))),
      setAsync: vi.fn((key: string, value: unknown) => { clientStorage.set(key, value); return Promise.resolve(); }),
    },
    closePlugin: vi.fn(),
    codegen: {
      on: vi.fn((name: string, handler: CodegenGenerateHandler) => {
        codegenEvents.set(name, handler);
      }),
      preferences: { customSettings: codegenCustomSettings, unit: 'PIXEL' },
    },
    currentPage: { selection },
    fileKey: 'file-key',
    getNodeByIdAsync: vi.fn((id: string) => Promise.resolve(nodesById.get(id) ?? null)),
    getStyleByIdAsync: vi.fn((id: string) => Promise.resolve(stylesById.get(id) ?? null)),
    getLocalEffectStylesAsync: vi.fn(() => Promise.resolve(effectStyles)),
    getLocalTextStylesAsync: vi.fn(() => Promise.resolve(textStyles)),
    mode: 'default',
    notify,
    openExternal,
    on: vi.fn((name: string, handler: () => void) => {
      figmaEvents.set(name, handler);
    }),
    root: { children: pages },
    ui: { resize: vi.fn() },
    variables: {
      getLocalVariableCollectionsAsync: vi.fn(() => Promise.resolve(variableCollections)),
      getLocalVariablesAsync: vi.fn(() => Promise.resolve(variables)),
      getVariableByIdAsync: vi.fn((id: string) => Promise.resolve(variablesById.get(id) ?? null)),
      getVariableCollectionByIdAsync: vi.fn(
        (id: string) => Promise.resolve(variableCollectionsById.get(id) ?? null),
      ),
    },
  });

  const plugin = await import('./main');
  plugin.default();

  return {
    clientStorage,
    codegenCustomSettings,
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

describe('Design mode plugin window', () => {
  it('opens at the compact default width', async () => {
    await startPlugin();

    expect(utilityMocks.showUI).toHaveBeenCalledWith({ height: 680, width: 560 });
  });

  it('loads local Typography and Effects sources with a lightweight style preview', async () => {
    const textStyle = {
      description: 'Primary body copy',
      fontName: { family: 'Inter', style: 'Regular' },
      fontSize: 16,
      id: 'text-style-1',
      letterSpacing: { unit: 'PIXELS', value: 0 },
      lineHeight: { unit: 'PIXELS', value: 24 },
      name: 'Body/Medium',
      type: 'TEXT',
    } as unknown as TextStyle;
    const effectStyle = {
      description: 'Card elevation',
      effects: [{
        blendMode: 'NORMAL',
        color: { a: 0.16, b: 0, g: 0, r: 0 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
        type: 'DROP_SHADOW',
        visible: true,
      }],
      id: 'effect-style-1',
      name: 'Elevation/Card',
      type: 'EFFECT',
    } as unknown as EffectStyle;
    await startPlugin({ effectStyles: [effectStyle], textStyles: [textStyle] });

    utilityMocks.handlers.get('LOAD_DOC_STYLE_SOURCES')?.(undefined);
    await flushPromises();
    expect(emittedPayloads<{ sources: Array<{ id: string; styleCount: number }> }>(
      'LOAD_DOC_STYLE_SOURCES_RESULT',
    )[0]?.sources).toEqual([
      expect.objectContaining({ id: 'typography', styleCount: 1 }),
      expect.objectContaining({ id: 'effects', styleCount: 1 }),
    ]);

    utilityMocks.handlers.get('LOAD_DOC_SOURCE_PREVIEW')?.({
      requestId: 'style-preview',
      scope: 'styles',
      targetId: 'typography',
    });
    await vi.waitFor(() => {
      expect(emittedPayloads('LOAD_DOC_SOURCE_PREVIEW_RESULT')).toHaveLength(1);
    });
    expect(emittedPayloads<{ preview: { groupNames: string[]; styleCount: number } }>(
      'LOAD_DOC_SOURCE_PREVIEW_RESULT',
    )[0]?.preview).toEqual(expect.objectContaining({
      groupNames: ['Body'],
      styleCount: 1,
    }));
  });

  it('resolves bound variable tokens when loading style documentation', async () => {
    const fontSizeVar = {
      id: 'var-font-size',
      name: 'font-size/32',
      resolvedType: 'FLOAT',
    } as unknown as Variable;
    const lineHeightVar = {
      id: 'var-line-height',
      name: 'line-height/48',
      resolvedType: 'FLOAT',
    } as unknown as Variable;
    const fontFamilyVar = {
      id: 'var-font-family',
      name: 'font-family/yekan-bakh',
      resolvedType: 'STRING',
    } as unknown as Variable;
    const colorVar = {
      id: 'var-color-shadow',
      name: 'color/shadow/card',
      resolvedType: 'COLOR',
    } as unknown as Variable;

    const textStyle = {
      boundVariables: {
        fontFamily: { id: 'var-font-family', type: 'VARIABLE_ALIAS' },
        fontSize: { id: 'var-font-size', type: 'VARIABLE_ALIAS' },
        lineHeight: { id: 'var-line-height', type: 'VARIABLE_ALIAS' },
      },
      description: 'Heading style with bound tokens',
      fontName: { family: 'Yekan Bakh', style: 'Heavy' },
      fontSize: 32,
      id: 'text-style-bound',
      letterSpacing: { unit: 'PIXELS', value: 0 },
      lineHeight: { unit: 'PIXELS', value: 48 },
      name: 'Heading/H1',
      type: 'TEXT',
    } as unknown as TextStyle;

    const effectStyle = {
      description: 'Shadow with bound color token',
      effects: [{
        blendMode: 'NORMAL',
        boundVariables: {
          color: { id: 'var-color-shadow', type: 'VARIABLE_ALIAS' },
        },
        color: { a: 0.16, b: 0, g: 0, r: 0 },
        offset: { x: 0, y: 4 },
        radius: 12,
        spread: 0,
        type: 'DROP_SHADOW',
        visible: true,
      }],
      id: 'effect-style-bound',
      name: 'Elevation/Card',
      type: 'EFFECT',
    } as unknown as EffectStyle;

    await startPlugin({
      effectStyles: [effectStyle],
      textStyles: [textStyle],
      variables: [fontSizeVar, lineHeightVar, fontFamilyVar, colorVar],
    });

    utilityMocks.handlers.get('LOAD_DOC_SOURCE_PREVIEW')?.({
      requestId: 'bound-style-preview',
      scope: 'styles',
      targetId: 'typography',
    });
    await vi.waitFor(() => {
      expect(emittedPayloads('LOAD_DOC_SOURCE_PREVIEW_RESULT')).toHaveLength(1);
    });

    expect(emittedPayloads<{ preview: { groupNames: string[]; styleCount: number } }>(
      'LOAD_DOC_SOURCE_PREVIEW_RESULT',
    )[0]?.preview).toEqual(expect.objectContaining({
      groupNames: ['Heading'],
      styleCount: 1,
    }));
  });

  it('formats effect styles into standard CSS syntax', async () => {
    const multiShadowStyle = {
      description: 'Multi-layer elevation',
      effects: [
        {
          blendMode: 'NORMAL',
          color: { a: 0.1, b: 0, g: 0, r: 0 },
          offset: { x: 0, y: 1 },
          radius: 3,
          spread: 0,
          type: 'DROP_SHADOW',
          visible: true,
        },
        {
          blendMode: 'NORMAL',
          color: { a: 0.1, b: 0, g: 0, r: 0 },
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: -1,
          type: 'DROP_SHADOW',
          visible: true,
        },
      ],
      id: 'effect-multi-shadow',
      name: 'Elevation/Small',
      type: 'EFFECT',
    } as unknown as EffectStyle;

    const blurStyle = {
      description: 'Backdrop blur for glass navbar',
      effects: [
        {
          radius: 16,
          type: 'BACKGROUND_BLUR',
          visible: true,
        },
      ],
      id: 'effect-blur',
      name: 'Blur/Glass',
      type: 'EFFECT',
    } as unknown as EffectStyle;

    await startPlugin({ effectStyles: [multiShadowStyle, blurStyle] });

    utilityMocks.handlers.get('LOAD_DOC_SOURCE_PREVIEW')?.({
      requestId: 'effects-css-preview',
      scope: 'styles',
      targetId: 'effects',
    });
    await vi.waitFor(() => {
      expect(emittedPayloads('LOAD_DOC_SOURCE_PREVIEW_RESULT')).toHaveLength(1);
    });

    const result = emittedPayloads<{
      ok: boolean;
      preview: { groupNames: string[]; styleCount: number };
    }>('LOAD_DOC_SOURCE_PREVIEW_RESULT')[0];
    expect(result?.ok).toBe(true);
    expect(result?.preview).toEqual(expect.objectContaining({
      groupNames: ['Elevation', 'Blur'],
      styleCount: 2,
    }));
  });

  it('cancels the active documentation run without poisoning the next run', async () => {
    const collection = {
      defaultModeId: 'light',
      id: 'colors',
      modes: [{ modeId: 'light', name: 'Light' }],
      name: 'Colors',
      variableIds: [],
    } as unknown as VariableCollection;
    const deferredCollections = createDeferred<VariableCollection[]>();
    await startPlugin({ variableCollections: [collection] });
    vi.mocked(figma.variables.getLocalVariableCollectionsAsync)
      .mockReturnValueOnce(deferredCollections.promise);

    utilityMocks.handlers.get('GENERATE_TOKEN_DOCS')?.({
      collectionId: 'colors',
      targetFormat: 'markdown',
      tokenGroupingDepth: '1',
    });
    utilityMocks.handlers.get('CANCEL_DOC_GENERATION')?.(undefined);
    deferredCollections.resolve([collection]);
    await flushPromises();

    expect(emittedPayloads('GENERATE_TOKEN_DOCS_RESULT')).toHaveLength(0);

    utilityMocks.handlers.get('GENERATE_TOKEN_DOCS')?.({
      collectionId: 'colors',
      targetFormat: 'markdown',
      tokenGroupingDepth: '1',
    });
    await vi.waitFor(() => {
      expect(emittedPayloads<{ ok: boolean }>('GENERATE_TOKEN_DOCS_RESULT')).toHaveLength(1);
    });
    expect(emittedPayloads<{ ok: boolean }>('GENERATE_TOKEN_DOCS_RESULT')[0]?.ok).toBe(true);
  });
});

describe('output preference persistence', () => {
  it('round-trips user settings through clientStorage', async () => {
    const { clientStorage } = await startPlugin();
    const preferences = {
      copyMode: 'imports-only' as const,
      indentation: '4' as const,
      previewDirection: 'rtl' as const,
      quoteStyle: 'single' as const,
      semicolons: false,
      styledComponentPattern: '{Name}Container',
      trailingComma: false,
    };
    utilityMocks.handlers.get('SAVE_OUTPUT_PREFERENCES')?.({ preferences });
    await vi.waitFor(() => expect(clientStorage.size).toBe(1));
    utilityMocks.handlers.get('LOAD_OUTPUT_PREFERENCES')?.(undefined);
    await vi.waitFor(() => expect(emittedPayloads('LOAD_OUTPUT_PREFERENCES_RESULT')).toHaveLength(1));
    expect(emittedPayloads('LOAD_OUTPUT_PREFERENCES_RESULT')[0]).toEqual({ preferences });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sync Tokens export', () => {
  it('resolves cross-collection aliases using the target collection mode', async () => {
    const references = {
      id: 'references',
      name: 'References',
      modes: [
        { modeId: 'references-light', name: 'Light' },
        { modeId: 'references-dark', name: 'Dark' },
      ],
      defaultModeId: 'references-light',
      variableIds: ['reference-blue', 'reference-spacing'],
    } as unknown as VariableCollection;
    const product = {
      id: 'product',
      name: 'Product Tokens',
      modes: [
        { modeId: 'product-zhina', name: 'Zhina' },
        { modeId: 'product-dark', name: 'Dark' },
      ],
      defaultModeId: 'product-zhina',
      variableIds: ['product-color', 'product-spacing'],
    } as unknown as VariableCollection;

    const referenceBlue = {
      id: 'reference-blue',
      name: 'Reference/Blue/500',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      valuesByMode: {
        'references-light': { r: 0.05, g: 0.6, b: 1 },
        'references-dark': { r: 0.01, g: 0.2, b: 0.4 },
      },
      variableCollectionId: references.id,
    } as unknown as Variable;
    const referenceSpacing = {
      id: 'reference-spacing',
      name: 'Reference/Spacing/16',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      valuesByMode: {
        'references-light': 16,
        'references-dark': 20,
      },
      variableCollectionId: references.id,
    } as unknown as Variable;
    const productColor = {
      id: 'product-color',
      name: 'Color/Primary/Hover',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      valuesByMode: {
        'product-zhina': { type: 'VARIABLE_ALIAS', id: referenceBlue.id },
        'product-dark': { type: 'VARIABLE_ALIAS', id: referenceBlue.id },
      },
      variableCollectionId: product.id,
    } as unknown as Variable;
    const productSpacing = {
      id: 'product-spacing',
      name: 'Spacing/4',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      valuesByMode: {
        'product-zhina': { type: 'VARIABLE_ALIAS', id: referenceSpacing.id },
        'product-dark': { type: 'VARIABLE_ALIAS', id: referenceSpacing.id },
      },
      variableCollectionId: product.id,
    } as unknown as Variable;

    await startPlugin({
      variableCollections: [references, product],
      variables: [referenceBlue, referenceSpacing, productColor, productSpacing],
    });

    const options: ExportOptions = {
      colorFormat: 'hex',
      convertPxToRem: true,
      modesByCollection: { product: ['product-zhina', 'product-dark'] },
      nameStyle: 'lower-dot',
      rootFontSize: 16,
    };
    utilityMocks.handlers.get('EXPORT_TOKENS')?.({
      collectionIds: ['product'],
      operationId: 'export-aliases',
      options,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<
        Parameters<ExportTokensResultHandler['handler']>[0]
      >('EXPORT_TOKENS_RESULT')).toHaveLength(1);
    });

    const result = emittedPayloads<
      Parameters<ExportTokensResultHandler['handler']>[0]
    >('EXPORT_TOKENS_RESULT')[0];
    expect(result.ok).toBe(true);
    expect(result.files?.[0]?.name).toBe('product-tokens-zhina.css');
    expect(result.files?.[0]?.sourceVariableCount).toBe(2);
    expect(result.files?.[0]?.declarationCount).toBe(2);
    expect(result.files?.[0]?.warnings).toEqual([
      expect.objectContaining({
        code: 'mode-fallback',
        message: expect.stringContaining('using Light'),
        sourceCollectionId: 'product',
        sourceModeId: 'product-zhina',
        targetCollectionId: 'references',
        fallbackModeId: 'references-light',
      }),
    ]);
    expect(result.files?.[0]?.css).toContain('--color\\.primary\\.hover: #0d99ff;');
    expect(result.files?.[0]?.css).toContain('--spacing\\.4: 1rem;');
    expect(result.files?.[1]?.name).toBe('product-tokens-dark.css');
    expect(result.files?.[1]?.css).toContain('--color\\.primary\\.hover: #033366;');
    expect(result.files?.[1]?.css).toContain('--spacing\\.4: 1.25rem;');
    expect(result.files?.map((file) => file.css).join('\n')).not.toContain('#000000');

    utilityMocks.handlers.get('EXPORT_TOKENS')?.({
      collectionIds: ['product'],
      operationId: 'export-single-mode',
      options: {
        ...options,
        modesByCollection: { product: ['product-zhina'] },
      },
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<
        Parameters<ExportTokensResultHandler['handler']>[0]
      >('EXPORT_TOKENS_RESULT')).toHaveLength(2);
    });
    const singleModeResult = emittedPayloads<
      Parameters<ExportTokensResultHandler['handler']>[0]
    >('EXPORT_TOKENS_RESULT')[1];
    expect(singleModeResult.files?.[0]?.name).toBe('product-tokens-zhina.css');

    utilityMocks.handlers.get('EXPORT_TOKENS')?.({
      collectionIds: ['product'],
      operationId: 'export-explicit-alias-mode',
      options: {
        ...options,
        modesByCollection: { product: ['product-zhina'] },
        aliasModeOverridesByCollectionMode: {
          product: {
            'product-zhina': {
              references: 'references-dark',
            },
          },
        },
      },
    });
    await vi.waitFor(() => {
      expect(emittedPayloads<
        Parameters<ExportTokensResultHandler['handler']>[0]
      >('EXPORT_TOKENS_RESULT')).toHaveLength(3);
    });
    const explicitModeResult = emittedPayloads<
      Parameters<ExportTokensResultHandler['handler']>[0]
    >('EXPORT_TOKENS_RESULT')[2];
    expect(explicitModeResult.files?.[0]?.css)
      .toContain('--color\\.primary\\.hover: #033366;');
    expect(explicitModeResult.files?.[0]?.css)
      .toContain('--spacing\\.4: 1.25rem;');
    expect(explicitModeResult.files?.[0]?.warnings).toEqual([]);

    utilityMocks.handlers.get('PREVIEW_TOKENS')?.({
      collectionIds: ['product'],
      operationId: 'preview-single-mode',
      options: {
        ...options,
        modesByCollection: { product: ['product-dark'] },
      },
    });
    await vi.waitFor(() => {
      expect(emittedPayloads<
        Parameters<PreviewTokensResultHandler['handler']>[0]
      >('PREVIEW_TOKENS_RESULT')).toHaveLength(1);
    });
    const previewResult = emittedPayloads<
      Parameters<PreviewTokensResultHandler['handler']>[0]
    >('PREVIEW_TOKENS_RESULT')[0];
    expect(previewResult.files?.[0]?.name).toBe('product-tokens-dark.css');
    expect(previewResult.files?.[0]?.css).toContain('--color\\.primary\\.hover: #033366;');
  });

  it('reports skipped values, unresolved aliases, and unknown numeric scopes', async () => {
    const collection = {
      id: 'diagnostics',
      name: 'Diagnostics',
      modes: [{ modeId: 'default', name: 'Default' }],
      defaultModeId: 'default',
      variableIds: [
        'missing',
        'missing-mode',
        'unsupported',
        'unknown-number',
        'unresolved-alias',
      ],
    } as unknown as VariableCollection;
    const missingMode = {
      id: 'missing-mode',
      name: 'Missing/Mode',
      resolvedType: 'STRING',
      scopes: ['ALL_SCOPES'],
      valuesByMode: {},
      variableCollectionId: collection.id,
    } as unknown as Variable;
    const unsupported = {
      id: 'unsupported',
      name: 'Unsupported/Value',
      resolvedType: 'STRING',
      scopes: ['ALL_SCOPES'],
      valuesByMode: { default: { fontFamily: 'Inter' } },
      variableCollectionId: collection.id,
    } as unknown as Variable;
    const unknownNumber = {
      id: 'unknown-number',
      name: 'Unknown/Number',
      resolvedType: 'FLOAT',
      scopes: ['ALL_SCOPES'],
      valuesByMode: { default: 8 },
      variableCollectionId: collection.id,
    } as unknown as Variable;
    const unresolvedAlias = {
      id: 'unresolved-alias',
      name: 'Unresolved/Alias',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      valuesByMode: {
        default: { type: 'VARIABLE_ALIAS', id: 'missing-target' },
      },
      variableCollectionId: collection.id,
    } as unknown as Variable;

    await startPlugin({
      variableCollections: [collection],
      variables: [missingMode, unsupported, unknownNumber, unresolvedAlias],
    });

    utilityMocks.handlers.get('EXPORT_TOKENS')?.({
      collectionIds: [collection.id],
      operationId: 'export-diagnostics',
      options: {
        colorFormat: 'variable',
        convertPxToRem: true,
        modesByCollection: { [collection.id]: ['default'] },
        nameStyle: 'lower-hyphen',
        rootFontSize: 16,
      } satisfies ExportOptions,
    });

    await vi.waitFor(() => {
      expect(emittedPayloads<
        Parameters<ExportTokensResultHandler['handler']>[0]
      >('EXPORT_TOKENS_RESULT')).toHaveLength(1);
    });
    const result = emittedPayloads<
      Parameters<ExportTokensResultHandler['handler']>[0]
    >('EXPORT_TOKENS_RESULT')[0];
    expect(result.files?.[0]).toEqual(expect.objectContaining({
      declarationCount: 2,
      sourceVariableCount: 5,
    }));
    expect(result.files?.[0]?.css).toContain(
      '--unresolved-alias: var(--missing-target);',
    );
    expect(result.files?.[0]?.warnings.map((warning) => warning.code)).toEqual([
      'missing-variable',
      'missing-mode-value',
      'unsupported-value',
      'unknown-number-scope',
      'unresolved-alias',
    ]);
  });
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

  it('counts connected usage, prioritizes high-impact components, and reports broken paths', async () => {
    const { pages } = await startPlugin();
    const connected = createComponent('connected-coverage', 'Connected', {
      sharedPluginData: JSON.stringify({ componentName: 'Connected', importPath: '@acme/ui', schemaVersion: CURRENT_SCHEMA_VERSION }),
    });
    const unconnected = createComponent('unconnected-coverage', 'Unconnected');
    const connectedInstance = createInstance('connected-instance', Promise.resolve(connected));
    const unconnectedInstances = [
      createInstance('unconnected-1', Promise.resolve(unconnected)),
      createInstance('unconnected-2', Promise.resolve(unconnected)),
    ];
    const broken = createInstance('broken-instance', Promise.resolve(null));
    Object.assign(broken, { name: 'Detached button', parent: { name: 'Checkout', parent: { type: 'PAGE' }, type: 'FRAME' } });
    pages.push(createPage('coverage-page', 'Screens', [connected, unconnected, connectedInstance, ...unconnectedInstances, broken]));

    utilityMocks.handlers.get('SCAN_COMPONENTS')?.({ includeCoverage: true, scanId: 'coverage' });
    await vi.waitFor(() => {
      const states = emittedPayloads<{ scanId: string; state: ComponentInventoryState }>('COMPONENT_INVENTORY_STATE');
      expect(states[states.length - 1]).toEqual({
        scanId: 'coverage',
        state: expect.objectContaining({
          coverage: {
            brokenInstanceCount: 1,
            brokenInstances: [{ layerPath: 'Checkout / Detached button', pageName: 'Screens' }],
            connectedInstanceCount: 1,
            totalInstanceCount: 4,
          },
          items: [
            expect.objectContaining({ instanceCount: 2, targetToken: 'unconnected-coverage' }),
            expect.objectContaining({ instanceCount: 1, targetToken: 'connected-coverage' }),
          ],
          status: 'ready',
        }),
      });
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

describe('connection portability orchestration', () => {
  it('exports, previews conflicts without writing, and applies only confirmed overwrites', async () => {
    const { nodesById, pages } = await startPlugin();
    const metadata: ConnectionMetadata = {
      componentName: 'Button',
      importPath: '@acme/ui',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const component = createComponent('portable-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    const page = createPage('components-page', 'Components', [component]);
    Object.assign(component, { parent: page });
    pages.push(page);
    nodesById.set(component.id, component);

    utilityMocks.handlers.get('EXPORT_CONNECTIONS')?.(undefined);
    await vi.waitFor(() => expect(emittedPayloads('EXPORT_CONNECTIONS_RESULT')).toHaveLength(1));
    const exported = emittedPayloads<{ json: string; ok: boolean }>('EXPORT_CONNECTIONS_RESULT')[0];
    expect(JSON.parse(exported.json)).toEqual(expect.objectContaining({ schemaVersion: 1 }));

    utilityMocks.handlers.get('PREVIEW_CONNECTION_IMPORT')?.({ raw: exported.json });
    await vi.waitFor(() => expect(emittedPayloads('PREVIEW_CONNECTION_IMPORT_RESULT')).toHaveLength(1));
    const preview = emittedPayloads<{ entries: Array<{ imported: ConnectionMetadata; status: string; targetToken: string }>; ok: boolean }>('PREVIEW_CONNECTION_IMPORT_RESULT')[0];
    expect(preview.entries).toEqual([expect.objectContaining({ status: 'conflict', targetToken: component.id })]);
    expect(component.setSharedPluginData).not.toHaveBeenCalled();

    utilityMocks.handlers.get('APPLY_CONNECTION_IMPORT')?.({
      choices: [{ action: 'skip', imported: preview.entries[0].imported, targetToken: component.id }],
    });
    await vi.waitFor(() => expect(emittedPayloads('APPLY_CONNECTION_IMPORT_RESULT')).toHaveLength(1));
    expect(component.setSharedPluginData).not.toHaveBeenCalled();

    utilityMocks.handlers.get('APPLY_CONNECTION_IMPORT')?.({
      choices: [{ action: 'overwrite', imported: preview.entries[0].imported, targetToken: component.id }],
    });
    await vi.waitFor(() => expect(emittedPayloads('APPLY_CONNECTION_IMPORT_RESULT')).toHaveLength(2));
    expect(component.setSharedPluginData).toHaveBeenCalledOnce();
  });
});

describe('Storybook generation orchestration', () => {
  it('requires an explicit subset for component sets above 32 variants', async () => {
    const { nodesById } = await startPlugin();
    const metadata: ConnectionMetadata = {
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@acme/ui',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const set = {
      children: [] as ComponentNode[],
      componentProperties: {},
      componentPropertyDefinitions: {},
      getSharedPluginData: vi.fn(() => JSON.stringify(metadata)),
      id: 'large-set',
      key: 'large-set-key',
      name: 'Button',
      parent: { type: 'PAGE' },
      remote: false,
      setSharedPluginData: vi.fn(),
      type: 'COMPONENT_SET',
    } as unknown as ComponentSetNode;
    const variants = Array.from({ length: 33 }, (_, index) => {
      const variant = createComponent(`variant-${index}`, `Size=${index + 1}`);
      Object.assign(variant, { parent: set, variantProperties: { Size: String(index + 1) } });
      nodesById.set(variant.id, variant);
      return variant;
    });
    Object.assign(set, { children: variants });
    nodesById.set(set.id, set);

    utilityMocks.handlers.get('GENERATE_STORIES')?.({ targetToken: set.id });
    await vi.waitFor(() => expect(emittedPayloads('GENERATE_STORIES_RESULT')).toHaveLength(1));
    expect(emittedPayloads<{ ok: boolean; variants: unknown[] }>('GENERATE_STORIES_RESULT')[0])
      .toEqual(expect.objectContaining({ ok: false, variants: expect.any(Array) }));
    expect(emittedPayloads<{ variants: unknown[] }>('GENERATE_STORIES_RESULT')[0].variants).toHaveLength(33);

    utilityMocks.handlers.get('GENERATE_STORIES')?.({
      selectedVariantTokens: [variants[0].id],
      targetToken: set.id,
    });
    await vi.waitFor(() => expect(emittedPayloads('GENERATE_STORIES_RESULT')).toHaveLength(2));
    expect(emittedPayloads<{ code: string; ok: boolean }>('GENERATE_STORIES_RESULT')[1])
      .toEqual(expect.objectContaining({ code: expect.stringContaining('export const Size1'), ok: true }));
  });
});

describe('Code Connect generation orchestration', () => {
  it('returns a downloadable file built from the saved production usage', async () => {
    const { nodesById } = await startPlugin();
    const component = createComponent('code-connect-button', 'Button', {
      sharedPluginData: JSON.stringify({
        childrenMode: 'none',
        componentName: 'Button',
        importPath: '@acme/ui',
        schemaVersion: CURRENT_SCHEMA_VERSION,
      } satisfies ConnectionMetadata),
    });
    nodesById.set(component.id, component);
    utilityMocks.handlers.get('GENERATE_CODE_CONNECT')?.({ targetToken: component.id });
    await vi.waitFor(() => expect(emittedPayloads('GENERATE_CODE_CONNECT_RESULT')).toHaveLength(1));
    expect(emittedPayloads('GENERATE_CODE_CONNECT_RESULT')[0]).toEqual(expect.objectContaining({
      code: expect.stringContaining('figma.connect(Button'),
      fileName: 'Button.figma.tsx',
      ok: true,
    }));
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

    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: [
          'import { Button, Icon } from "tashil-ui";',
          '',
          '<Button renderRightIcon={<Icon name="shield" />} renderLeftIcon={<Icon name="contract-check" />} />',
        ].join('\n'),
        language: 'TYPESCRIPT',
      }),
    ]));
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

    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringContaining('<Button tone={"safe"} />'),
        language: 'TYPESCRIPT',
      }),
    ]));
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
          output: expect.objectContaining({
            references: {
              sourcePath: metadata.sourcePath,
              sourceUrl: metadata.sourceUrl,
              storybookUrl: metadata.storybookUrl,
              updatedAt: metadata.updatedAt,
            },
          }),
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
          output: expect.objectContaining({
            references: expect.objectContaining({
              sourceUrl: metadata.sourceUrl,
              storybookUrl: metadata.storybookUrl,
            }),
          }),
          status: 'connected',
        }),
      );
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });
    expect(blocks?.[0]).toMatchObject({
      language: 'TYPESCRIPT',
      title: 'Generated Code',
    });
    expect(blocks?.find(({ title }) => title === 'References')?.code).toBe([
      'Storybook: javascript:legacy-reference',
      'Source URL: file:///tmp/LegacyButton.tsx',
    ].join('\n'));
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

    expect(blocks).toContainEqual(
      expect.objectContaining({
        code: expect.stringContaining(expectedMessage),
        language: 'PLAINTEXT',
      }),
    );
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
    expect(blocks).toContainEqual(
      expect.objectContaining({
        code: expect.stringMatching(/newer.*update the plugin/i),
        language: 'PLAINTEXT',
      }),
    );
  });
});

describe('Dev Mode inspection codegen', () => {
  it('generates a not-connected message, Layout, and Style for an unconnected component', async () => {
    const { codegenEvents, selection } = await startPlugin();
    const component = createComponent('c-unconnected-card', 'Account card');
    Object.assign(component, {
      children: [],
      getCSSAsync: vi.fn(() => Promise.resolve({
        display: 'flex',
        'flex-direction': 'column',
        'background-color': 'var(--color-surface)',
      })),
      itemSpacing: 0,
      layoutMode: 'VERTICAL',
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    expect(blocks?.find((block) => block.title === "⚠️ This component isn't connected to code.")).toMatchObject({
      language: 'PLAINTEXT',
      code: '💬 Ask the Design System Owner',
    });
    expect(blocks?.find((block) => block.title === 'Layout')?.code).toBe(
      'display: flex;\nflex-direction: column;',
    );
    expect(blocks?.find((block) => block.title === 'Style')?.code).toBe(
      'background-color: var(--color-surface);',
    );

    selection.push(component);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          inspection: expect.objectContaining({
            css: {
              layout: expect.arrayContaining([
                { property: 'display', value: 'flex' },
              ]),
              style: expect.arrayContaining([
                {
                  property: 'background-color',
                  value: 'var(--color-surface)',
                },
              ]),
            },
          }),
          layout: expect.objectContaining({
            componentName: 'AccountCard',
            tsx: expect.stringContaining('export function AccountCard()'),
          }),
          status: 'layout',
        }),
      );
    });
  });

  it('generates a not-connected message and CSS when the unconnected selection is an instance', async () => {
    const { codegenEvents, selection } = await startPlugin();
    const mainComponent = createComponent('c-unconnected-banner', 'Banner');
    const instance = createInstance(
      'i-unconnected-banner',
      Promise.resolve(mainComponent),
    );
    Object.assign(instance, {
      children: [],
      getCSSAsync: vi.fn(() => Promise.resolve({
        display: 'flex',
        'border-radius': '8px',
      })),
      itemSpacing: 0,
      layoutMode: 'HORIZONTAL',
      name: 'Promo banner',
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      parent: {
        parent: { type: 'PAGE' },
        type: 'FRAME',
      },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: instance });

    expect(blocks?.find((block) => block.title === "⚠️ This component isn't connected to code.")).toBeDefined();
    expect(blocks?.find((block) => block.title === 'Layout')?.code)
      .toBe('display: flex;');
    expect(blocks?.find((block) => block.title === 'Style')?.code)
      .toBe('border-radius: 8px;');

    selection.push(instance);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);
    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          inspection: expect.objectContaining({
            diagnostics: expect.arrayContaining([
              expect.objectContaining({
                reason: 'unconnected-instance',
              }),
            ]),
          }),
          layout: expect.objectContaining({
            componentName: 'PromoBanner',
            tsx: expect.stringContaining('export function PromoBanner()'),
          }),
          showUnconnectedComponents: true,
          status: 'layout',
        }),
      );
    });
  });

  it('generates full React without a badge for a selection inside a main component', async () => {
    const { selection } = await startPlugin();
    const mainComponent = createComponent('c-main-banner', 'Banner');
    const iconComponent = createComponent('c-main-banner-icon', 'Banner icon');
    const nestedInstance = createInstance(
      'i-main-banner-icon',
      Promise.resolve(iconComponent),
    );
    Object.assign(nestedInstance, {
      children: [],
      getCSSAsync: vi.fn(() => Promise.resolve({
        display: 'flex',
        padding: 'spacing.6',
      })),
      itemSpacing: 0,
      layoutMode: 'HORIZONTAL',
      name: 'Banner icon',
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      parent: mainComponent,
    });

    selection.push(nestedInstance);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          layout: expect.objectContaining({
            componentName: 'BannerIcon',
            tsx: expect.stringContaining('export function BannerIcon()'),
          }),
          status: 'layout',
        }),
      );
    });

    const layoutState = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .find((state) => state.status === 'layout');
    expect(layoutState).not.toHaveProperty('showUnconnectedComponents');
  });

  it('shows typed variant logic when a main variant component is selected', async () => {
    const { codegenEvents, selection } = await startPlugin();
    const variants: ComponentNode[] = [];
    const componentSet = {
      children: variants,
      componentProperties: {},
      componentPropertyDefinitions: {
        Size: {
          defaultValue: 'Small',
          type: 'VARIANT',
          variantOptions: ['Small', 'Large'],
        },
        Style: {
          defaultValue: 'Secondary',
          type: 'VARIANT',
          variantOptions: ['Primary', 'Secondary'],
        },
      },
      defaultVariant: undefined,
      getSharedPluginData: vi.fn(() => ''),
      id: 'set-button',
      name: 'Button',
      parent: { type: 'PAGE' },
      remote: false,
      setSharedPluginData: vi.fn(),
      type: 'COMPONENT_SET',
    } as unknown as ComponentSetNode;
    const selectedVariant = createComponent(
      'button-large-primary',
      'Style=Solid, Size=Small, State=Rest, Single icon=Yes',
    );
    const secondaryVariant = createComponent('button-small-secondary', 'Small, Secondary');
    Object.assign(selectedVariant, {
      children: [],
      getCSSAsync: vi.fn(() => Promise.resolve({
        display: 'inline-flex',
        gap: 'spacing.0',
        padding: 'spacing.6 spacing.12',
        'border-radius': 'radius.4',
        background: 'colors.bg.primary.default',
      })),
      itemSpacing: 0,
      layoutMode: 'HORIZONTAL',
      paddingBottom: 0,
      paddingLeft: 0,
      paddingRight: 0,
      paddingTop: 0,
      parent: componentSet,
      variantProperties: { Size: 'Large', Style: 'Primary' },
    });
    Object.assign(secondaryVariant, {
      parent: componentSet,
      variantProperties: { Size: 'Small', Style: 'Secondary' },
    });
    variants.push(selectedVariant, secondaryVariant);
    Object.assign(componentSet, { defaultVariant: secondaryVariant });

    const blocks = await codegenEvents.get('generate')?.({ node: selectedVariant });
    const notConnected = blocks?.find((block) => block.title === "⚠️ This component isn't connected to code.");
    const logic = blocks?.find((block) => block.title === 'Variant logic');

    expect(notConnected).toBeDefined();
    expect(logic).toMatchObject({ language: 'TYPESCRIPT' });
    expect(logic?.code).toContain('export type ButtonVariantProps');
    expect(logic?.code).toContain('size?: "Small" | "Large";');
    expect(logic?.code).toContain('style?: "Primary" | "Secondary";');
    expect(logic?.code).toContain('size: "Large"');
    expect(logic?.code).toContain('style: "Primary"');
    expect(logic?.code).toContain('export function resolveButtonVariant');

    selection.push(selectedVariant);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);
    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          status: 'layout',
          layout: expect.objectContaining({
            componentName: 'Button',
            nodeName: 'Button',
          }),
          variantLogic: expect.objectContaining({
            axisCount: 2,
            combinationCount: 2,
            code: expect.stringContaining('resolveButtonVariant'),
          }),
        }),
      );
    });
    const layoutState = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .find((state) => state.status === 'layout');
    expect(layoutState).not.toHaveProperty('connectionStatus');
  });

  it('returns the same generated TSX through Dev Mode and Inspect Code', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@tashilcar/ui',
    };
    const { codegenEvents, selection } = await startPlugin();
    const button = createComponent('c-parity-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    const frame = createFrame('f-parity', 'Parity layout', [
      createInstance('i-parity-button', Promise.resolve(button)),
    ], {
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      css: { display: 'flex', gap: '12px' },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: frame });
    const devModeTsx = blocks?.find((block) => block.title === 'Generated Code')?.code;

    selection.push(frame);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);
    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE'))
        .toContainEqual(expect.objectContaining({ status: 'layout' }));
    });
    const inspectState = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .find((state) => state.status === 'layout') as Extract<
        InspectCodeState,
        { status: 'layout' }
      >;

    expect(devModeTsx).toBe(inspectState.layout.tsx);
  });

  it('returns Frame TSX, Layout, and Style CSS blocks for a frame selection', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@tashilcar/ui',
    };
    const { codegenEvents } = await startPlugin();
    const button = createComponent('c-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    const frame = createFrame('f-root', 'Payment form', [
      createInstance('i-button', Promise.resolve(button)),
    ], {
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      css: {
        display: 'flex',
        'flex-direction': 'column',
        gap: 'var(--spacer-3, 1rem)',
        'border-bottom': '1px solid var(--color-border)',
      },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: frame });

    const layout = blocks?.find((b) => b.title === 'Layout');
    const style = blocks?.find((b) => b.title === 'Style');
    const react = blocks?.find((b) => b.title === 'Generated Code');
    expect(react).toMatchObject({ language: 'TYPESCRIPT' });
    expect(react?.code).toContain('export function PaymentForm()');
    expect(react?.code).toContain('import styled from "styled-components";');
    expect(react?.code).toContain('<Button');
    expect(react?.code).toContain('const PaymentFormRoot = styled.div`');
    expect(react?.code).toContain('gap: var(--spacer-3, 1rem);');
    expect(blocks?.some((b) => b.title.endsWith('.module.css'))).toBe(false);
    expect(layout).toMatchObject({ language: 'CSS' });
    expect(layout?.code).toBe(
      'display: flex;\nflex-direction: column;\ngap: var(--spacer-3, 1rem);',
    );
    expect(style).toMatchObject({ language: 'CSS' });
    expect(style?.code).toBe('border-bottom: 1px solid var(--color-border);');
    expect(blocks?.some((b) => b.title === 'Connected components')).toBe(false);
  });

  it('extracts raw content for a text layer', async () => {
    const { codegenEvents } = await startPlugin();
    const textNode = {
      id: 't1',
      name: 'Headline',
      type: 'TEXT',
      characters: 'Welcome to Tashil',
      parent: { type: 'PAGE' },
      getCSSAsync: vi.fn(() => Promise.resolve({
        color: '#111111',
        'font-size': '24px',
      })),
    } as unknown as SceneNode;

    const blocks = await codegenEvents.get('generate')?.({ node: textNode });
    expect(blocks?.find((b) => b.title === 'Content')).toMatchObject({
      code: 'Welcome to Tashil',
      language: 'PLAINTEXT',
    });
    expect(blocks?.find((b) => b.title === 'Style')?.code).toBe('color: #111111;\nfont-size: 24px;');
  });

  it('combines selected connected instances in order and reports unsupported selections', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@tashilcar/ui',
    };
    const { codegenEvents, selection } = await startPlugin();
    const button = createComponent('multi-button', 'Button', { sharedPluginData: JSON.stringify(metadata) });
    const first = createInstance('first-button', Promise.resolve(button));
    const unsupported = createFrame('unsupported-frame', 'Loose frame', []);
    const second = createInstance('second-button', Promise.resolve(button));
    selection.push(first, unsupported, second);

    const blocks = await codegenEvents.get('generate')?.({ node: first });
    expect(blocks?.[0].title).toBe('Selected components (2)');
    expect(blocks?.[0].code.match(/import \{ Button \}/g)).toHaveLength(1);
    expect(blocks?.[0].code.indexOf('//./ first-button')).toBeLessThan(
      blocks?.[0].code.indexOf('//./ second-button') ?? 0,
    );
    expect(blocks?.find(({ title }) => title === 'Selection notes')?.code)
      .toContain('Loose frame: unsupported selection.');
  });

  it('bounds combined Dev Mode output at 50 selected layers', async () => {
    const { codegenEvents, selection } = await startPlugin();
    const layers = Array.from({ length: 51 }, (_, index) => createFrame(`frame-${index}`, `Frame ${index}`, []));
    selection.push(...layers);
    const blocks = await codegenEvents.get('generate')?.({ node: layers[0] });
    expect(blocks).toEqual([expect.objectContaining({
      code: 'Select no more than 50 layers for combined output.',
      language: 'PLAINTEXT',
    })]);
  });

  it('omits the Style block when the node has no style declarations', async () => {
    const { codegenEvents } = await startPlugin();
    const frame = createFrame('f-plain', 'Plain', [], {
      css: { display: 'flex', 'flex-direction': 'row' },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: frame });

    expect(blocks?.some((b) => b.title === 'Style')).toBe(false);
    expect(blocks?.find((b) => b.title === 'Layout')?.code).toBe(
      'display: flex;\nflex-direction: row;',
    );
  });

  it('generates Connected Component blocks including usage, references, layout, and style', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: 'tashil-ui',
      storybookUrl: 'https://storybook.example.com/?path=/story/button',
    };
    const { codegenEvents } = await startPlugin();
    const component = createComponent('c-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    Object.assign(component, {
      getCSSAsync: vi.fn(() => Promise.resolve({ display: 'inline-flex', padding: '8px 16px' })),
    });

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    expect(blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: 'Generated Code',
        code: expect.stringContaining('<Button'),
        language: 'TYPESCRIPT',
      }),
      expect.objectContaining({
        title: 'References',
        language: 'PLAINTEXT',
      }),
      expect.objectContaining({
        title: 'Layout',
        language: 'CSS',
      }),
    ]));
  });

  it('inspects any node type — a vector gets its CSS, not a rejection', async () => {
    const { codegenEvents } = await startPlugin();
    const vector = {
      id: 'v1',
      name: 'Divider',
      type: 'VECTOR',
      parent: { type: 'PAGE' },
      getCSSAsync: vi.fn(() => Promise.resolve({ width: '120px', fill: 'var(--color-border)' })),
    } as unknown as SceneNode;

    const blocks = await codegenEvents.get('generate')?.({ node: vector });

    expect(blocks?.find((b) => b.title === 'Layout')?.code).toBe('width: 120px;');
    expect(blocks?.find((b) => b.title === 'Style')?.code).toBe('fill: var(--color-border);');
  });

  it('generates a non-auto-layout frame without an unsupported positioning warning', async () => {
    const { codegenEvents } = await startPlugin();
    const noneFrame = createFrame('f-none', 'Absolute frame', [], {
      layoutMode: 'NONE',
      css: { width: '320px', height: '200px' },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: noneFrame });

    expect(blocks?.find((b) => b.title === 'Layout')?.code).toBe('width: 320px;\nheight: 200px;');
    expect(blocks?.find((b) => b.title === 'Generated Code')?.code)
      .toContain('export function AbsoluteFrame()');
  });

  it('skips heavy React generation and emits a tip when a frame has more than 150 layers', async () => {
    const { codegenEvents } = await startPlugin();
    const children = Array.from({ length: 151 }, (_, index) =>
      createFrame(`child-${index}`, `Child ${index}`, [], {
        css: { display: 'block' },
      }),
    );
    const largeFrame = createFrame('f-large', 'Full Dashboard Screen', children, {
      css: {
        display: 'flex',
        'flex-direction': 'column',
        'background-color': '#f8f9fa',
      },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: largeFrame });

    const generatedCode = blocks?.find((b) => b.title === 'Generated Code');
    expect(generatedCode).toMatchObject({
      language: 'PLAINTEXT',
      code: expect.stringContaining('⚠️ This frame contains too many layers for full React generation.'),
    });
    expect(generatedCode?.code).toContain('💡 Tip: Select a specific section');
    expect(blocks?.find((b) => b.title === 'Layout')?.code).toBe('display: flex;\nflex-direction: column;');
    expect(blocks?.find((b) => b.title === 'Style')?.code).toBe('background-color: #f8f9fa;');
  });

  it('emits an Effect style comment before box-shadow when effectStyleId is set', async () => {
    const { codegenEvents } = await startPlugin({
      effectStyles: [
        { id: 'S:elevation-md', name: 'Elevation / Shadow-MD' } as EffectStyle,
      ],
    });
    const shadowFrame = createFrame('f-shadow', 'Shadow Frame', [], {
      effectStyleId: 'S:elevation-md',
      css: {
        width: '320px',
        height: '200px',
        'box-shadow': '0px 4px 6px -1px rgba(0, 0, 0, 0.1)',
      },
    });

    const blocks = await codegenEvents.get('generate')?.({ node: shadowFrame });

    const styleBlock = blocks?.find((b) => b.title === 'Style');
    expect(styleBlock?.code).toContain('/* elevation_shadow_md */\nbox-shadow: 0px 4px 6px -1px rgba(0, 0, 0, 0.1);');
  });
});

describe('Inspect Code inspection state', () => {
  it('emits a complete React layout with connected components for a frame', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: '@tashilcar/ui',
    };
    const { selection } = await startPlugin();
    const button = createComponent('c-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    const frame = createFrame('f-root', 'Payment form', [
      createInstance('i-button', Promise.resolve(button)),
    ], {
      layoutMode: 'VERTICAL',
      itemSpacing: 16,
      css: { display: 'flex', 'border-bottom': '1px solid var(--color-border)' },
    });
    selection.push(frame);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      const states = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE');
      expect(states).toContainEqual(
        expect.objectContaining({ status: 'layout' }),
      );
    });

    const state = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .find((s) => s.status === 'layout') as Extract<InspectCodeState, { status: 'layout' }>;
    expect(state.layout.nodeName).toBe('Payment form');
    expect(state.layout.nodeType).toBe('FRAME');
    expect(state.layout.componentName).toBe('PaymentForm');
    expect(state.layout.componentCount).toBe(1);
    expect(state.layout.tsx).toContain('export function PaymentForm()');
    expect(state.layout.tsx).toContain('<Button');
    expect(state.layout.tsx).toContain('const PaymentFormRoot = styled.div`');
    expect(state.layout.tsx).toContain('gap: 16px;');
    expect(state.showUnconnectedComponents).toBe(true);
  });

  it('does not mark a generated layer inside a main component as unconnected', async () => {
    const { selection } = await startPlugin();
    const mainComponent = createComponent('c-card', 'Card');
    const contentFrame = createFrame('f-card-content', 'Card content', [], {
      css: { display: 'flex' },
    });
    Object.assign(contentFrame, { parent: mainComponent });
    Object.assign(mainComponent, { children: [contentFrame] });
    selection.push(contentFrame);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      expect(emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')).toContainEqual(
        expect.objectContaining({
          layout: expect.objectContaining({
            nodeName: 'Card content',
            tsx: expect.stringContaining('export function CardContent()'),
          }),
          status: 'layout',
        }),
      );
    });

    const state = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .find((item) =>
        item.status === 'layout' && item.layout.nodeName === 'Card content');
    expect(state).not.toHaveProperty('showUnconnectedComponents');
  });

  it('keeps a connected component emitting { status: connected, output }', async () => {
    const metadata: ConnectionMetadata = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      childrenMode: 'none',
      componentName: 'Button',
      importPath: 'tashil-ui',
    };
    const { selection } = await startPlugin();
    const component = createComponent('c-button', 'Button', {
      sharedPluginData: JSON.stringify(metadata),
    });
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      const states = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE');
      expect(states).toContainEqual(
        expect.objectContaining({
          status: 'connected',
          output: expect.objectContaining({ code: expect.stringContaining('<Button') }),
        }),
      );
    });
  });

  it('discards a stale React layout when the selection changes mid-generation', async () => {
    const { selection } = await startPlugin();
    const slowMainComponent = createDeferred<ComponentNode | null>();
    const slowFrame = createFrame('f-slow', 'Slow frame', [
      createInstance('i-slow', slowMainComponent.promise),
    ]);
    const fastFrame = createFrame('f-fast', 'Fast frame', [], {
      css: { display: 'flex' },
    });

    // Start resolving a connected descendant, then switch selection before its
    // main component resolves. The stale tree must never be published.
    selection.push(slowFrame);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);
    selection.length = 0;
    selection.push(fastFrame);
    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);
    slowMainComponent.resolve(null);

    await vi.waitFor(() => {
      const states = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE');
      expect(states).toContainEqual(
        expect.objectContaining({
          status: 'layout',
          layout: expect.objectContaining({ nodeName: 'Fast frame' }),
        }),
      );
    });

    const layouts = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
      .filter((state) => state.status === 'layout') as Array<
        Extract<InspectCodeState, { status: 'layout' }>
      >;
    expect(layouts.every((state) => state.layout.nodeName === 'Fast frame')).toBe(true);
  });

  it('emits an inspection state for any node type, including a vector', async () => {
    const { selection } = await startPlugin();
    const vector = {
      id: 'v1',
      name: 'Divider',
      type: 'VECTOR',
      parent: { type: 'PAGE' },
      getCSSAsync: vi.fn(() => Promise.resolve({ width: '120px' })),
    } as unknown as SceneNode;
    selection.push(vector);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(() => {
      const states = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE');
      expect(states).toContainEqual(
        expect.objectContaining({
          status: 'inspection',
          inspection: expect.objectContaining({ nodeType: 'VECTOR' }),
        }),
      );
    });
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

describe('semantic connection generation', () => {
  const APPROVED_DIALOG_CODE = [
    'import { ConfirmationDialog } from "@tashilcar/ui";',
    '',
    '<ConfirmationDialog',
    '  intent={"danger"}',
    '  title={"Delete account?"}',
    '  description={"This action cannot be undone."}',
    '  cancelAction={{ label: "Cancel" }}',
    '  confirmAction={{ label: "Delete" }}',
    '  onConfirm={onConfirm /* Set in application. */}',
    '/>',
  ].join('\n');

  function createButtonMain(): ComponentNode {
    return {
      getSharedPluginData: vi.fn(() => ''),
      id: 'button-main',
      key: 'button-main-key',
      name: 'Button',
      parent: { type: 'PAGE' },
      type: 'COMPONENT',
    } as unknown as ComponentNode;
  }

  function createDialogChildren(overrides?: { title?: string }): SceneNode[] {
    const buttonMain = createButtonMain();
    return [
      {
        children: [
          {
            characters: overrides?.title ?? 'Delete account?',
            name: 'Title',
            type: 'TEXT',
          },
          {
            characters: 'This action cannot be undone.',
            name: 'Description',
            type: 'TEXT',
          },
        ],
        name: 'Header',
        type: 'FRAME',
      },
      {
        children: [
          {
            componentProperties: {
              'label#1:0': { type: 'TEXT', value: 'Cancel' },
            },
            getMainComponentAsync: vi.fn(() => Promise.resolve(buttonMain)),
            name: 'Secondary action',
            type: 'INSTANCE',
          },
          {
            componentProperties: {
              'label#1:0': { type: 'TEXT', value: 'Delete' },
            },
            getMainComponentAsync: vi.fn(() => Promise.resolve(buttonMain)),
            name: 'Primary action',
            type: 'INSTANCE',
          },
        ],
        name: 'Footer',
        type: 'FRAME',
      },
    ] as unknown as SceneNode[];
  }

  function createSemanticDialogComponent(): ComponentDouble {
    const component = createComponent('dialog-main', 'Dialog', {
      componentProperties: {
        intent: { type: 'VARIANT', value: 'Danger' },
      } as unknown as InstanceNode['componentProperties'],
      sharedPluginData: JSON.stringify({
        componentName: 'ConfirmationDialog',
        importPath: '@tashilcar/ui',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        semanticRecipe: createDialogRecipe(),
      }),
    });
    (component as unknown as { children: SceneNode[] }).children = createDialogChildren();
    return component;
  }

  it('generates the approved semantic TSX with runtime requirements in Notes in Dev Mode', async () => {
    const { codegenEvents } = await startPlugin();
    const component = createSemanticDialogComponent();

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    expect(blocks?.[0]).toEqual({
      title: 'Generated Code',
      language: 'TYPESCRIPT',
      code: APPROVED_DIALOG_CODE,
    });

    const titles = blocks?.map((block) => block.title);
    expect(titles).toContain('Notes');

    const notesBlock = blocks?.find((block) => block.title === 'Notes');
    expect(notesBlock?.code).toContain('onConfirm: () => void');
  });

  it('emits a Notes block with deprecation info but still generates code for a deprecated recipe', async () => {
    const { codegenEvents } = await startPlugin();
    const recipe = { ...createDialogRecipe(), lifecycle: { replacement: 'Use AlertDialog instead.', state: 'deprecated' as const } };
    const component = createComponent('dialog-main', 'Dialog', {
      componentProperties: {
        intent: { type: 'VARIANT', value: 'Danger' },
      } as unknown as InstanceNode['componentProperties'],
      sharedPluginData: JSON.stringify({
        componentName: 'ConfirmationDialog',
        importPath: '@tashilcar/ui',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        semanticRecipe: recipe,
      }),
    });
    (component as unknown as { children: SceneNode[] }).children = createDialogChildren();

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    const notesBlock = blocks?.find((block) => block.title === 'Notes');
    expect(notesBlock?.code).toContain('ConfirmationDialog is deprecated. Use AlertDialog instead.');
    // The production code is still emitted in full.
    expect(blocks?.[0].code).toBe(APPROVED_DIALOG_CODE);
  });

  it('returns the identical semantic result through Inspect Code', async () => {
    const { codegenEvents, selection } = await startPlugin();
    const component = createSemanticDialogComponent();
    selection.push(component);

    utilityMocks.handlers.get('REFRESH_SELECTION')?.(undefined);

    await vi.waitFor(async () => {
      const connectedState = emittedPayloads<InspectCodeState>('INSPECT_CODE_STATE')
        .find((state) => state.status === 'connected');
      expect(connectedState).toBeDefined();

      const devBlocks = await codegenEvents.get('generate')?.({ node: component });
      const output = (connectedState as Extract<InspectCodeState, { status: 'connected' }>).output;

      expect(output.code).toBe(devBlocks?.[0].code);
      expect(output.code).toBe(APPROVED_DIALOG_CODE);
      expect(output.diagnostics).toBeUndefined();
      expect(output.runtimeRequirements).toBe('onConfirm: () => void');
      expect(output.explanation).toContain('onConfirm (runtime) — Provided by application code.');
    });
  });

  it('resolves nested text from the selected instance so overrides win', async () => {
    const { codegenEvents } = await startPlugin();
    const component = createSemanticDialogComponent();
    const instance = createInstance(
      'dialog-instance',
      Promise.resolve(component as unknown as ComponentNode),
      {
        intent: { type: 'VARIANT', value: 'Danger' },
      } as unknown as InstanceNode['componentProperties'],
    );
    (instance as unknown as { children: SceneNode[] }).children = createDialogChildren({
      title: 'Remove file?',
    });

    const blocks = await codegenEvents.get('generate')?.({ node: instance });

    expect(blocks?.[0].code).toContain('title={"Remove file?"}');
    expect(blocks?.[0].code).not.toContain('Delete account?');
  });

  it('reports a broken required locator as a mapping diagnostic without hiding the rest', async () => {
    const { codegenEvents } = await startPlugin();
    const component = createSemanticDialogComponent();
    const children = (component as unknown as { children: SceneNode[] }).children;
    (component as unknown as { children: SceneNode[] }).children = children.filter(
      (child) => child.name !== 'Header',
    );

    const blocks = await codegenEvents.get('generate')?.({ node: component });

    const notesBlock = blocks?.find((block) => block.title === 'Notes');
    expect(notesBlock?.code).toContain('"title"');
    expect(blocks?.[0].code).toContain('cancelAction={{ label: "Cancel" }}');
    expect(blocks?.[0].code).not.toContain('title=');
  });

  it('rejects saving metadata whose semantic recipe is malformed', async () => {
    const { selection } = await startPlugin();
    const component = createComponent('dialog-main', 'Dialog');
    selection.push(component);

    const recipe = createDialogRecipe();
    (recipe.bindings[0].target.path as string[]) = ['not a valid segment'];

    utilityMocks.handlers.get('SAVE_CONNECTION')?.({
      metadata: {
        componentName: 'ConfirmationDialog',
        importPath: '@tashilcar/ui',
        schemaVersion: CURRENT_SCHEMA_VERSION,
        semanticRecipe: recipe,
      },
      operationId: 'save-semantic-invalid',
      targetToken: component.id,
    });

    await vi.waitFor(() => {
      const results = utilityMocks.emit.mock.calls
        .filter(([name]) => name === 'SAVE_RESULT')
        .map(([, payload]) => payload as { ok: boolean; operationId: string });
      expect(results).toContainEqual(
        expect.objectContaining({ ok: false, operationId: 'save-semantic-invalid' }),
      );
    });
    expect(component.setSharedPluginData).not.toHaveBeenCalled();
  });
});
