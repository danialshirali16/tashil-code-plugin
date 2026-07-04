import { emit, on, showUI } from '@create-figma-plugin/utilities';

const CONNECTION_NAMESPACE = 'tashil_storybook';
const CONNECTION_KEY = 'connection';

type PropMapping = {
  prop: string;
  value: string | number | boolean;
  raw?: boolean;
};

type ConnectionMetadata = {
  componentName: string;
  importPath: string;
  storybookUrl?: string;
  sourcePath?: string;
  updatedAt?: string;
  defaultProps?: Record<string, string | number | boolean>;
  propMappings?: Record<string, Record<string, PropMapping>>;
};

type ConnectableComponentNode = ComponentNode | ComponentSetNode;

type ResolvedSelection = {
  mainComponent: ConnectableComponentNode;
  componentProperties: Record<string, string | boolean>;
  displayText: string;
  source: 'selection' | 'current-page-fallback';
};

type CodeProp = {
  value: string | number | boolean;
  raw?: boolean;
};

type CodegenBlock = {
  title: string;
  language: 'PLAINTEXT' | 'TYPESCRIPT';
  code: string;
};

type UiSelectionState = {
  status: 'ready' | 'empty';
  componentName?: string;
  existingConnection?: ConnectionMetadata;
  message: string;
};

type SelectionStateHandler = {
  name: 'SELECTION_STATE';
  handler: (state: UiSelectionState) => void;
};

type SaveConnectionHandler = {
  name: 'SAVE_CONNECTION';
  handler: (metadata: ConnectionMetadata) => void;
};

type ClearConnectionHandler = {
  name: 'CLEAR_CONNECTION';
  handler: () => void;
};

type RefreshSelectionHandler = {
  name: 'REFRESH_SELECTION';
  handler: () => void;
};

type CloseHandler = {
  name: 'CLOSE';
  handler: () => void;
};

type SaveResultHandler = {
  name: 'SAVE_RESULT';
  handler: (result: { ok: boolean; message: string }) => void;
};

export default function (): void {
  if (figma.mode !== 'default') {
    return;
  }

  showUI({ width: 460, height: 640 });

  on<SaveConnectionHandler>('SAVE_CONNECTION', (metadata) => {
    void saveConnection(metadata);
  });

  on<ClearConnectionHandler>('CLEAR_CONNECTION', () => {
    void clearConnection();
  });

  on<RefreshSelectionHandler>('REFRESH_SELECTION', () => {
    void sendSelectionState();
  });

  on<CloseHandler>('CLOSE', () => {
    figma.closePlugin();
  });

  figma.on('selectionchange', () => {
    void sendSelectionState();
  });

  void sendSelectionState();
  setTimeout(() => {
    void sendSelectionState();
  }, 250);
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

async function saveConnection(metadata: ConnectionMetadata): Promise<void> {
  const selection = await resolveCurrentSelection();

  if (!selection) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: 'Select a component instance or main component before saving.',
    });
    return;
  }

  const validation = validateConnectionMetadata(metadata);

  if (!validation.ok) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: validation.message,
    });
    return;
  }

  const connectionMetadata = {
    ...metadata,
    updatedAt: new Date().toISOString(),
  };

  selection.mainComponent.setSharedPluginData(
    CONNECTION_NAMESPACE,
    CONNECTION_KEY,
    JSON.stringify(connectionMetadata),
  );

  figma.notify(`${connectionMetadata.componentName} connected to Storybook`);
  await sendSelectionState();
}

async function clearConnection(): Promise<void> {
  const selection = await resolveCurrentSelection();

  if (!selection) {
    emit<SaveResultHandler>('SAVE_RESULT', {
      ok: false,
      message: 'Select a component instance or main component before clearing.',
    });
    return;
  }

  selection.mainComponent.setSharedPluginData(CONNECTION_NAMESPACE, CONNECTION_KEY, '');
  figma.notify('Storybook connection cleared');
  await sendSelectionState();
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
      source: 'selection',
    };
  }

  if (node.type === 'COMPONENT') {
    const connectionTarget = getConnectionTarget(node);

    return {
      mainComponent: connectionTarget,
      componentProperties: collectComponentProperties(node, node, connectionTarget),
      displayText: getDisplayText(node),
      source: 'selection',
    };
  }

  if (node.type === 'COMPONENT_SET') {
    return {
      mainComponent: node,
      componentProperties: readComponentProperties(node),
      displayText: node.name,
      source: 'selection',
    };
  }

  return null;
}

async function resolveCurrentSelection(): Promise<ResolvedSelection | null> {
  const [selectedNode] = figma.currentPage.selection;

  if (!selectedNode) {
    return resolveFallbackComponentFromCurrentPage();
  }

  return resolveSelection(selectedNode);
}

