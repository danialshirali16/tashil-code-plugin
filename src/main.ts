import { emit, on, showUI } from '@create-figma-plugin/utilities';
import {
  createUsageSnippet,
  formatMappingDiagnostics,
  isPropMappings,
  isRecord,
  migratePersistedConnectionMetadata,
  validatePersistedConnectionMetadata,
  validateConnectionMetadata,
  type ResolvedInstanceSwap,
} from './codegen';
import { normalizeHttpUrl, normalizeOptionalHttpUrl } from './external-url';
import { createReactPropIdentifier } from './prop-mappings';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type ClearConnectionHandler,
  type CloseHandler,
  type CodegenBlock,
  type ConnectionIssue,
  type ConnectionMetadata,
  type ConnectionReferences,
  type FigmaComponentSnapshot,
  type FigmaPropertyDescriptor,
  type InspectCodeState,
  type InspectCodeStateHandler,
  type OpenExternalHandler,
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
  instanceSwaps: Record<string, ResolvedInstanceSwap>;
};

type ConnectionReadResult =
  | { ok: true; metadata: ConnectionMetadata }
  | { issue?: ConnectionIssue; ok: false; message: string };

type MutationSelectionResult =
  | { ok: true; selection: ResolvedSelection }
  | { ok: false; message: string };

let latestSelectionRefreshRequestId = 0;

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 480, height: 589 });

  on<SaveConnectionHandler>('SAVE_CONNECTION', (payload) => {
    void saveConnection(payload.metadata, payload.selectionToken, payload.operationId);
  });

  on<ClearConnectionHandler>('CLEAR_CONNECTION', (payload) => {
    void clearConnection(payload.selectionToken, payload.operationId);
  });

  on<RefreshSelectionHandler>('REFRESH_SELECTION', () => {
    runBestEffort(sendSelectionState);
  });

  on<ScaffoldPropMappingsHandler>('SCAFFOLD_PROP_MAPPINGS', (payload) => {
    void scaffoldPropMappings(payload.selectionToken, payload.operationId);
  });

  on<OpenExternalHandler>('OPEN_EXTERNAL', (payload) => {
    openExternalReference(payload);
  });

  on<ResizeWindowHandler>('RESIZE_WINDOW', (size) => {
    figma.ui.resize(size.width, size.height);
  });

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin();
  });

  figma.on('selectionchange', () => {
    runBestEffort(sendSelectionState);
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

    const usage = createUsageSnippet(connection.metadata, selection);
    const blocks: CodegenBlock[] = [
      {
        title: connection.metadata.componentName,
        language: 'TYPESCRIPT',
        code: usage.code,
      },
    ];
    const diagnostics = formatMappingDiagnostics(usage.diagnostics);

    if (diagnostics) {
      blocks.push(createPlainTextBlock('Mapping diagnostics', diagnostics));
    }

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
  operationId: string,
): Promise<void> {
  try {
    const result = await resolveCurrentSelection(selectionToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'save',
        operationId,
        selectionToken,
      });
      return;
    }

    const { selection } = result;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'save',
        operationId,
        selectionToken,
      });
      return;
    }

    const validation = validateConnectionMetadata(metadata);

    if (!validation.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: validation.message,
        operation: 'save',
        operationId,
        selectionToken,
      });
      return;
    }

    const referenceUrls = normalizeConnectionReferenceUrlsForSave(metadata);

    if (!referenceUrls.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: referenceUrls.message,
        operation: 'save',
        operationId,
        selectionToken,
      });
      return;
    }

    const savedAt = new Date().toISOString();
    const connectionMetadata = {
      ...metadata,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sourceUrl: referenceUrls.sourceUrl,
      storybookUrl: referenceUrls.storybookUrl,
      updatedAt: savedAt,
      ...(metadata.mappingDocument ? {
        mappingDocument: {
          ...metadata.mappingDocument,
          figmaSnapshot: createFigmaComponentSnapshot(selection.mainComponent),
          lastValidatedAt: savedAt,
          revision: metadata.mappingDocument.revision + 1,
        },
      } : {}),
    };

    selection.mainComponent.setSharedPluginData(
      CONNECTION_NAMESPACE,
      CONNECTION_KEY,
      JSON.stringify(connectionMetadata),
    );
  } catch (error) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: createMutationFailureMessage('save the connection', error),
      operation: 'save',
      operationId,
      selectionToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection saved.',
    operation: 'save',
    operationId,
    selectionToken,
  });
  runBestEffort(() => {
    figma.notify(`${metadata.componentName} connected to Storybook`);
  });
  runBestEffort(sendSelectionState);
}

