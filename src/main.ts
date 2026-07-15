import { emit, on, showUI } from '@create-figma-plugin/utilities';
import {
  createUsageSnippet,
  isConnectionMetadata,
  validateConnectionMetadata,
} from './codegen';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type ClearConnectionHandler,
  type CloseHandler,
  type CodegenBlock,
  type ConnectionMetadata,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type PropMapping,
  type PropMappings,
  type RefreshSelectionHandler,
  type ResizeWindowHandler,
  type SaveConnectionHandler,
  type SaveResultHandler,
  type ScaffoldPropMappingsHandler,
  type ScaffoldResultHandler,
  type SelectionStateHandler,
  type UiSelectionState,
} from './types';

type ConnectableComponentNode = ComponentNode | ComponentSetNode;

type ResolvedSelection = {
  mainComponent: ConnectableComponentNode;
  componentProperties: Record<string, string | boolean>;
  displayText: string;
};

type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { ok: false; message: string };

type MutationSelectionResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; message: string };

let latestSelectionRefreshRequestId = 0;

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 480, height: 589 });

  on<SaveConnectionHandler>('SAVE_CONNECTION', (payload) => {
    void saveConnection(payload.metadata, payload.selectionToken);
  });

  on<ClearConnectionHandler>('CLEAR_CONNECTION', (payload) => {
    void clearConnection(payload.selectionToken);
  });

  on<RefreshSelectionHandler>('REFRESH_SELECTION', () => {
    void sendSelectionState();
  });

  on<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS', (payload) => {
    void scaffoldPropMappings(payload.selectionToken);
  });

  on<ResizeWindowHandler>('RESIZE_WINDOW', (size) => {
    figma.ui.resize(size.width, size.height);
  });

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin();
  });

  figma.on('selectionchange', () => {
    void sendSelectionState();
  });
}

figma.codegen.on('generate', async (event) => {
  try {
    const selection = await resolveSelection(event.node);

    if (!selection) {
      return [
        createPlainTextBlock(
          'Storybook Connect',
          'Select a component instance or main component to view usage code.',
        ),
      ];
    }

    const connection = readConnectionMetadata(selection.mainComponent);

    if (!connection.ok) {
      return [
        createPlainTextBlock(
          'Storybook Connect',
          connection.message,
        ),
      ];
    }

    const blocks: CodegenBlock[] = [
      {
        title: connection.metadata.componentName,
        language: 'TYPESCRIPT',
        code: createUsageSnippet(connection.metadata, selection),
      },
    ];

    const references = createReferenceText(connection.metadata);

    if (references) {
      blocks.push(createPlainTextBlock('References', references));
    }

    return blocks;
  } catch (error) {
    return [
      createPlainTextBlock(
        'Storybook Connect Error',
        error instanceof Error ? error.message : 'Unknown codegen error.',
      ),
    ];
  }
});

async function saveConnection(
  metadata: ConnectionMetadata,
  selectionToken: string,
): Promise<void> {
  const result = await resolveCurrentSelection(selectionToken);

  if (!result.ok) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: result.message,
      operation: 'save',
      selectionToken,
    });
    return;
  }

  const { selection } = result;

  const validation = validateConnectionMetadata(metadata);

  if (!validation.ok) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: validation.message,
      operation: 'save',
      selectionToken,
    });
    return;
  }

  const connectionMetadata = {
    ...metadata,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
  };

  selection.mainComponent.setSharedPluginData(
    CONNECTION_NAMESPACE,
    CONNECTION_KEY,
    JSON.stringify(connectionMetadata),
  );

  figma.notify(`${connectionMetadata.componentName} connected to Storybook`);
  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection saved.',
    operation: 'save',
    selectionToken,
  });
  await sendSelectionState();
}

async function clearConnection(selectionToken: string): Promise<void> {
  const result = await resolveCurrentSelection(selectionToken);

  if (!result.ok) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: result.message,
      operation: 'clear',
      selectionToken,
    });
    return;
  }

  const { selection } = result;

  selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, '');
  figma.notify('Storybook connection cleared');
  await sendSelectionState();
  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection cleared.',
    operation: 'clear',
    selectionToken,
  });
}

/**
 * Build a prop-mapping skeleton from the selected component's
 * `componentPropertyDefinitions`. Every VARIANT property becomes a mapping
 * group; each of its `variantOptions` maps to a React prop of the same name.
 * Non-variant properties are skipped (they need a human to decide the target).
 */
