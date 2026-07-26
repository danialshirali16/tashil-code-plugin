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
import { CURRENT_SCHEMA_VERSION } from '../../src/types';
import type {
  ComponentInventoryState,
  ConnectionMetadata,
  FigmaComponentSnapshot,
  UiTargetState,
} from '../../src/types';

type Handler = (payload: unknown) => void;

const handlers = new Map<string, Set<Handler>>();

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
      break;
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
  }, 0);
}