async function clearConnection(selectionToken: string, operationId: string): Promise<void> {
  try {
    const result = await resolveCurrentSelection(selectionToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'clear',
        operationId,
        selectionToken,
      });
      return;
    }

    const { selection } = result;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'clear',
        operationId,
        selectionToken,
      });
      return;
    }

    selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, '');
  } catch (error) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: createMutationFailureMessage('clear the connection', error),
      operation: 'clear',
      operationId,
      selectionToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection cleared.',
    operation: 'clear',
    operationId,
    selectionToken,
  });
  runBestEffort(() => {
    figma.notify('Storybook connection cleared');
  });
  runBestEffort(sendSelectionState);
}

/**
 * Build a prop-mapping skeleton from the selected component's
 * `componentPropertyDefinitions`. Every VARIANT property becomes a mapping
 * group; each of its `variantOptions` maps to a normalized React prop name.
 * Active INSTANCE_SWAP properties also get a mapping from component ID to
 * the selected component name so codegen can keep resolving future swaps.
 */
async function scaffoldPropMappings(
  selectionToken: string,
  operationId: string,
): Promise<void> {
  try {
    const result = await resolveCurrentSelection(selectionToken);

    if (!result.ok) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: result.message,
        operationId,
        selectionToken,
      });
      return;
    }

    const { selection } = result;

    const propertyDefinitions = selection.mainComponent.componentPropertyDefinitions;
    const mappings = createDictionary<Record<string, PropMapping>>() as PropMappings;
    const unsupportedProperties: string[] = [];

    for (const [propertyName, definition] of Object.entries(propertyDefinitions)) {
      if (definition.type !== 'VARIANT' && definition.type !== 'INSTANCE_SWAP') {
        continue;
      }

      const normalizedPropertyName = normalizeComponentPropertyName(propertyName);
      const reactProp = definition.type === 'INSTANCE_SWAP'
        ? createInstanceSwapReactPropIdentifier(normalizedPropertyName)
        : createReactPropIdentifier(normalizedPropertyName);
      if (!reactProp) {
        unsupportedProperties.push(propertyName);
        continue;
      }

      const group = createDictionary<PropMapping>();

      if (definition.type === 'VARIANT') {
        for (const option of definition.variantOptions ?? []) {
          group[option] = { prop: reactProp, value: option };
        }
      } else if (definition.type === 'INSTANCE_SWAP') {
        const instanceSwap = selection.instanceSwaps[normalizedPropertyName]
          ?? (typeof definition.defaultValue === 'string'
            ? await resolveInstanceSwapComponent(definition.defaultValue)
            : undefined);

        if (instanceSwap) {
          const mappingKey = isIconRenderProp(reactProp)
            ? '*'
            : instanceSwap.componentId;
          group[mappingKey] = {
            prop: reactProp,
            value: isIconRenderProp(reactProp)
              ? '$instanceSwap'
              : instanceSwap.componentName,
          };
        }
      } else {
        continue;
      }

      if (Object.keys(group).length > 0) {
        mappings[normalizedPropertyName] = group;
      }
    }

    if (unsupportedProperties.length > 0) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: [
          'Could not generate valid React prop names for Figma properties:',
          unsupportedProperties.map((propertyName) => JSON.stringify(propertyName)).join(', '),
          'Rename them using letters or numbers, or enter mappings manually.',
        ].join(' '),
        operationId,
        selectionToken,
      });
      return;
    }

    if (Object.keys(mappings).length === 0) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'No variant or active instance-swap properties found on this component to scaffold.',
        operationId,
        selectionToken,
      });
      return;
    }

    if (!isPropMappings(mappings)) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'Generated prop mappings were invalid. Rename the Figma variant properties or enter mappings manually.',
        operationId,
        selectionToken,
      });
      return;
    }

    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: true,
      mappings,
      operationId,
      selectionToken,
    });
  } catch (error) {
    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: false,
      message: createMutationFailureMessage('generate prop mappings', error),
      operationId,
      selectionToken,
    });
  }
}

