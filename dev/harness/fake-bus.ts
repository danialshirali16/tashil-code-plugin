/**
 * A stand-in for `@create-figma-plugin/utilities` so the plugin UI can run in a
 * normal browser.
 *
 * The UI never touches the Figma API directly — it only exchanges messages with
 * the main thread. Replacing that one module is therefore enough to render the
 * real `Plugin` component outside Figma, which is what makes visual review
 * possible: a rendering fault such as a control painting over its own label is
 * invisible to jsdom tests but obvious here.
 *
 * The scenarios below are built with the production extractor and authoring
 * modules, so the UI receives the same shapes the plugin would send it.
 */

import { createRecipeDraft } from '../../src/semantic/authoring';
import type { DesignHealthScanResult, TokenPropertyIssue, TokenSuggestion } from '../../src/design-health/types';
import type { TokenGroupingDepth } from '../../src/documentation/types';
import { extractFigmaSemanticSnapshot } from '../../src/semantic/figma-extractor';
import { extractSourceContract } from '../../src/semantic/source-contract';
import { serializeTokenCollection } from '../../src/sync-tokens/serialize-formats';
import type {
  ExportFile,
  ExportOptions,
  Token,
  TokenCollection,
} from '../../src/sync-tokens/types';
import { CURRENT_SCHEMA_VERSION } from '../../src/types';
import type {
  ComponentInventoryState,
  ConnectionMetadata,
  FigmaComponentSnapshot,
  InspectCodeState,
  UiTargetState,
} from '../../src/types';

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();
const appliedLibraryUpdateNodeIds = new Set<string>();

// The official Create Figma Plugin controls import these sentinel values from
// the utilities package. The harness aliases that package to this module, so it
// needs to expose the same small public surface.
export const MIXED_BOOLEAN = null;
export const MIXED_NUMBER = null;
export const MIXED_STRING = null;

export function evaluateNumericExpression(value: string): number | null {
  if (!/^-?\d*\.?\d+(?:\s*[+\-*/]\s*\d*\.?\d+)*$/.test(value.trim())) {
    return null;
  }

  // The harness only needs the official numeric textbox's common number case.
  return Number(value);
}

export function isValidNumericInput(
  value: string,
  options: { integersOnly?: boolean } = {},
): boolean {
  if (value === '' || value === '-') {
    return true;
  }
  return options.integersOnly === true
    ? /^-?\d*$/.test(value)
    : /^-?\d*\.?\d*$/.test(value);
}

export function convertHexColorToRgbColor(
  hexColor: string,
): { r: number; g: number; b: number } | null {
  const normalized = hexColor.replace(/^#/, '');
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(normalized)) {
    return null;
  }
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((character) => `${character}${character}`)
          .join('')
      : normalized;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16) / 255,
    g: Number.parseInt(expanded.slice(2, 4), 16) / 255,
    b: Number.parseInt(expanded.slice(4, 6), 16) / 255,
  };
}

