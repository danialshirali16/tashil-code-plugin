import { emit } from '@create-figma-plugin/utilities';
import {
  createComponentUsage,
  isPropMappings,
  migratePersistedConnectionMetadata,
  validateConnectionMetadata,
  validatePersistedConnectionMetadata,
  type ResolvedInstanceSwap,
} from '../codegen';
import { generateStorybookCsf, STORYBOOK_COMBINATION_LIMIT } from '../storybook';
import { formatGeneratedCode } from '../output-preferences';
import { normalizeHttpUrl, normalizeOptionalHttpUrl } from '../external-url';
import {
  parseConnectionExport,
  serializeConnectionExport,
  type ConnectionExportEntry,
} from '../connection-portability';
import { generateCodeConnectFile } from '../code-connect';
import { createReactPropIdentifier } from '../prop-mappings';
import { createSemanticNodeTree } from '../semantic/figma-adapter';
import { extractFigmaSemanticSnapshot } from '../semantic/figma-extractor';
import type { FigmaSemanticSnapshot } from '../semantic/types';
import {
  generateVariantLogic,
  type VariantLogicResult,
} from '../layout/variant-logic';
import {
  CONNECTION_KEY,
  CONNECTION_NAMESPACE,
  CURRENT_SCHEMA_VERSION,
  type ApplyConnectionImportResultHandler,
  type ComponentConnectionStatus,
  type ComponentInventoryItem,
  type ComponentInventoryStateHandler,
  type ComponentTargetStateHandler,
  type ConnectionCoverageReport,
  type ConnectionIssue,
  type ConnectionMetadata,
  type ConnectionReferences,
  type ExportConnectionsResultHandler,
  type FigmaComponentSnapshot,
  type FigmaPropertyDescriptor,
  type GenerateCodeConnectResultHandler,
  type GenerateStoriesResultHandler,
  type PreviewConnectionImportResultHandler,
  type PropMapping,
  type PropMappings,
  type SaveResultHandler,
  type ScaffoldResultHandler,
  type UiTargetState,
} from '../types';
import {
  createDictionary,
  createMutationFailureMessage,
  errorMessage,
  formatDateTime,
  normalizeComponentPropertyName,
  runBestEffort,
  type ConnectableComponentNode,
  type ConnectionReadResult,
  type MutationTargetResult,
  type ResolvedSelection,
} from './types';
import { loadOutputPreferences } from './preferences';
import { createConnectedOutput } from './codegen-adapter';

export let latestComponentScanId: string | undefined;
export let latestTargetRequestId: string | undefined;