function createMutationFailureMessage(action: string, error: unknown): string {
  const detail = error instanceof Error && error.message.trim() !== ''
    ? ` ${error.message}`
    : '';
  return `Could not ${action}.${detail}`;
}

function runBestEffort(effect: () => void | Promise<void>): void {
  try {
    void Promise.resolve(effect()).catch(() => undefined);
  } catch {
    // Event entry points and post-mutation effects must not leak host failures.
  }
}

async function resolveSelection(node: SceneNode): Promise<ResolvedSelection | null> {
  if (node.type === 'INSTANCE') {
    const mainComponent = await node.getMainComponentAsync();

    if (!mainComponent) {
      return null;
    }

    const connectionTarget = getConnectionTarget(mainComponent);
    const propertySources = [connectionTarget, mainComponent, node];

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, mainComponent, connectionTarget),
      displayText: getDisplayText(node),
      instanceSwaps: await collectInstanceSwaps(propertySources),
    };
  }

  if (node.type === 'COMPONENT') {
    const connectionTarget = getConnectionTarget(node);
    const propertySources = [connectionTarget, node];

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, node, connectionTarget),
      displayText: getDisplayText(node),
      instanceSwaps: await collectInstanceSwaps(propertySources),
    };
  }

  if (node.type === 'COMPONENT_SET') {
    return {
      mainComponent: node,
      componentProperties: readComponentProperties(node),
      displayText: node.name,
      instanceSwaps: await collectInstanceSwaps([node]),
    };
  }

  return null;
}

async function collectInstanceSwaps(
  nodes: ReadonlyArray<InstanceNode | ComponentNode | ComponentSetNode>,
): Promise<Record<string, ResolvedInstanceSwap>> {
  const instanceSwaps = createDictionary<ResolvedInstanceSwap>();
  const visitedNodeIds = new Set<string>();

  for (const node of nodes) {
    if (visitedNodeIds.has(node.id) || !('componentProperties' in node)) {
      continue;
    }
    visitedNodeIds.add(node.id);

    for (const [propertyName, property] of Object.entries(node.componentProperties)) {
      if (property.type !== 'INSTANCE_SWAP' || typeof property.value !== 'string') {
        continue;
      }

      const instanceSwap = await resolveInstanceSwapComponent(property.value);
      if (!instanceSwap) {
        continue;
      }

      instanceSwaps[normalizeComponentPropertyName(propertyName)] = instanceSwap;
    }
  }

  return instanceSwaps;
}

async function resolveInstanceSwapComponent(
  componentId: string,
): Promise<ResolvedInstanceSwap | undefined> {
  let component: BaseNode | null;

  try {
    component = await figma.getNodeByIdAsync(componentId);
  } catch (_error) {
    return undefined;
  }

  if (component?.type !== 'COMPONENT') {
    return undefined;
  }

  return {
    componentId,
    componentName: component.name,
  };
}

function createInstanceSwapReactPropIdentifier(figmaPropertyName: string): string | null {
  const normalized = createReactPropIdentifier(figmaPropertyName);

  if (normalized === 'leadingIcon' || normalized === 'leftIcon') {
    return 'renderRightIcon';
  }

  if (normalized === 'trailingIcon' || normalized === 'rightIcon') {
    return 'renderLeftIcon';
  }

  return normalized;
}