export function convertRgbColorToHexColor(color: {
  r: number;
  g: number;
  b: number;
}): string | null {
  const values = [color.r, color.g, color.b];
  if (values.some((value) => value < 0 || value > 1)) {
    return null;
  }
  return values
    .map((value) => Math.round(value * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function convertNamedColorToHexColor(namedColor: string): string | null {
  const namedColors: Record<string, string> = {
    black: '000000',
    transparent: '000000',
    white: 'FFFFFF',
  };
  return namedColors[namedColor.toLowerCase()] ?? null;
}

export function isValidHexColor(hexColor: string): boolean {
  return convertHexColorToRgbColor(hexColor) !== null;
}

export function on(name: string, handler: Handler): () => void {
  const set = handlers.get(name) ?? new Set<Handler>();
  set.add(handler);
  handlers.set(name, set);
  return () => set.delete(handler);
}

/** UI → main. Answered below the way the real main thread would answer. */
export function emit(name: string, payload?: unknown): void {
  window.setTimeout(() => respond(name, payload), 0);
}

export function showUI(): void {
  // Only meaningful inside Figma.
}

function send(name: string, payload: unknown): void {
  for (const handler of handlers.get(name) ?? []) {
    handler(payload);
  }
}

/**
 * Transient harness-only acknowledgment for canvas-side actions: the real
 * canvas reaction cannot happen in a browser, but the click must be
 * observable for the visual gate. Deliberately does NOT synthesize
 * INSPECT_CODE_STATE — that would bump the Design Health rescan sequence
 * and diverge from production behavior.
 */
function notifyHarness(message: string): void {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.setAttribute('role', 'status');
  Object.assign(toast.style, {
    background: 'var(--figma-color-bg, #ffffff)',
    border: '1px solid var(--figma-color-border, #cccccc)',
    borderRadius: '6px',
    bottom: '24px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    color: 'var(--figma-color-text, #333333)',
    font: '11px Inter, sans-serif',
    left: '50%',
    padding: '8px 12px',
    position: 'fixed',
    transform: 'translateX(-50%)',
    zIndex: '1000',
  });
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2200);
}

/** Resolve a fixture node id to its display name so the ack reads like Figma would. */
function harnessNodeName(nodeId: string | undefined): string {
  if (!nodeId) {
    return 'Unknown layer';
  }
  const result = designHealthScanResult('harness-lookup');
  const issue = result.tokenAudit.issues.find((candidate) => candidate.nodeId === nodeId);
  if (issue) {
    return issue.nodeName;
  }
  const deprecated = result.libraryHealth.deprecatedInstances.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  if (deprecated) {
    return deprecated.instanceName;
  }
  const update = result.libraryHealth.updateAvailableInstances.find(
    (candidate) => candidate.nodeId === nodeId,
  );
  return update?.instanceName ?? nodeId;
}

// ---------------------------------------------------------------------------
// Fixture: a Button whose Figma structure does not match its source API.
// ---------------------------------------------------------------------------

const BUTTON_SOURCE = `
import { ReactNode, MouseEventHandler } from 'react';

export type ButtonSizeType = 'small' | 'medium' | 'large';
export type ButtonColorType = 'primary' | 'secondary' | 'neutral';
export type ButtonVariantType = 'solid' | 'outline' | 'ghost';

export interface ButtonProps {
  size?: ButtonSizeType;
  color?: ButtonColorType;
  variant?: ButtonVariantType;
  disabled?: boolean;
  fullWidth?: boolean;
  loading?: boolean;
  iconOnly?: boolean;
  children?: string;
  renderLeftIcon?: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
}
`;

const FIGMA_SNAPSHOT: FigmaComponentSnapshot = {
  componentId: '1094:17504',
  componentName: 'Button',
  properties: [
    { id: 'p-size', name: 'size', options: ['sm', 'md'], rawKey: 'size', type: 'VARIANT' },
    {
      defaultValue: 'Default',
      id: 'p-state',
      name: 'State',
      options: ['Default', 'Hover', 'Pressed', 'Disabled'],
      rawKey: 'State',
      type: 'VARIANT',
    },
    { defaultValue: false, id: 'p-icon', name: 'hasLeadingIcon', options: ['False', 'True'], rawKey: 'hasLeadingIcon', type: 'BOOLEAN' },
    { id: 'p-label', name: 'label', options: [], rawKey: 'label', type: 'TEXT' },
  ],
};

/** The Figma layer tree the semantic extractor walks. */
const BUTTON_NODE = {
  children: [
    { characters: 'Delete account', name: 'Label', type: 'TEXT' },
    {
      componentProperties: { name: 'trash' },
      mainComponentKey: 'icon-key',
      name: 'Leading icon',
      type: 'INSTANCE' as const,
    },
  ],
  name: 'Button',
  type: 'COMPONENT',
};

function buildConnection(): ConnectionMetadata {
  const contract = extractSourceContract(
    [{ contents: BUTTON_SOURCE, fileName: 'types.ts' }],
    'Button',
  );
  const semanticSnapshot = extractFigmaSemanticSnapshot(BUTTON_NODE, '1094:17504').snapshot;

  return {
    componentName: 'Button',
    importPath: '@tashilcar/swiss-army-knife',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sourcePath: 'src/components/button/types.ts',
    storybookUrl: 'https://storybook.example/?path=/story/button',
    ...(contract.ok
      ? { semanticRecipe: createRecipeDraft(contract.contract, FIGMA_SNAPSHOT, semanticSnapshot) }
      : {}),
  } as ConnectionMetadata;
}

function targetState(): UiTargetState {
  return {
    componentName: 'Button',
    existingConnection: buildConnection(),
    figmaSnapshot: FIGMA_SNAPSHOT,
    message: 'This component already has a Storybook connection.',
    semanticSnapshot: extractFigmaSemanticSnapshot(BUTTON_NODE, '1094:17504').snapshot,
    status: 'ready',
    targetToken: '1094:17504',
  };
}

function inspectCodeState(): InspectCodeState {
  return {
    status: 'connected',
    output: {
      code: `import { Button } from "@tashilcar/swiss-army-knife";

<Button size={"small"} onClick={onClick}>Delete account</Button>`,
      diagnostics: 'State is intentionally unmapped because it describes an interaction preview.',
      references: {
        storybookUrl: 'https://storybook.example/?path=/story/button',
      },
      runtimeRequirements: 'onClick — Set in application.',
    },
  };
}

const INVENTORY: ComponentInventoryState = {
  items: [
    { componentName: 'Button', nodeType: 'COMPONENT', pageName: 'Components', status: 'connected', targetToken: '1094:17504' },
    { componentName: 'Dialog', nodeType: 'COMPONENT_SET', pageName: 'Components', status: 'not-connected', targetToken: '39:19142' },
    { componentName: 'TextField', nodeType: 'COMPONENT', pageName: 'Inputs', status: 'needs-attention', targetToken: '2:2' },
  ],
  scannedPages: 2,
  status: 'ready',
  totalPages: 2,
};

const TOKEN_COLLECTIONS = [
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
      { modeId: 'peykan', name: 'Peykan' },
    ],
    defaultModeId: 'zhina',
    tokenCount: 294,
  },
  {
    id: 'typography',
    name: 'Typography',
    modes: [{ modeId: 'default', name: 'Default' }],
    defaultModeId: 'default',
    tokenCount: 61,
  },
  {
    id: 'measurement',
    name: 'Measurement',
    modes: [{ modeId: 'default', name: 'Default' }],
    defaultModeId: 'default',
    tokenCount: 29,
  },
] as const;

const DOC_STYLE_SOURCES = [
  { id: 'typography', name: 'Typography', styleCount: 18 },
  { id: 'effects', name: 'Effects', styleCount: 9 },
] as const;

function tokenFileSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createHarnessTokens(count: number, modeIndex: number): Token[] {
  const tokens: Token[] = [
    {
      id: 'preview-color',
      name: 'Color/Text/Primary',
      resolvedType: 'COLOR',
      scopes: ['ALL_FILLS'],
      value: {
        kind: 'color',
        value: modeIndex % 2 === 0
          ? { r: 13 / 255, g: 153 / 255, b: 1 }
          : { r: 3 / 255, g: 51 / 255, b: 102 / 255 },
      },
    },
    {
      id: 'preview-spacing',
      name: 'Spacing/4',
      resolvedType: 'FLOAT',
      scopes: ['GAP'],
      value: { kind: 'number', value: 16 + modeIndex * 4 },
    },
    {
      id: 'preview-radius',
      name: 'Radius/Small',
      resolvedType: 'FLOAT',
      scopes: ['CORNER_RADIUS'],
      value: { kind: 'number', value: 8 },
    },
  ];
  for (let index = tokens.length; index < count; index += 1) {
    tokens.push({
      id: `preview-${index}`,
      name: `Generated/Token/${index + 1}`,
      resolvedType: 'FLOAT',
      scopes: ['OPACITY'],
      value: { kind: 'number', value: (index + 1) / count },
    });
  }
  return tokens;
}

function createPreviewFiles(payload: {
  collectionIds?: readonly string[];
  options?: ExportOptions;
}): ExportFile[] {
  if (!payload.options) {
    return [];
  }
  const selectedIds = new Set(payload.collectionIds ?? []);
  const files: ExportFile[] = [];
  for (const collection of TOKEN_COLLECTIONS) {
    if (!selectedIds.has(collection.id)) {
      continue;
    }
    const modeIds = payload.options.modesByCollection[collection.id]
      ?? [collection.defaultModeId];
    for (const modeId of modeIds) {
      const modeIndex = collection.modes.findIndex((mode) => mode.modeId === modeId);
      const mode = collection.modes[Math.max(0, modeIndex)];
      const tokens = createHarnessTokens(collection.tokenCount, Math.max(0, modeIndex));
      const domain: TokenCollection = {
        id: collection.id,
        name: collection.name,
        modes: collection.modes,
        defaultModeId: collection.defaultModeId,
        tokens,
      };
      const suffix = collection.modes.length > 1
        ? `-${tokenFileSlug(mode.name)}`
        : '';
      const serialized = serializeTokenCollection(domain, payload.options);
      files.push({
        name: `${tokenFileSlug(collection.name)}${suffix}.${serialized.extension}`,
        css: serialized.content,
        declarationCount: tokens.length,
        sourceVariableCount: collection.tokenCount,
        warnings: collection.id === 'product'
          && modeId === 'zhina'
          && payload.options.aliasModeOverridesByCollectionMode
            ?.product?.zhina?.references === undefined
          ? [{
              code: 'mode-fallback',
              message: 'No “Zhina” mode exists in References Color; using Light.',
              tokenName: 'Color/Primary/Hover',
              sourceCollectionId: 'product',
              sourceModeId: 'zhina',
              targetCollectionId: 'references',
              fallbackModeId: 'light',
            }]
          : [],
      });
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// Fixture: a Design Health audit of a small checkout screen, covering all
// three groups (auto-fix / needs-decision / no-match), a multi-property node
// cluster, an in-instance finding, and a deprecated library instance.
// ---------------------------------------------------------------------------

function suggestion(
  variableId: string,
  variableName: string,
  confidence: TokenSuggestion['confidence'],
): TokenSuggestion {
  return {
    confidence,
    reason: confidence === 'high' ? 'Inferred variable match' : 'Value and scope match',
    source: confidence === 'high' ? 'inferred' : 'scope-match',
    variableId,
    variableName,
  };
}

function spacingIssue(
  nodeId: string,
  nodeName: string,
  field: TokenPropertyIssue['bindingTarget']['field'],
  value: number,
): TokenPropertyIssue {
  const tokenName = `Spacing/${value}`;
  return {
    bindingTarget: { field },
    currentValue: value,
    id: `${nodeId}:${field}`,
    isEditableHere: true,
    nodeName,
    nodeId,
    property: field === 'itemSpacing' ? 'gap' : 'padding',
    suggestion: suggestion(`var-spacing-${value}`, tokenName, 'high'),
  };
}

function designHealthScanResult(scanId: string): DesignHealthScanResult {
  const updateAvailableInstances = [
    {
      componentName: 'Button',
      instanceName: 'Primary action',
      nodeId: 'inst-update-1',
    },
  ].filter((notice) => !appliedLibraryUpdateNodeIds.has(notice.nodeId));
  const issues: TokenPropertyIssue[] = [
    {
      bindingTarget: { field: 'fills', paintIndex: 0 },
      currentValue: '#F9FAFB',
      id: 'root-frame:fill:0',
      isEditableHere: true,
      nodeName: 'Pre-sales / Orders / Full',
      nodeId: 'root-frame',
      property: 'fill',
      suggestion: suggestion('var-bg-neutral', 'background/neutral/transparent', 'high'),
    },
    spacingIssue('header-1', 'Header', 'itemSpacing', 4),
    spacingIssue('header-1', 'Header', 'paddingTop', 16),
    spacingIssue('header-1', 'Header', 'paddingRight', 24),
    spacingIssue('header-1', 'Header', 'paddingBottom', 16),
    spacingIssue('header-1', 'Header', 'paddingLeft', 24),
    spacingIssue('body-1', 'body_container', 'itemSpacing', 16),
    spacingIssue('body-1', 'body_container', 'paddingTop', 24),
    spacingIssue('body-1', 'body_container', 'paddingRight', 24),
    {
      bindingTarget: { field: 'cornerRadius' },
      currentValue: 8,
      id: 'card-1:cornerRadius',
      isEditableHere: true,
      nodeName: 'Order Card',
      nodeId: 'card-1',
      property: 'cornerRadius',
      suggestion: suggestion('var-radius-md', 'radius/md', 'medium'),
    },
    {
      alternativeSuggestions: [
        {
          confidence: 'low',
          reason: 'Alternative exact match',
          source: 'exact-value',
          variableId: 'var-color-white',
          variableName: 'color/neutral/white',
        },
      ],
      bindingTarget: { field: 'fills', paintIndex: 0 },
      currentValue: '#FFFFFF',
      id: 'badge-1:fill:0',
      isEditableHere: true,
      nodeName: 'Status Badge',
      nodeId: 'badge-1',
      property: 'fill',
      suggestion: suggestion('var-surface-primary', 'surface/primary', 'medium'),
    },
    {
      bindingTarget: { field: 'fills', paintIndex: 0 },
      currentValue: '#123456',
      id: 'overlay-1:fill:0',
      isEditableHere: true,
      nodeName: 'Overlay',
      nodeId: 'overlay-1',
      property: 'fill',
    },
    {
      bindingTarget: { field: 'strokes', paintIndex: 0 },
      currentValue: '#ABCDEF',
      id: 'inst-text-1:stroke:0',
      isEditableHere: false,
      containerInstanceId: 'inst-text-1',
      nodeName: 'Order Status Label',
      nodeId: 'inst-text-1',
      property: 'stroke',
      suggestion: suggestion('var-border-strong', 'border/strong', 'high'),
    },
  ];

  return {
    capReached: false,
    libraryHealth: {
      currentRemoteInstancesCount: 3 - updateAvailableInstances.length,
      deprecatedInstances: [
        {
          componentName: 'LegacyIcon',
          deprecationNotice: 'Use TashilIcon instead — LegacyIcon is removed in v3.',
          instanceName: 'Trash Icon',
          nodeId: 'inst-dep-1',
        },
      ],
      localInstancesCount: 2,
      remoteInstancesCount: 3,
      totalInstances: 5,
      uniqueComponentsCount: 2,
      updateAvailableInstances,
      updateCheckFailuresCount: 0,
    },
    nodesVisited: 214,
    scanId,
    scannedAt: Date.now(),
    selectionCount: 1,
    targetNode: { id: 'root-frame', name: 'Pre-sales / Orders / Full', type: 'FRAME' },
    tokenAudit: {
      audited: true,
      boundPropertiesCount: 42,
      highConfidenceCount: 10,
      issues,
      lowConfidenceCount: 0,
      mediumConfidenceCount: 2,
      tokenCoveragePercent: 76,
      totalPropertiesScanned: 55,
      unboundPropertiesCount: issues.length,
    },
  };
}

function respond(name: string, payload: unknown): void {
  const request = (payload ?? {}) as Record<string, string>;

  switch (name) {
    case 'SCAN_COMPONENTS':
      send('COMPONENT_INVENTORY_STATE', { scanId: request.scanId, state: INVENTORY });
      break;
    case 'OPEN_COMPONENT_TARGET':
      send('COMPONENT_TARGET_STATE', { requestId: request.requestId, state: targetState() });
      break;
    case 'REFRESH_SELECTION':
      send('CANVAS_TARGET_STATE', { source: 'initial', state: targetState() });
      send('INSPECT_CODE_STATE', inspectCodeState());
      break;
    case 'LOAD_TOKEN_COLLECTIONS':
      send('LOAD_TOKEN_COLLECTIONS_RESULT', {
        ok: true,
        collections: TOKEN_COLLECTIONS,
      });
      break;
    case 'LOAD_DOC_STYLE_SOURCES':
      send('LOAD_DOC_STYLE_SOURCES_RESULT', {
        ok: true,
        sources: DOC_STYLE_SOURCES,
      });
      break;
    case 'LOAD_DOC_SOURCE_PREVIEW': {
      const previewRequest = (payload ?? {}) as {
        requestId?: string;
        scope?: 'components' | 'styles' | 'tokens';
        targetId?: string;
        tokenGroupingDepth?: TokenGroupingDepth;
      };
      const collection = TOKEN_COLLECTIONS.find((item) => item.id === previewRequest.targetId);
      if (previewRequest.scope === 'tokens' && collection) {
        const groupsByCollection: Record<string, string[]> = {
          measurement: ['Spacing', 'Radius', 'Border'],
          product: ['Color', 'Typography', 'Spacing', 'Elevation', 'Motion'],
          references: ['Color', 'Opacity', 'Gradient', 'Surface'],
          typography: ['Font Family', 'Font Size', 'Line Height'],
        };
        const groupNames = groupsByCollection[collection.id] ?? ['General'];
        const groupingDepth = previewRequest.tokenGroupingDepth ?? 'all';
        const depthMultiplier: Record<TokenGroupingDepth, number> = {
          '1': 1,
          '2': 2,
          '3': 3,
          '4': 4,
          all: 5,
        };
        send('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
          ok: true,
          preview: {
            groupCount: groupNames.length * depthMultiplier[groupingDepth],
            groupNames: groupNames.slice(0, 3),
            groupingDepth,
            modeCount: collection.modes.length,
            scope: 'tokens',
            sourceName: collection.name,
            targetId: collection.id,
            tokenCount: collection.tokenCount,
          },
          requestId: previewRequest.requestId,
        });
      } else if (previewRequest.scope === 'styles') {
        const styleSource = DOC_STYLE_SOURCES.find((item) => item.id === previewRequest.targetId);
        const groupNames = previewRequest.targetId === 'typography'
          ? ['Display', 'Heading', 'Body', 'Label']
          : ['Elevation', 'Blur', 'Glass'];
        const groupingDepth = previewRequest.tokenGroupingDepth ?? 'all';
        const depthMultiplier: Record<TokenGroupingDepth, number> = {
          '1': 1,
          '2': 2,
          '3': 3,
          '4': 4,
          all: 5,
        };
        send('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
          ok: Boolean(styleSource),
          preview: styleSource ? {
            groupCount: groupNames.length * depthMultiplier[groupingDepth],
            groupNames: groupNames.slice(0, 3),
            groupingDepth,
            scope: 'styles',
            sourceName: styleSource.name,
            styleCount: styleSource.styleCount,
            styleKind: styleSource.id,
            targetId: styleSource.id,
          } : undefined,
          requestId: previewRequest.requestId,
        });
      } else {
        const item = INVENTORY.status === 'ready'
          ? INVENTORY.items.find((candidate) => candidate.targetToken === previewRequest.targetId)
          : undefined;
        send('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
          ok: Boolean(item),
          preview: item ? {
            combinationCount: item.nodeType === 'COMPONENT_SET' ? 27 : 0,
            propertyCount: item.nodeType === 'COMPONENT_SET' ? 3 : 0,
            scope: 'components',
            sourceName: item.componentName,
            targetId: item.targetToken,
          } : undefined,
          requestId: previewRequest.requestId,
        });
      }
      break;
    }
    case 'GENERATE_STYLE_DOCS':
      send('GENERATE_STYLE_DOCS_RESULT', {
        message: 'Style documentation generated in the harness.',
        ok: true,
      });
      break;
    case 'PREVIEW_TOKENS': {
      const previewRequest = (payload ?? {}) as {
        collectionIds?: readonly string[];
        operationId?: string;
        options?: ExportOptions;
      };
      send('PREVIEW_TOKENS_RESULT', {
        ok: true,
        operationId: previewRequest.operationId,
        files: createPreviewFiles(previewRequest),
      });
      break;
    }
    case 'SAVE_CONNECTION':
      send('SAVE_RESULT', {
        message: 'Connection saved.',
        ok: true,
        operation: 'save',
        operationId: request.operationId,
        targetState: targetState(),
        targetToken: request.targetToken,
      });
      break;
    case 'SCAN_DESIGN_HEALTH':
      send('SCAN_DESIGN_HEALTH_RESULT', {
        ok: true,
        scanId: request.scanId,
        scanResult: designHealthScanResult(String(request.scanId)),
      });
      break;
    case 'APPLY_TOKEN_BINDINGS': {
      const bindRequest = (payload ?? {}) as { bindings?: unknown[]; operationId?: string };
      const boundCount = bindRequest.bindings?.length ?? 0;
      send('APPLY_TOKEN_BINDINGS_RESULT', {
        boundCount,
        failedCount: 0,
        ok: true,
        operationId: bindRequest.operationId,
        message: `Successfully bound ${boundCount} properties to design tokens.`,
      });
      break;
    }
    case 'APPLY_LIBRARY_UPDATES': {
      const updateRequest = (payload ?? {}) as { nodeIds?: string[]; operationId?: string };
      const nodeIds = Array.from(new Set(updateRequest.nodeIds ?? []));
      for (const nodeId of nodeIds) {
        appliedLibraryUpdateNodeIds.add(nodeId);
      }
      send('APPLY_LIBRARY_UPDATES_RESULT', {
        currentCount: 0,
        failedCount: 0,
        ok: true,
        operationId: updateRequest.operationId,
        updatedCount: nodeIds.length,
        message: `Successfully updated ${nodeIds.length} library instances.`,
      });
      break;
    }
    case 'FOCUS_NODE': {
      // Selecting happens on the real canvas; acknowledge the reveal so the
      // interaction is observable here.
      const focusRequest = (payload ?? {}) as { nodeId?: string };
      notifyHarness(`Would select “${harnessNodeName(focusRequest.nodeId)}” on canvas`);
      break;
    }
    case 'CLEAR_CONNECTION':
      send('SAVE_RESULT', {
        message: 'Connection cleared.',
        ok: true,
        operation: 'clear',
        operationId: request.operationId,
        targetToken: request.targetToken,
      });
      break;
    default:
      break;
  }
}

/** Push the opening state once the UI has registered its handlers. */
export function startHarness(): void {
  window.setTimeout(() => {
    send('CANVAS_TARGET_STATE', { source: 'initial', state: targetState() });
    send('COMPONENT_INVENTORY_STATE', { scanId: 'harness', state: INVENTORY });
    send('INSPECT_CODE_STATE', inspectCodeState());
  }, 0);
}