export function readConnectionMetadata(
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

export function preflightStoredConnection(
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

export function parsePersistedConnectionMetadata(rawConnection: string): ConnectionReadResult {
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

export function createConnectionReferences(metadata: ConnectionMetadata): ConnectionReferences {
  return {
    storybookUrl: metadata.storybookUrl,
    sourcePath: metadata.sourcePath,
    sourceUrl: metadata.sourceUrl,
    updatedAt: metadata.updatedAt,
  };
}

export function createReferenceText(metadata: ConnectionMetadata): string {
  const references = createConnectionReferences(metadata);

  return [
    references.storybookUrl ? `Storybook: ${references.storybookUrl}` : '',
    references.sourcePath ? `Source path: ${references.sourcePath}` : '',
    references.sourceUrl ? `Source URL: ${references.sourceUrl}` : '',
    references.updatedAt ? `Last updated: ${formatDateTime(references.updatedAt)}` : '',
  ].filter(Boolean).join('\n');
}

export function normalizeConnectionReferenceUrlsForSave(metadata: ConnectionMetadata):
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

export function openExternalReference(payload: unknown): void {
  if (
    !payload
    || typeof payload !== 'object'
    || !('target' in payload)
    || (payload.target !== 'source' && payload.target !== 'storybook')
    || typeof (payload as { url?: unknown }).url !== 'string'
  ) {
    figma.notify('Could not open the reference because its URL is invalid.');
    return;
  }

  const url = normalizeHttpUrl(((payload as Record<string, unknown>).url as string));

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

export function getDisplayText(node: SceneNode): string {
  if ('characters' in node && typeof node.characters === 'string' && node.characters.length > 0) {
    return node.characters;
  }

  return node.name;
}

export function createSelectionVariantLogic(
  selection: ResolvedSelection,
): VariantLogicResult | undefined {
  if (selection.mainComponent.type !== 'COMPONENT_SET') {
    return undefined;
  }

  return generateVariantLogic(
    selection.mainComponent,
    selection.componentProperties,
  );
}

export function createSelectionLayoutName(
  selection: ResolvedSelection,
): string | undefined {
  return selection.mainComponent.type === 'COMPONENT_SET'
    ? selection.mainComponent.name
    : undefined;
}

export function createFigmaComponentSnapshot(
  component: ConnectableComponentNode,
): FigmaComponentSnapshot {
  const properties: FigmaPropertyDescriptor[] = [];
  const description = typeof component.description === 'string'
    ? component.description.trim()
    : '';

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
    ...(description ? { description } : {}),
    properties,
  };
}

export async function createTargetSemanticSnapshot(
  component: ConnectableComponentNode,
): Promise<FigmaSemanticSnapshot | undefined> {
  try {
    const scanRoot = component.type === 'COMPONENT_SET'
      ? component.children.find((child) => child.type === 'COMPONENT')
      : component;
    if (!scanRoot) {
      return undefined;
    }

    const tree = await createSemanticNodeTree(scanRoot);
    const { snapshot } = extractFigmaSemanticSnapshot(tree, component.id);
    return { ...snapshot, componentName: component.name };
  } catch (_error) {
    return undefined;
  }
}

export async function createTargetState(
  selection: ResolvedSelection,
  connection: ConnectionReadResult,
): Promise<Extract<UiTargetState, { status: 'ready' }>> {
  const connectionIssue = !connection.ok ? connection.issue : undefined;

  return {
    status: 'ready',
    targetToken: selection.mainComponent.id,
    componentName: selection.mainComponent.name,
    figmaSnapshot: createFigmaComponentSnapshot(selection.mainComponent),
    semanticSnapshot: await createTargetSemanticSnapshot(selection.mainComponent),
    existingConnection: connection.ok ? connection.metadata : undefined,
    connectionIssue,
    message: connectionIssue
      ? connectionIssue.message
      : connection.ok
      ? 'This component already has a Storybook connection.'
      : 'This component is ready to connect.',
  };
}

export function getConnectionTarget(component: ComponentNode): ConnectableComponentNode {
  if (component.parent?.type === 'COMPONENT_SET') {
    return component.parent;
  }

  return component;
}

export function readComponentProperties(
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

export function collectComponentProperties(
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

export async function resolveInstanceSwapComponent(
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

export function createInstanceSwapReactPropIdentifier(figmaPropertyName: string): string | null {
  const normalized = createReactPropIdentifier(figmaPropertyName);

  if (normalized === 'leadingIcon' || normalized === 'leftIcon') {
    return 'renderRightIcon';
  }

  if (normalized === 'trailingIcon' || normalized === 'rightIcon') {
    return 'renderLeftIcon';
  }

  return normalized;
}

export function isIconRenderProp(prop: string): boolean {
  return prop === 'renderLeftIcon' || prop === 'renderRightIcon';
}

export async function collectInstanceSwaps(
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

export async function resolveSelection(node: SceneNode): Promise<ResolvedSelection | null> {
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

export async function resolveTargetById(targetToken: string): Promise<MutationTargetResult> {
  let node: BaseNode | null;

  try {
    node = await figma.getNodeByIdAsync(targetToken);
  } catch (_error) {
    node = null;
  }

  if (
    !node
    || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')
    || node.remote
  ) {
    return {
      ok: false,
      message: 'This component is no longer available. Scan the file again and retry.',
    };
  }

  const selection = await resolveSelection(node);

  if (
    !selection
    || selection.mainComponent.id !== targetToken
    || selection.mainComponent.remote
  ) {
    return {
      ok: false,
      message: 'This component changed after the last scan. Scan the file again and retry.',
    };
  }

  return { ok: true, selection };
}

export async function sendComponentTargetState(
  requestId: string,
  targetToken: string,
): Promise<void> {
  latestTargetRequestId = requestId;

  try {
    const result = await resolveTargetById(targetToken);
    if (latestTargetRequestId !== requestId) {
      return;
    }

    const state = result.ok
      ? await createTargetState(
          result.selection,
          readConnectionMetadata(result.selection.mainComponent),
        )
      : { status: 'empty' as const, message: result.message };

    emit<ComponentTargetStateHandler>('COMPONENT_TARGET_STATE', {
      requestId,
      state,
    });
  } catch (error) {
    if (latestTargetRequestId !== requestId) {
      return;
    }

    const detail = error instanceof Error && error.message.trim() !== ''
      ? ` ${error.message}`
      : '';
    emit<ComponentTargetStateHandler>('COMPONENT_TARGET_STATE', {
      requestId,
      state: {
        status: 'empty',
        message: `Could not open this component.${detail}`,
      },
    });
  }
}

export async function collectLocalConnectionTargets(): Promise<ConnectableComponentNode[]> {
  const targets: ConnectableComponentNode[] = [];
  const seen = new Set<string>();
  for (const page of figma.root.children) {
    await page.loadAsync();
    for (const node of page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
      if (node.remote || (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET')) continue;
      if (!seen.has(node.id)) { seen.add(node.id); targets.push(node); }
    }
  }
  return targets;
}

export function getTargetPageName(target: ConnectableComponentNode): string {
  let parent = target.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') parent = parent.parent;
  return parent?.type === 'PAGE' ? parent.name : '';
}

export function connectionTargetIdentity(nodeType: string, componentName: string, pageName: string): string {
  return `${nodeType}\u0000${pageName}\u0000${componentName}`;
}

export async function exportConnections(): Promise<void> {
  try {
    const entries: ConnectionExportEntry[] = [];
    for (const target of await collectLocalConnectionTargets()) {
      const connection = readConnectionMetadata(target);
      if (!connection.ok) continue;
      entries.push({
        connection: connection.metadata,
        locator: {
          componentKey: target.key,
          figmaComponentName: target.name,
          nodeType: target.type,
          pageName: getTargetPageName(target),
        },
      });
    }
    emit<ExportConnectionsResultHandler>('EXPORT_CONNECTIONS_RESULT', {
      json: serializeConnectionExport(entries, '1.0.0', new Date().toISOString()),
      ok: true,
    });
  } catch (error) {
    emit<ExportConnectionsResultHandler>('EXPORT_CONNECTIONS_RESULT', { ok: false, message: errorMessage(error, 'export connections') });
  }
}

export async function previewConnectionImport(raw: string): Promise<void> {
  const parsed = parseConnectionExport(raw);
  if (!parsed.ok) {
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', parsed);
    return;
  }
  try {
    const targets = await collectLocalConnectionTargets();
    const byKey = new Map(targets.map((target) => [target.key, target]));
    const byIdentity = new Map<string, ConnectableComponentNode[]>();
    for (const target of targets) {
      const key = connectionTargetIdentity(target.type, target.name, getTargetPageName(target));
      byIdentity.set(key, [...(byIdentity.get(key) ?? []), target]);
    }
    const entries = parsed.document.connections.map(({ connection, locator }) => {
      const identityMatches = byIdentity.get(connectionTargetIdentity(
        locator.nodeType,
        locator.figmaComponentName,
        locator.pageName,
      ));
      const target = byKey.get(locator.componentKey)
        ?? (identityMatches?.length === 1 ? identityMatches[0] : undefined);
      if (!target) return { componentName: locator.figmaComponentName, imported: connection, status: 'missing' as const };
      const current = readConnectionMetadata(target);
      return {
        componentName: target.name,
        imported: connection,
        status: current.ok ? 'conflict' as const : 'matched' as const,
        targetToken: target.id,
      };
    });
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', { entries, ok: true });
  } catch (error) {
    emit<PreviewConnectionImportResultHandler>('PREVIEW_CONNECTION_IMPORT_RESULT', { ok: false, message: errorMessage(error, 'preview connection import') });
  }
}

export async function applyConnectionImport(
  choices: Array<{ action: 'overwrite' | 'skip'; imported: ConnectionMetadata; targetToken: string }>,
): Promise<void> {
  let applied = 0;
  try {
    for (const choice of choices) {
      if (choice.action === 'skip') continue;
      const validation = validateConnectionMetadata(choice.imported);
      if (!validation.ok) throw new Error(validation.message);
      const resolved = await resolveTargetById(choice.targetToken);
      if (!resolved.ok) throw new Error(resolved.message);
      resolved.selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, JSON.stringify(choice.imported));
      applied += 1;
    }
    emit<ApplyConnectionImportResultHandler>('APPLY_CONNECTION_IMPORT_RESULT', { applied, ok: true });
  } catch (error) {
    emit<ApplyConnectionImportResultHandler>('APPLY_CONNECTION_IMPORT_RESULT', { applied, ok: false, message: errorMessage(error, 'apply connection import') });
  }
}

export async function createStorybookForSelection(
  metadata: ConnectionMetadata,
  selection: ResolvedSelection,
  selectedVariantTokens?: readonly string[],
  allowCurrentSelectionFallback = true,
): Promise<Parameters<GenerateStoriesResultHandler['handler']>[0]> {
  const target = selection.mainComponent;
  if (target.type !== 'COMPONENT_SET') {
    return {
      code: generateStorybookCsf(metadata.componentName, [{
        name: 'Default',
        usage: createComponentUsage(metadata, selection),
      }]),
      fileName: `${metadata.componentName}.stories.tsx`,
      ok: true,
    };
  }

  const variants = target.children.filter((child): child is ComponentNode => child.type === 'COMPONENT');
  if (selectedVariantTokens === undefined && variants.length > STORYBOOK_COMBINATION_LIMIT) {
    if (allowCurrentSelectionFallback) {
      return {
        code: generateStorybookCsf(metadata.componentName, [{
          name: createVariantStoryName(selection.componentProperties),
          usage: createComponentUsage(metadata, selection),
        }]),
        fileName: `${metadata.componentName}.stories.tsx`,
        ok: true,
      };
    }
    return {
      message: `This component set has ${variants.length} combinations. Select up to ${STORYBOOK_COMBINATION_LIMIT} to generate.`,
      ok: false,
      variants: variants.map((variant) => ({ label: variant.name, targetToken: variant.id })),
    };
  }

  const selected = selectedVariantTokens === undefined
    ? variants
    : variants.filter((variant) => selectedVariantTokens.includes(variant.id));
  if (selected.length === 0) return { message: 'Select at least one variant.', ok: false };
  if (selected.length > STORYBOOK_COMBINATION_LIMIT) return { message: `Select no more than ${STORYBOOK_COMBINATION_LIMIT} variants.`, ok: false };
  const stories = [];
  for (const variant of selected) {
    const variantSelection = await resolveSelection(variant);
    if (!variantSelection) continue;
    stories.push({ name: variant.name, usage: createComponentUsage(metadata, variantSelection) });
  }
  return {
    code: generateStorybookCsf(metadata.componentName, stories),
    fileName: `${metadata.componentName}.stories.tsx`,
    ok: true,
  };
}

export function createVariantStoryName(properties: Readonly<Record<string, string | boolean>>): string {
  const values = Object.values(properties).filter((value): value is string => typeof value === 'string');
  return values.length > 0 ? values.join(' ') : 'Selected variant';
}

export async function generateStories(targetToken: string, selectedVariantTokens?: string[]): Promise<void> {
  try {
    const resolved = await resolveTargetById(targetToken);
    if (!resolved.ok) throw new Error(resolved.message);
    const connection = readConnectionMetadata(resolved.selection.mainComponent);
    if (!connection.ok) throw new Error(connection.message);
    const result = await createStorybookForSelection(
      connection.metadata,
      resolved.selection,
      selectedVariantTokens,
      false,
    );
    const preferences = await loadOutputPreferences();
    emit<GenerateStoriesResultHandler>('GENERATE_STORIES_RESULT', result.code
      ? { ...result, code: formatGeneratedCode(result.code, preferences) }
      : result);
  } catch (error) {
    emit<GenerateStoriesResultHandler>('GENERATE_STORIES_RESULT', {
      message: errorMessage(error, 'generate stories'),
      ok: false,
    });
  }
}

export async function generateCodeConnect(targetToken: string): Promise<void> {
  try {
    const resolved = await resolveTargetById(targetToken);
    if (!resolved.ok) throw new Error(resolved.message);
    const connection = readConnectionMetadata(resolved.selection.mainComponent);
    if (!connection.ok) throw new Error(connection.message);
    if (!figma.fileKey) throw new Error('Save this Figma file before generating Code Connect output.');
    const output = await createConnectedOutput(
      connection.metadata,
      resolved.selection,
      resolved.selection.mainComponent,
    );
    const nodeId = resolved.selection.mainComponent.id.replace(/:/g, '-');
    const componentUrl = `https://www.figma.com/design/${figma.fileKey}?node-id=${encodeURIComponent(nodeId)}`;
    emit<GenerateCodeConnectResultHandler>('GENERATE_CODE_CONNECT_RESULT', {
      ...generateCodeConnectFile(connection.metadata.componentName, componentUrl, output.usage),
      ok: true,
    });
  } catch (error) {
    emit<GenerateCodeConnectResultHandler>('GENERATE_CODE_CONNECT_RESULT', {
      message: errorMessage(error, 'generate Code Connect output'),
      ok: false,
    });
  }
}

export function getNodeLayerPath(node: SceneNode): string {
  const names: string[] = [node.name];
  let parent = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    if ('name' in parent) names.unshift(parent.name);
    parent = parent.parent;
  }
  return names.join(' / ');
}

export function emitInventoryState(
  scanId: string,
  state: Parameters<ComponentInventoryStateHandler['handler']>[0]['state'],
): void {
  if (latestComponentScanId !== scanId) {
    return;
  }
  emit<ComponentInventoryStateHandler>('COMPONENT_INVENTORY_STATE', {
    scanId,
    state,
  });
}

export function getInventoryConnectionStatus(
  component: ConnectableComponentNode,
): ComponentConnectionStatus {
  try {
    const connection = readConnectionMetadata(component);
    if (connection.ok) {
      return 'connected';
    }
    return connection.issue ? 'needs-attention' : 'not-connected';
  } catch (_error) {
    return 'needs-attention';
  }
}

export async function scanComponents(scanId: string, includeCoverage = false): Promise<void> {
  latestComponentScanId = scanId;

  try {
    const pages = [...figma.root.children];
    const totalPages = pages.length;
    const items: ComponentInventoryItem[] = [];
    const skippedPageNames: string[] = [];
    const seenTargetTokens = new Set<string>();
    const instanceCounts = new Map<string, number>();
    const coverage: ConnectionCoverageReport | undefined = includeCoverage ? {
      brokenInstanceCount: 0,
      brokenInstances: [],
      connectedInstanceCount: 0,
      totalInstanceCount: 0,
    } : undefined;

    emitInventoryState(scanId, {
      scannedPages: 0,
      status: 'scanning',
      totalPages,
    });

    for (let index = 0; index < pages.length; index += 1) {
      if (latestComponentScanId !== scanId) {
        return;
      }

      const page = pages[index];
      try {
        await page.loadAsync();
        const nodes = page.findAllWithCriteria({
          types: ['COMPONENT', 'COMPONENT_SET'],
        });

        for (const node of nodes) {
          if (
            node.remote
            || (node.type === 'COMPONENT' && node.parent?.type === 'COMPONENT_SET')
            || seenTargetTokens.has(node.id)
          ) {
            continue;
          }

          seenTargetTokens.add(node.id);
          items.push({
            componentName: node.name,
            nodeType: node.type,
            pageName: page.name,
            status: getInventoryConnectionStatus(node),
            targetToken: node.id,
          });
        }

        const instances = includeCoverage
          ? page.findAllWithCriteria({ types: ['INSTANCE'] })
            .filter((node): node is InstanceNode => node.type === 'INSTANCE')
          : [];
        for (let offset = 0; coverage && offset < instances.length; offset += 40) {
          if (latestComponentScanId !== scanId) return;
          const chunk = instances.slice(offset, offset + 40);
          await Promise.all(chunk.map(async (instance) => {
            coverage.totalInstanceCount += 1;
            const mainComponent = await instance.getMainComponentAsync();
            if (!mainComponent) {
              coverage.brokenInstanceCount += 1;
              if (coverage.brokenInstances.length < 100) {
                coverage.brokenInstances.push({
                  layerPath: getNodeLayerPath(instance),
                  pageName: page.name,
                });
              }
              return;
            }
            const target = getConnectionTarget(mainComponent);
            instanceCounts.set(target.id, (instanceCounts.get(target.id) ?? 0) + 1);
            if (readConnectionMetadata(target).ok) coverage.connectedInstanceCount += 1;
          }));
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
      } catch (_error) {
        skippedPageNames.push(page.name);
      }

      emitInventoryState(scanId, {
        scannedPages: index + 1,
        status: 'scanning',
        totalPages,
      });
    }

    if (latestComponentScanId !== scanId) {
      return;
    }

    if (coverage) {
      for (const item of items) item.instanceCount = instanceCounts.get(item.targetToken) ?? 0;
    }
    items.sort((first, second) => (
      (coverage ? (second.instanceCount ?? 0) - (first.instanceCount ?? 0) : 0)
      || first.componentName.localeCompare(second.componentName, undefined, {
        sensitivity: 'base',
      })
      || first.pageName.localeCompare(second.pageName, undefined, {
        sensitivity: 'base',
      })
    ));

    if (skippedPageNames.length > 0) {
      emitInventoryState(scanId, {
        ...(coverage ? { coverage } : {}),
        items,
        message: [
          `${skippedPageNames.length} page${skippedPageNames.length === 1 ? '' : 's'} could not be scanned.`,
          `Skipped: ${skippedPageNames.join(', ')}.`,
        ].join(' '),
        scannedPages: totalPages,
        skippedPageNames,
        status: 'partial',
        totalPages,
      });
      return;
    }

    emitInventoryState(scanId, {
      ...(coverage ? { coverage } : {}),
      items,
      scannedPages: totalPages,
      status: 'ready',
      totalPages,
    });
  } catch (error) {
    if (latestComponentScanId !== scanId) {
      return;
    }

    const detail = error instanceof Error && error.message.trim() !== ''
      ? ` ${error.message}`
      : '';
    emitInventoryState(scanId, {
      message: `Could not scan this file.${detail}`,
      status: 'error',
    });
  }
}

export async function saveConnection(
  metadata: ConnectionMetadata,
  targetToken: string,
  operationId: string,
  onSaved?: () => void,
): Promise<void> {
  let selection: ResolvedSelection;
  let savedMetadata: ConnectionMetadata;

  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'save',
        operationId,
        targetToken,
      });
      return;
    }

    selection = result.selection;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'save',
        operationId,
        targetToken,
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
        targetToken,
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
        targetToken,
      });
      return;
    }

    const savedAt = new Date().toISOString();
    const connectionMetadata: ConnectionMetadata = {
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
    savedMetadata = connectionMetadata;
  } catch (error) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: createMutationFailureMessage('save the connection', error),
      operation: 'save',
      operationId,
      targetToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection saved.',
    operation: 'save',
    operationId,
    targetState: await createTargetState(
      selection,
      { metadata: savedMetadata, ok: true },
    ),
    targetToken,
  });
  runBestEffort(() => {
    figma.notify(`${metadata.componentName} connected to Storybook`);
  });
  if (onSaved) {
    runBestEffort(onSaved);
  }
}

export async function clearConnection(
  targetToken: string,
  operationId: string,
  onCleared?: () => void,
): Promise<void> {
  let selection: ResolvedSelection;

  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: result.message,
        operation: 'clear',
        operationId,
        targetToken,
      });
      return;
    }

    selection = result.selection;

    const preflight = preflightStoredConnection(selection.mainComponent);

    if (!preflight.ok) {
      emit<SaveResultHandler>('SAVE_RESULT', {
        ok: false,
        message: preflight.message,
        operation: 'clear',
        operationId,
        targetToken,
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
      targetToken,
    });
    return;
  }

  emit<SaveResultHandler>('SAVE_RESULT', {
    ok: true,
    message: 'Connection cleared.',
    operation: 'clear',
    operationId,
    targetState: await createTargetState(
      selection,
      {
        ok: false,
        message: 'This component is ready to connect.',
      },
    ),
    targetToken,
  });
  runBestEffort(() => {
    figma.notify('Storybook connection cleared');
  });
  if (onCleared) {
    runBestEffort(onCleared);
  }
}

export async function scaffoldPropMappings(
  targetToken: string,
  operationId: string,
): Promise<void> {
  try {
    const result = await resolveTargetById(targetToken);

    if (!result.ok) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: result.message,
        operationId,
        targetToken,
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
        targetToken,
      });
      return;
    }

    if (Object.keys(mappings).length === 0) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'No variant or active instance-swap properties found on this component to scaffold.',
        operationId,
        targetToken,
      });
      return;
    }

    if (!isPropMappings(mappings)) {
      emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
        ok: false,
        message: 'Generated prop mappings were invalid. Rename the Figma variant properties or enter mappings manually.',
        operationId,
        targetToken,
      });
      return;
    }

    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: true,
      mappings,
      operationId,
      targetToken,
    });
  } catch (error) {
    emit<ScaffoldResultHandler>('SCAFFOLD_RESULT', {
      ok: false,
      message: createMutationFailureMessage('generate prop mappings', error),
      operationId,
      targetToken,
    });
  }
}