function isIconRenderProp(prop: string): boolean {
  return prop === 'renderLeftIcon' || prop === 'renderRightIcon';
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

  try {
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selection = selectedNode ? await resolveSelection(selectedNode) : null;

    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const connection = selection
      ? readConnectionMetadata(selection.mainComponent)
      : null;
    const state = createSelectionState(selectedNodes, selection, connection);
    const inspectState = createInspectCodeState(selectedNodes, selection, connection);

    emit<SelectionStateHandler>('SELECTION_STATE', state);
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', inspectState);
  } catch (error) {
    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const message = createSelectionRefreshFailureMessage(error);
    emit<SelectionStateHandler>('SELECTION_STATE', {
      status: 'empty',
      message,
    });
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', {
      status: 'invalid-selection',
      message,
    });
  }
}

function isCurrentSelectionRefresh(
  requestId: number,
  selectedNodes: ReadonlyArray<SceneNode>,
): boolean {
  return requestId === latestSelectionRefreshRequestId
    && matchesCurrentSelection(selectedNodes);
}

function createSelectionRefreshFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const summary = detail === ''
    ? 'Could not refresh the current selection.'
    : `Could not refresh the current selection: ${detail}`;

  return [
    summary,
    'Try changing the selection or reopening the plugin.',
  ].join('\n');
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
    if (connection?.issue) {
      return {
        status: 'connection-issue',
        connectionIssue: connection.issue,
        message: connection.message,
      };
    }

    return { status: 'not-connected' };
  }

  const usage = createUsageSnippet(connection.metadata, selection);

  return {
    status: 'connected',
    code: usage.code,
    diagnostics: formatMappingDiagnostics(usage.diagnostics),
    references: createConnectionReferences(connection.metadata),
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

  const connectionIssue = connection && !connection.ok
    ? connection.issue
    : undefined;

  return {
    status: 'ready',
    selectionToken: selectedNodes[0].id,
    componentName: selection.mainComponent.name,
    figmaSnapshot: createFigmaComponentSnapshot(selection.mainComponent),
    existingConnection: connection?.ok ? connection.metadata : undefined,
    connectionIssue,
    message: connectionIssue
      ? connectionIssue.message
      : connection?.ok
      ? 'This component already has a Storybook connection.'
      : 'This component is ready to connect.',
  };
}

function createFigmaComponentSnapshot(
  component: ConnectableComponentNode,
): FigmaComponentSnapshot {
  const properties: FigmaPropertyDescriptor[] = [];

  for (const [rawKey, definition] of Object.entries(
    component.componentPropertyDefinitions,
  )) {
    if (definition.type === 'SLOT') {
      continue;
    }

    const name = normalizeComponentPropertyName(rawKey);
    const hashIndex = rawKey.lastIndexOf('#');
    const id = hashIndex >= 0 ? rawKey.slice(hashIndex + 1) : rawKey;
    const options = definition.type === 'VARIANT'
      ? [...(definition.variantOptions ?? [])]
      : definition.type === 'BOOLEAN' ? ['False', 'True'] : [];

    properties.push({
      id,
      name,
      options,
      rawKey,
      type: definition.type,
      ...(typeof definition.defaultValue === 'string'
        || typeof definition.defaultValue === 'boolean'
        ? { defaultValue: definition.defaultValue }
        : {}),
    });
  }

  return {
    componentId: component.id,
    componentName: component.name,
    properties,
  };
}

function collectComponentProperties(
  selectedNode: InstanceNode | ComponentNode,
  mainComponent: ComponentNode,
  connectionTarget: ConnectableComponentNode,
): Record<string, string | boolean> {
  const properties = createDictionary<string | boolean>();

  for (const source of [
    readComponentProperties(connectionTarget),
    readComponentProperties(mainComponent),
    readComponentProperties(selectedNode),
  ]) {
    for (const [propertyName, value] of Object.entries(source)) {
      properties[propertyName] = value;
    }
  }

  return properties;
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
  const properties = createDictionary<string | boolean>();

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

  return parsePersistedConnectionMetadata(rawConnection);
}