function resolveFallbackComponentFromCurrentPage(): ResolvedSelection | null {
  const candidates = figma.currentPage.findAll((node) => {
    return node.type === 'COMPONENT_SET' || node.type === 'COMPONENT';
  }) as Array<ComponentNode | ComponentSetNode>;

  const componentSets = candidates.filter((node): node is ComponentSetNode => {
    return node.type === 'COMPONENT_SET';
  });

  const exactButton = componentSets.find((node) => {
    return normalizeName(node.name) === 'button';
  });

  const exactNameMatch = componentSets.find((node) => {
    return normalizeName(node.name).includes('button');
  });

  const fallbackTarget = exactButton || exactNameMatch || (componentSets.length === 1 ? componentSets[0] : null);

  if (!fallbackTarget) {
    return null;
  }

  return {
    mainComponent: fallbackTarget,
    componentProperties: readComponentProperties(fallbackTarget),
    displayText: fallbackTarget.name,
    source: 'current-page-fallback',
  };
}

async function sendSelectionState(): Promise<void> {
  const state = await createSelectionState();

  emit<SelectionStateHandler>('SELECTION_STATE', state);
}

async function createSelectionState(): Promise<UiSelectionState> {
  const selection = await resolveCurrentSelection();

  if (!selection) {
    const selectedNodes = figma.currentPage.selection;
    const selectionSummary = selectedNodes.length === 0
      ? 'Selection count: 0'
      : selectedNodes.map((node) => {
        return `${node.type} "${node.name}"`;
      }).join(', ');

    return {
      status: 'empty',
      message: [
        'Select a component instance, main component, or component set to connect it.',
        selectionSummary,
      ].join('\n'),
    };
  }

  const connection = readConnectionMetadata(selection.mainComponent);

  return {
    status: 'ready',
    componentName: selection.mainComponent.name,
    existingConnection: connection.ok ? connection.metadata : undefined,
    message: connection.ok
      ? 'This component already has a Storybook connection.'
      : createReadyMessage(selection),
  };
}

function createReadyMessage(selection: ResolvedSelection): string {
  if (selection.source === 'current-page-fallback') {
    return `No active selection was visible to the plugin. Using "${selection.mainComponent.name}" from the current page.`;
  }

  return 'This component is ready to connect.';
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

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
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
): { ok: true; metadata: ConnectionMetadata } | { ok: false; message: string } {
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
      metadata: parsedConnection,
    };
  } catch (_error) {
    return {
      ok: false,
      message: 'This component has malformed Storybook connection metadata.',
    };
  }
}

function isConnectionMetadata(value: unknown): value is ConnectionMetadata {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.componentName !== 'string' || value.componentName.length === 0) {
    return false;
  }

  if (typeof value.importPath !== 'string' || value.importPath.length === 0) {
    return false;
  }

  if (value.storybookUrl !== undefined && typeof value.storybookUrl !== 'string') {
    return false;
  }

  if (value.sourcePath !== undefined && typeof value.sourcePath !== 'string') {
    return false;
  }

  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'string') {
    return false;
  }

  if (value.defaultProps !== undefined && !isDefaultProps(value.defaultProps)) {
    return false;
  }

  if (value.propMappings !== undefined && !isPropMappings(value.propMappings)) {
    return false;
  }

  return true;
}

function isPropMappings(value: unknown): value is Record<string, Record<string, PropMapping>> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((mappingGroup) => {
    if (!isRecord(mappingGroup)) {
      return false;
    }

    return Object.values(mappingGroup).every((mapping) => {
      if (!isRecord(mapping)) {
        return false;
      }

      const mappingValue = mapping.value;

      return (
        typeof mapping.prop === 'string'
        && mapping.prop.length > 0
        && (
          typeof mappingValue === 'string'
          || typeof mappingValue === 'number'
          || typeof mappingValue === 'boolean'
        )
        && (
          mapping.raw === undefined
          || typeof mapping.raw === 'boolean'
        )
      );
    });
  });
}

function isDefaultProps(value: unknown): value is Record<string, string | number | boolean> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((propValue) => {
    return (
      typeof propValue === 'string'
      || typeof propValue === 'number'
      || typeof propValue === 'boolean'
    );
  });
}