async function scaffoldPropMappings(selectionToken: string): Promise<void> {
  const result = await resolveCurrentSelection(selectionToken);

  if (!result.ok) {
    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: false,
      message: result.message,
      selectionToken,
    });
    return;
  }

  const { selection } = result;

  const propertyDefinitions = selection.mainComponent.componentPropertyDefinitions;
  const mappings: PropMappings = {};

  for (const [propertyName, definition] of Object.entries(propertyDefinitions)) {
    if (definition.type !== 'VARIANT') {
      continue;
    }

    const options = definition.variantOptions ?? [];
    const group: Record<string, PropMapping> = {};

    for (const option of options) {
      group[option] = { prop: propertyName, value: option };
    }

    if (Object.keys(group).length > 0) {
      mappings[propertyName] = group;
    }
  }

  if (Object.keys(mappings).length === 0) {
    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: false,
      message: 'No variant properties found on this component to scaffold.',
      selectionToken,
    });
    return;
  }

  emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
    ok: true,
    mappings,
    selectionToken,
  });
}

async function resolveSelection(node: SceneNode): Promise<ResolvedSelection | null> {
  if (node.type === 'INSTANCE') {
    const mainComponent = await node.getMainComponentAsync();

    if (!mainComponent) {
      return null;
    }

    const connectionTarget = getConnectionTarget(mainComponent);

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, mainComponent, connectionTarget),
      displayText: getDisplayText(node),
    };
  }

  if (node.type === 'COMPONENT') {
    const connectionTarget = getConnectionTarget(node);

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, node, connectionTarget),
      displayText: getDisplayText(node),
    };
  }

  if (node.type === 'COMPONENT_SET') {
    return {
      mainComponent: node,
      componentProperties: readComponentProperties(node),
      displayText: node.name,
    };
  }

  return null;
}

async function resolveCurrentSelection(
  selectionToken: string,
): Promise<MutationSelectionResult> {
  const selectedNodes = figma.currentPage.selection;

  if (selectedNodes.length !== 1 || selectedNodes[0].id !== selectionToken) {
    return {
      ok: false,
      message: 'Selection changed. Select exactly one connectable component and try again.',
    };
  }

  const selection = await resolveSelection(selectedNodes[0]);
  const currentSelection = figma.currentPage.selection;

  if (
    currentSelection.length !== 1
    || currentSelection[0].id !== selectionToken
  ) {
    return {
      ok: false,
      message: 'Selection changed. Select exactly one connectable component and try again.',
    };
  }

  if (!selection) {
    return {
      ok: false,
      message: 'Select exactly one component instance, main component, or component set.',
    };
  }

  return { ok: true, selection };
}

async function sendSelectionState(): Promise<void> {
  const requestId = ++latestSelectionRefreshRequestId;
  const selectedNodes = [...figma.currentPage.selection];
  const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selection = selectedNode ? await resolveSelection(selectedNode) : null;

  if (
    requestId !== latestSelectionRefreshRequestId
    || !matchesCurrentSelection(selectedNodes)
  ) {
    return;
  }

  const connection = selection
    ? readConnectionMetadata(selection.mainComponent)
    : null;
  const state = createSelectionState(selectedNodes, selection, connection);
  const inspectState = createInspectCodeState(selectedNodes, selection, connection);

  emit<SelectionStateHandler>('SELECTION_STATE', state);
  emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', inspectState);
}

function matchesCurrentSelection(selectedNodes: ReadonlyArray<SceneNode>): boolean {
  const currentSelection = figma.currentPage.selection;

  return currentSelection.length === selectedNodes.length
    && currentSelection.every((node, index) => node.id === selectedNodes[index].id);
}