function preflightStoredConnection(
  mainComponent: ConnectableComponentNode,
): { ok: true } | { message: string; ok: false } {
  const rawConnection = mainComponent.getSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY);

  if (!rawConnection) {
    return { ok: true };
  }

  const connection = parsePersistedConnectionMetadata(rawConnection);
  return connection.ok
    ? { ok: true }
    : { message: connection.message, ok: false };
}

function parsePersistedConnectionMetadata(rawConnection: string): ConnectionReadResult {
  let parsedConnection: unknown;

  try {
    parsedConnection = JSON.parse(rawConnection);
  } catch (_error) {
    const issue: ConnectionIssue = {
      reason: 'malformed-json',
      message: [
        'Stored Storybook connection data is malformed JSON.',
        'The data was left unchanged; repair it with a compatible plugin version before saving or clearing.',
      ].join(' '),
    };
    return { issue, message: issue.message, ok: false };
  }

  const validation = validatePersistedConnectionMetadata(parsedConnection);

  if (!validation.ok) {
    return {
      issue: validation.issue,
      message: validation.issue.message,
      ok: false,
    };
  }

  return {
    metadata: migratePersistedConnectionMetadata(validation.metadata),
    ok: true,
  };
}

function createConnectionReferences(metadata: ConnectionMetadata): ConnectionReferences {
  return {
    storybookUrl: metadata.storybookUrl,
    sourcePath: metadata.sourcePath,
    sourceUrl: metadata.sourceUrl,
    updatedAt: metadata.updatedAt,
  };
}

function createReferenceText(metadata: ConnectionMetadata): string {
  const references = createConnectionReferences(metadata);

  return [
    references.storybookUrl ? `Storybook: ${references.storybookUrl}` : '',
    references.sourcePath ? `Source path: ${references.sourcePath}` : '',
    references.sourceUrl ? `Source URL: ${references.sourceUrl}` : '',
    references.updatedAt ? `Last updated: ${formatDateTime(references.updatedAt)}` : '',
  ].filter(Boolean).join('\n');
}

function normalizeConnectionReferenceUrlsForSave(metadata: ConnectionMetadata):
  | { ok: true; sourceUrl?: string; storybookUrl?: string }
  | { ok: false; message: string } {
  const storybookUrl = metadata.storybookUrl === undefined
    ? undefined
    : normalizeOptionalHttpUrl(metadata.storybookUrl);

  if (metadata.storybookUrl !== undefined && storybookUrl === null) {
    return {
      ok: false,
      message: 'Storybook URL must be a complete HTTP or HTTPS URL without credentials.',
    };
  }

  const sourceUrl = metadata.sourceUrl === undefined
    ? undefined
    : normalizeOptionalHttpUrl(metadata.sourceUrl);

  if (metadata.sourceUrl !== undefined && sourceUrl === null) {
    return {
      ok: false,
      message: 'Source URL must be a complete HTTP or HTTPS URL without credentials.',
    };
  }

  return {
    ok: true,
    sourceUrl: sourceUrl ?? undefined,
    storybookUrl: storybookUrl ?? undefined,
  };
}

function openExternalReference(payload: unknown): void {
  if (
    !isRecord(payload)
    || (payload.target !== 'source' && payload.target !== 'storybook')
    || typeof payload.url !== 'string'
  ) {
    figma.notify('Could not open the reference because its URL is invalid.');
    return;
  }

  const url = normalizeHttpUrl(payload.url);

  if (!url) {
    figma.notify('Only complete HTTP or HTTPS reference URLs can be opened.');
    return;
  }

  try {
    figma.openExternal(url);
  } catch (_error) {
    figma.notify('Could not open the reference in your browser.');
  }
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