function validateConnectionMetadata(
  metadata: ConnectionMetadata,
): { ok: true } | { ok: false; message: string } {
  if (!isConnectionMetadata(metadata)) {
    return {
      ok: false,
      message: 'Connection metadata is missing a valid component name, import path, or prop mappings value.',
    };
  }

  return { ok: true };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function createUsageSnippet(metadata: ConnectionMetadata, selection: ResolvedSelection): string {
  const props = createMappedProps(metadata, selection.componentProperties);
  const label = getComponentLabel(selection);
  const isIconOnly = props.includes('iconOnly');
  const openTag = createOpeningTag(metadata.componentName, props);

  const lines = [
    `import { ${metadata.componentName} } from '${metadata.importPath}';`,
    '',
  ];

  if (isIconOnly) {
    const iconOnlyOpenTag = createOpeningTag(metadata.componentName, [
      ...props,
      `aria-label="${escapeAttributeValue(label)}"`,
    ]);

    lines.push(iconOnlyOpenTag);
    lines.push('  <Icon />');
    lines.push(`</${metadata.componentName}>`);
    return lines.join('\n');
  }

  lines.push(openTag);
  lines.push(`  ${escapeJsxText(label)}`);
  lines.push(`</${metadata.componentName}>`);

  return lines.join('\n');
}

function createMappedProps(
  metadata: ConnectionMetadata,
  componentProperties: Record<string, string | boolean>,
): string[] {
  const propValues = new Map<string, CodeProp>();

  for (const [prop, value] of Object.entries(getDefaultProps(metadata))) {
    propValues.set(prop, { value });
  }

  for (const [prop, value] of Object.entries(
    getMappedPropValues(getPropMappings(metadata), componentProperties),
  )) {
    propValues.set(prop, value);
  }

  return Array.from(propValues.entries()).flatMap(([prop, value]) => {
    const assignment = formatPropAssignment(prop, value);
    return assignment ? [assignment] : [];
  });
}

function getMappedPropValues(
  propMappings: NonNullable<ConnectionMetadata['propMappings']>,
  componentProperties: Record<string, string | boolean>,
): Record<string, CodeProp> {
  if (!propMappings) {
    return {};
  }

  return Object.fromEntries(Object.entries(componentProperties).flatMap(([figmaProperty, figmaValue]) => {
    const mapping = propMappings[figmaProperty]?.[String(figmaValue)];

    if (!mapping) {
      return [];
    }

    return [[mapping.prop, { value: mapping.value, raw: mapping.raw }]];
  }));
}

function getPropMappings(metadata: ConnectionMetadata): NonNullable<ConnectionMetadata['propMappings']> {
  return {
    ...getDefaultPropMappings(metadata),
    ...metadata.propMappings,
  };
}

function getDefaultPropMappings(metadata: ConnectionMetadata): NonNullable<ConnectionMetadata['propMappings']> {
  if (metadata.componentName !== 'Button' || metadata.importPath !== 'tashil-ui') {
    return {};
  }

  return {
    intent: {
      primary: { prop: 'intent', value: 'primary' },
      neutral: { prop: 'intent', value: 'neutral' },
      positive: { prop: 'intent', value: 'success' },
      negative: { prop: 'intent', value: 'error' },
    },
    style: {
      solid: { prop: 'variant', value: 'solid' },
      tonal: { prop: 'variant', value: 'tonal' },
      outline: { prop: 'variant', value: 'outline' },
      ghost: { prop: 'variant', value: 'ghost' },
      link: { prop: 'variant', value: 'link' },
    },
    state: {
      loading: { prop: 'loading', value: true },
      disabled: { prop: 'disabled', value: true },
    },
    size: {
      md: { prop: 'size', value: 'md' },
      sm: { prop: 'size', value: 'sm' },
    },
    isOnlyIcon: {
      true: { prop: 'iconOnly', value: true },
    },
    hasLeadingIcon: {
      true: { prop: 'leadingIcon', value: '<Icon />', raw: true },
    },
    hasTrailingIcon: {
      true: { prop: 'trailingIcon', value: '<Icon />', raw: true },
    },
  };
}

function getDefaultProps(metadata: ConnectionMetadata): Record<string, string | number | boolean> {
  if (metadata.defaultProps) {
    return metadata.defaultProps;
  }

  if (metadata.componentName === 'Button' && metadata.importPath === 'tashil-ui') {
    return {
      intent: 'primary',
      variant: 'solid',
      size: 'md',
    };
  }

  return {};
}

function formatPropAssignment(prop: string, propValue: CodeProp): string | null {
  if (propValue.value === false) {
    return null;
  }

  if (propValue.value === true) {
    return prop;
  }

  if (propValue.raw && typeof propValue.value === 'string') {
    return `${prop}={${propValue.value}}`;
  }

  return `${prop}=${formatPropValue(propValue.value)}`;
}

function formatPropValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return `"${escapeAttributeValue(value)}"`;
  }

  return `{${String(value)}}`;
}

function createReferenceText(metadata: ConnectionMetadata): string {
  return [
    metadata.storybookUrl ? `Storybook: ${metadata.storybookUrl}` : '',
    metadata.sourcePath ? `Source: ${metadata.sourcePath}` : '',
    metadata.updatedAt ? `Last updated: ${formatDateTime(metadata.updatedAt)}` : '',
  ].filter(Boolean).join('\n');
}

function createOpeningTag(componentName: string, props: string[]): string {
  if (props.length === 0) {
    return `<${componentName}>`;
  }

  if (props.length <= 3) {
    return `<${componentName} ${props.join(' ')}>`;
  }

  return [
    `<${componentName}`,
    ...props.map((prop) => {
      return `  ${prop}`;
    }),
    '>',
  ].join('\n');
}

function getDisplayText(node: SceneNode): string {
  if ('characters' in node && typeof node.characters === 'string' && node.characters.length > 0) {
    return node.characters;
  }

  return node.name;
}

function getComponentLabel(selection: ResolvedSelection): string {
  const label = selection.componentProperties.label;

  if (typeof label === 'string' && label.trim().length > 0) {
    return label;
  }

  return selection.displayText;
}

function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function escapeAttributeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeJsxText(value: string): string {
  return value.replace(/{/g, '&#123;').replace(/}/g, '&#125;');
}

function createPlainTextBlock(title: string, code: string): CodegenBlock {
  return {
    title,
    language: 'PLAINTEXT',
    code,
  };
}
