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