function createInspectCodeState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): InspectCodeState {
  if (selectedNodes.length === 0) {
    return { status: 'invalid-selection' };
  }

  const selectedNode = selectedNodes[0];

  if (selectedNodes.length > 1) {
    return {
      status: 'invalid-selection',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  if (!selection) {
    return {
      status: 'invalid-selection',
      message: [
        `"${selectedNode.name}" (${selectedNode.type}) is not connectable.`,
        'Select a single component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  if (!connection || !connection.ok) {
    return { status: 'not-connected' };
  }

  return {
    status: 'connected',
    code: createUsageSnippet(connection.metadata, selection),
    references: createReferenceText(connection.metadata),
  };
}

function createSelectionState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): UiSelectionState {
  if (selectedNodes.length === 0) {
    return {
      status: 'empty',
      message: 'Select a component instance, main component, or component set to connect it.',
    };
  }

  if (selectedNodes.length > 1) {
    return {
      status: 'empty',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  if (!selection) {
    const node = selectedNodes[0];
    return {
      status: 'empty',
      message: [
        `"${node.name}" (${node.type}) is not connectable.`,
        'Select a component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  return {
    status: 'ready',
    selectionToken: selectedNodes[0].id,
    componentName: selection.mainComponent.name,
    existingConnection: connection?.ok ? connection.metadata : undefined,
    message: connection?.ok
      ? 'This component already has a Storybook connection.'
      : 'This component is ready to connect.',
  };
}

function collectComponentProperties(
  selectedNode: InstanceNode | ComponentNode,
  mainComponent: ComponentNode,
  connectionTarget: ConnectableComponentNode,
): Record<string, string | boolean> {
  return {
    ...readComponentProperties(connectionTarget),
    ...readComponentProperties(mainComponent),
    ...readComponentProperties(selectedNode),
  };
}

function getConnectionTarget(component: ComponentNode): ConnectableComponentNode {
  if (component.parent?.type === 'COMPONENT_SET') {
    return component.parent;
  }

  return component;
}

function readComponentProperties(
  node: InstanceNode | ComponentNode | ComponentSetNode,
): Record<string, string | boolean> {
  const properties: Record<string, string | boolean> = {};

  if ('componentProperties' in node) {
    for (const [propertyName, property] of Object.entries(node.componentProperties)) {
      properties[normalizeComponentPropertyName(propertyName)] = property.value;
    }
  }

  if ('variantProperties' in node) {
    const variantProperties = node.variantProperties;

    if (variantProperties) {
      for (const [propertyName, value] of Object.entries(variantProperties)) {
        if (typeof value === 'string') {
          properties[normalizeComponentPropertyName(propertyName)] = value;
        }
      }
    }
  }

  return properties;
}

function normalizeComponentPropertyName(propertyName: string): string {
  return propertyName.split('#')[0];
}

function readConnectionMetadata(
  mainComponent: ConnectableComponentNode,
): ConnectionReadResult {
  const rawConnection = mainComponent.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);

  if (!rawConnection) {
    return {
      ok: false,
      message: [
        '⚠️ **Not connected**',
        '',
        'This component is not connected to Storybook/source code yet.',
        '',
        'Ask the design system owner to connect this Figma main component to its production component.',
      ].join('\n'),
    };
  }

  try {
    const parsedConnection: unknown = JSON.parse(rawConnection);

    if (!isConnectionMetadata(parsedConnection)) {
      return {
        ok: false,
        message: 'This component has invalid Storybook connection metadata.',
      };
    }

    return {
      ok: true,
      metadata: migrateConnectionMetadata(parsedConnection),
    };
  } catch (_error) {
    return {
      ok: false,
      message: 'This component has malformed Storybook connection metadata.',
    };
  }
}

/**
 * Bring persisted connection metadata up to {@link CURRENT_SCHEMA_VERSION}.
 *
 * Data written by older plugin builds has no `schemaVersion` field — treat that
 * as version 1. Add a `case` for each future breaking change to the shape.
 */
function migrateConnectionMetadata(metadata: ConnectionMetadata): ConnectionMetadata {
  const version = metadata.schemaVersion ?? 1;

  if (version >= CURRENT_SCHEMA_VERSION) {
    return metadata;
  }

  // v1 -> v2: no structural change; the version field is simply adopted.
  // Future migrations go here, e.g.:
  // if (version < 2) { metadata = reshapeV1ToV2(metadata); }

  return { ...metadata, schemaVersion: CURRENT_SCHEMA_VERSION };
}

function createReferenceText(metadata: ConnectionMetadata): string {
  return [
    metadata.storybookUrl ? `Storybook: ${metadata.storybookUrl}` : '',
    metadata.sourcePath ? `Source: ${metadata.sourcePath}` : '',
    metadata.updatedAt ? `Last updated: ${formatDateTime(metadata.updatedAt)}` : '',
  ].filter(Boolean).join('\n');
}

function getDisplayText(node: SceneNode): string {
  if ('characters' in node && typeof node.characters === 'string' && node.characters.length > 0) {
    return node.characters;
  }

  return node.name;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function createPlainTextBlock(title: string, code: string): CodegenBlock {
  return {
    title,
    language: 'PLAINTEXT',
    code,
  };
}
