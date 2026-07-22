import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CHILDREN_TEXT_PROPERTY,
  type ConnectionIssue,
  type ConnectionMetadata,
  type PropMapping,
} from './types';
import { isMappingDocument } from './mapping-document';

/**
 * Pure, Figma-agnostic codegen + validation helpers. Kept separate from
 * `main.ts` so they can be unit-tested without the Figma runtime.
 */

export type CodeProp = {
  value: string | number | boolean;
  raw?: boolean;
  namedImports?: readonly string[];
};

export type MappingSource = {
  figmaProperty: string;
  figmaValue: string | boolean;
};

export type MappingDiagnostic =
  | ({ kind: 'unmapped-property' } & MappingSource)
  | ({ kind: 'unmapped-value' } & MappingSource)
  | {
      kind: 'missing-children-source';
      figmaProperty: string;
    }
  | {
      kind: 'duplicate-target';
      prop: string;
      sources: MappingSource[];
    }
  | {
      kind: 'reserved-target';
      prop: string;
      sources: MappingSource[];
    };

export type CreateMappedPropsOptions = {
  consumedFigmaProperty?: string;
  ignoredFigmaProperties?: ReadonlySet<string>;
  instanceSwaps?: Readonly<Record<string, ResolvedInstanceSwap>>;
  reservedReactProps?: ReadonlySet<string>;
};

export type ResolvedInstanceSwap = {
  componentId: string;
  componentName: string;
};

export type ResolvedChildrenText = {
  sourceProperty?: string;
  text: string;
};

export type MappedPropsResult = {
  diagnostics: MappingDiagnostic[];
  namedImports?: string[];
  props: string[];
};

export type UsageSnippetResult = {
  code: string;
  diagnostics: MappingDiagnostic[];
};

/**
 * Minimal view of a resolved selection. Mirrors the relevant fields of
 * `ResolvedSelection` in main.ts without dragging in Figma node types.
 */
export type SelectionLike = {
  componentProperties: Record<string, string | boolean>;
  displayText: string;
  instanceSwaps?: Record<string, ResolvedInstanceSwap>;
};

/**
 * Characters that are unsafe as bare JSX text. If a label contains any of
 * these, it is rendered as a string expression (`{"... "}`) so the generated
 * snippet is always valid, pastable `.tsx`.
 */
const UNSAFE_JSX_TEXT_PATTERN = /[&<>{}\r\n\t\f]/;

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;
const JSX_ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*$/;
const CHILDREN_RESERVED_REACT_PROPS: ReadonlySet<string> = new Set(['children']);
const ICON_RESERVED_REACT_PROPS: ReadonlySet<string> = new Set(['aria-label', 'children']);
const ICON_VISIBILITY_GUARDS = [
  { guardProperty: 'hasLeadingIcon', swapProperty: 'leadingIcon' },
  { guardProperty: 'hasTrailingIcon', swapProperty: 'trailingIcon' },
] as const;

function getOwnEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

export function createUsageSnippet(
  metadata: ConnectionMetadata,
  selection: SelectionLike,
): UsageSnippetResult {
  const validation = validateConnectionMetadata(metadata);

  if (!validation.ok) {
    throw new TypeError(validation.message);
  }

  const isFigmaIconOnly = isIconOnlySelection(selection.componentProperties);
  const childrenMode = isFigmaIconOnly
    ? 'none'
    : metadata.childrenMode ?? 'text';
  const childrenTextProperty = metadata.childrenTextProperty
    ?? DEFAULT_CHILDREN_TEXT_PROPERTY;
  const resolvedChildren = childrenMode === 'none'
    ? undefined
    : resolveChildrenText(
        selection,
        childrenTextProperty,
      );
  const ignoredFigmaProperties = isFigmaIconOnly
    ? createIconOnlyIgnoredProperties(selection.componentProperties, childrenTextProperty)
    : undefined;
  const mappedProps = createMappedProps(
    metadata.propMappings ?? {},
    selection.componentProperties,
    {
      consumedFigmaProperty: resolvedChildren?.sourceProperty,
      ignoredFigmaProperties,
      instanceSwaps: selection.instanceSwaps,
      reservedReactProps: childrenMode === 'icon-only'
        ? ICON_RESERVED_REACT_PROPS
        : CHILDREN_RESERVED_REACT_PROPS,
    },
  );
  const diagnostics = [...mappedProps.diagnostics];

  if (resolvedChildren?.sourceProperty === undefined && childrenMode !== 'none') {
    diagnostics.push({
      kind: 'missing-children-source',
      figmaProperty: metadata.childrenTextProperty ?? DEFAULT_CHILDREN_TEXT_PROPERTY,
    });
  }

  const lines = [
    ...createImportLines(metadata, mappedProps.namedImports),
    '',
  ];

  if (childrenMode === 'none') {
    lines.push(createSelfClosingTag(metadata.componentName, mappedProps.props));
    return { code: lines.join('\n'), diagnostics };
  }

  if (childrenMode === 'icon-only') {
    const iconOnlyOpenTag = createOpeningTag(metadata.componentName, [
      ...mappedProps.props,
      `aria-label=${formatPropValue(resolvedChildren!.text)}`,
    ]);

    lines.push(iconOnlyOpenTag);
    lines.push(`  <${metadata.iconComponentName!} />`);
    lines.push(`</${metadata.componentName}>`);
    return { code: lines.join('\n'), diagnostics };
  }

  lines.push(createOpeningTag(metadata.componentName, mappedProps.props));
  lines.push(`  ${formatJsxChildren(resolvedChildren!.text)}`);
  lines.push(`</${metadata.componentName}>`);

  return { code: lines.join('\n'), diagnostics };
}

export function createMappedProps(
  propMappings: NonNullable<ConnectionMetadata['propMappings']>,
  componentProperties: Record<string, string | boolean>,
  options: CreateMappedPropsOptions = {},
): MappedPropsResult {
  const diagnostics: MappingDiagnostic[] = [];
  const candidates = new Map<string, Array<{ source: MappingSource; value: CodeProp }>>();

  for (const [figmaProperty, figmaValue] of Object.entries(componentProperties)) {
    if (options.ignoredFigmaProperties?.has(figmaProperty)) {
      continue;
    }

    if (isConsumedIconVisibilityGuard(figmaProperty, componentProperties)) {
      continue;
    }

    if (isHiddenInstanceSwap(figmaProperty, componentProperties)) {
      continue;
    }

    const mappingGroup = getOwnEntry(propMappings, figmaProperty);

    if (!mappingGroup) {
      if (figmaProperty !== options.consumedFigmaProperty) {
        diagnostics.push({ kind: 'unmapped-property', figmaProperty, figmaValue });
      }
      continue;
    }

    const explicitMapping = getOwnEntry(mappingGroup, String(figmaValue));
    const resolvedInstanceSwapMapping = createResolvedInstanceSwapMapping(
      figmaProperty,
      figmaValue,
      mappingGroup,
      options.instanceSwaps,
    );
    const mapping: ResolvedPropMapping | undefined = resolvedInstanceSwapMapping?.raw
      ? resolvedInstanceSwapMapping
      : explicitMapping ?? resolvedInstanceSwapMapping;

    if (!mapping) {
      if (figmaProperty !== options.consumedFigmaProperty) {
        diagnostics.push({ kind: 'unmapped-value', figmaProperty, figmaValue });
      }
      continue;
    }

    const candidatesForProp = candidates.get(mapping.prop) ?? [];
    candidatesForProp.push({
      source: { figmaProperty, figmaValue },
      value: {
        value: mapping.value,
        raw: mapping.raw,
        namedImports: mapping.namedImports,
      },
    });
    candidates.set(mapping.prop, candidatesForProp);
  }

  const props: string[] = [];
  const namedImports = new Set<string>();

  for (const [prop, candidatesForProp] of candidates) {
    const sources = candidatesForProp.map(({ source }) => source);

    if (options.reservedReactProps?.has(prop)) {
      diagnostics.push({
        kind: 'reserved-target',
        prop,
        sources,
      });
      continue;
    }

    if (candidatesForProp.length > 1) {
      diagnostics.push({
        kind: 'duplicate-target',
        prop,
        sources,
      });
      continue;
    }

    const assignment = formatPropAssignment(prop, candidatesForProp[0].value);
    if (assignment) {
      props.push(assignment);
      for (const namedImport of candidatesForProp[0].value.namedImports ?? []) {
        namedImports.add(namedImport);
      }
    }
  }

  return {
    diagnostics,
    ...(namedImports.size > 0 ? { namedImports: Array.from(namedImports) } : {}),
    props,
  };
}

function isIconOnlySelection(
  componentProperties: Readonly<Record<string, string | boolean>>,
): boolean {
  const iconOnlyValue = getOwnEntry(componentProperties, 'isOnlyIcon')
    ?? getOwnEntry(componentProperties, 'iconOnly');
  return iconOnlyValue === true || iconOnlyValue === 'true';
}

function createIconOnlyIgnoredProperties(
  componentProperties: Readonly<Record<string, string | boolean>>,
  childrenTextProperty: string,
): ReadonlySet<string> {
  const ignored = new Set<string>(['hasTrailingIcon', 'trailingIcon']);
  const textProperty = findComponentPropertyName(componentProperties, childrenTextProperty);

  if (textProperty) {
    ignored.add(textProperty);
  }

  return ignored;
}

function findComponentPropertyName(
  componentProperties: Readonly<Record<string, string | boolean>>,
  propertyName: string,
): string | undefined {
  if (getOwnEntry(componentProperties, propertyName) !== undefined) {
    return propertyName;
  }

  const normalizedPropertyName = propertyName.toLowerCase();
  return Object.keys(componentProperties).find((candidate) => {
    return candidate.toLowerCase() === normalizedPropertyName;
  });
}

function isConsumedIconVisibilityGuard(
  figmaProperty: string,
  componentProperties: Readonly<Record<string, string | boolean>>,
): boolean {
  const pair = ICON_VISIBILITY_GUARDS.find(({ guardProperty }) => {
    return guardProperty.toLowerCase() === figmaProperty.toLowerCase();
  });

  return pair !== undefined
    && findComponentPropertyName(componentProperties, pair.swapProperty) !== undefined;
}

function isHiddenInstanceSwap(
  figmaProperty: string,
  componentProperties: Readonly<Record<string, string | boolean>>,
): boolean {
  const pair = ICON_VISIBILITY_GUARDS.find(({ swapProperty }) => {
    return swapProperty.toLowerCase() === figmaProperty.toLowerCase();
  });

  const guardProperty = pair
    ? findComponentPropertyName(componentProperties, pair.guardProperty)
    : undefined;

  return guardProperty !== undefined
    && getOwnEntry(componentProperties, guardProperty) === false;
}

type ResolvedPropMapping = PropMapping & {
  namedImports?: readonly string[];
};

const ICON_RENDER_PROPS: ReadonlySet<string> = new Set([
  'renderLeftIcon',
  'renderRightIcon',
]);

function createResolvedInstanceSwapMapping(
  figmaProperty: string,
  figmaValue: string | boolean,
  mappingGroup: Readonly<Record<string, PropMapping>>,
  instanceSwaps: Readonly<Record<string, ResolvedInstanceSwap>> | undefined,
): ResolvedPropMapping | undefined {
  if (!instanceSwaps) {
    return undefined;
  }

  const instanceSwap = getOwnEntry(instanceSwaps, figmaProperty);
  if (!instanceSwap || instanceSwap.componentId !== String(figmaValue)) {
    return undefined;
  }

  const wildcardMapping = getOwnEntry(mappingGroup, '*');
  const mappings = wildcardMapping
    ? [wildcardMapping]
    : Object.values(mappingGroup);
  if (mappings.length === 0) {
    return undefined;
  }

  const targetProps = new Set(mappings.map(({ prop }) => prop));
  if (targetProps.size !== 1) {
    return undefined;
  }

  const targetProp = mappings[0].prop;
  if (ICON_RENDER_PROPS.has(targetProp)) {
    const iconName = createIconName(instanceSwap.componentName);
    return {
      namedImports: ['Icon'],
      prop: targetProp,
      raw: true,
      value: `<Icon name=${JSON.stringify(iconName)} />`,
    };
  }

  return {
    prop: targetProp,
    value: instanceSwap.componentName,
  };
}

function createIconName(componentName: string): string {
  return componentName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function formatMappingDiagnostics(diagnostics: MappingDiagnostic[]): string {
  return diagnostics.map((diagnostic) => {
    if (diagnostic.kind === 'unmapped-property') {
      return [
        `No mapping group for Figma property ${JSON.stringify(diagnostic.figmaProperty)}`,
        `(active value ${formatDiagnosticValue(diagnostic.figmaValue)}).`,
      ].join(' ');
    }

    if (diagnostic.kind === 'unmapped-value') {
      return [
        `No mapping entry for Figma property ${JSON.stringify(diagnostic.figmaProperty)}`,
        `with active value ${formatDiagnosticValue(diagnostic.figmaValue)}.`,
      ].join(' ');
    }

    if (diagnostic.kind === 'missing-children-source') {
      return [
        `Figma text property ${JSON.stringify(diagnostic.figmaProperty)}`,
        'is missing or empty; the selected layer text/name was used instead.',
      ].join(' ');
    }

    const sources = diagnostic.sources.map(({ figmaProperty, figmaValue }) => {
      return `${JSON.stringify(figmaProperty)}=${formatDiagnosticValue(figmaValue)}`;
    }).join(', ');

    if (diagnostic.kind === 'reserved-target') {
      return [
        `Active mappings target reserved React prop ${JSON.stringify(diagnostic.prop)}: ${sources}.`,
        'The mapped prop was omitted because the selected children mode owns this prop.',
      ].join(' ');
    }

    return [
      `Multiple active mappings target React prop ${JSON.stringify(diagnostic.prop)}: ${sources}.`,
      'The conflicting prop was omitted; give each active mapping a unique target prop.',
    ].join(' ');
  }).join('\n');
}

export function formatPropAssignment(prop: string, propValue: CodeProp): string | null {
  assertValidPropIdentifier(prop);

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

export function formatPropValue(value: string | number | boolean): string {
  if (typeof value === 'string') {
    return `{${JSON.stringify(value)}}`;
  }

  return `{${String(value)}}`;
}

export function createOpeningTag(componentName: string, props: string[]): string {
  assertValidComponentIdentifier(componentName);

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

export function createSelfClosingTag(componentName: string, props: string[]): string {
  assertValidComponentIdentifier(componentName);

  if (props.length === 0) {
    return `<${componentName} />`;
  }

  if (props.length <= 3) {
    return `<${componentName} ${props.join(' ')} />`;
  }

  return [
    `<${componentName}`,
    ...props.map((prop) => {
      return `  ${prop}`;
    }),
    '/>',
  ].join('\n');
}

export function getComponentLabel(selection: SelectionLike): string {
  return resolveChildrenText(selection, DEFAULT_CHILDREN_TEXT_PROPERTY).text;
}

export function resolveChildrenText(
  selection: SelectionLike,
  configuredProperty: string,
): ResolvedChildrenText {
  const propertyName = configuredProperty.trim() || DEFAULT_CHILDREN_TEXT_PROPERTY;
  const configuredMatch = findTextComponentProperty(
    selection.componentProperties,
    propertyName,
  );

  if (configuredMatch) {
    return { sourceProperty: configuredMatch[0], text: configuredMatch[1] };
  }

  if (propertyName.toLowerCase() !== DEFAULT_CHILDREN_TEXT_PROPERTY.toLowerCase()) {
    const defaultMatch = findTextComponentProperty(
      selection.componentProperties,
      DEFAULT_CHILDREN_TEXT_PROPERTY,
    );

    if (defaultMatch) {
      return { sourceProperty: defaultMatch[0], text: defaultMatch[1] };
    }
  }

  return { text: selection.displayText };
}

function findTextComponentProperty(
  componentProperties: Readonly<Record<string, string | boolean>>,
  propertyName: string,
): [string, string] | undefined {
  const exactValue = getOwnEntry(componentProperties, propertyName);

  if (typeof exactValue === 'string' && exactValue.trim().length > 0) {
    return [propertyName, exactValue];
  }

  if (exactValue !== undefined) {
    return undefined;
  }

  const normalizedPropertyName = propertyName.toLowerCase();
  const caseInsensitiveMatch = Object.entries(componentProperties).find(
    ([candidate, value]) => candidate.toLowerCase() === normalizedPropertyName
      && typeof value === 'string'
      && value.trim().length > 0,
  );

  return caseInsensitiveMatch
    ? [caseInsensitiveMatch[0], caseInsensitiveMatch[1] as string]
    : undefined;
}

function createImportLines(
  metadata: ConnectionMetadata,
  generatedNamedImports: readonly string[] = [],
): string[] {
  const importsByPath = new Map<string, Set<string>>();

  addNamedImport(importsByPath, metadata.importPath, metadata.componentName);
  for (const componentName of generatedNamedImports) {
    addNamedImport(importsByPath, metadata.importPath, componentName);
  }

  if (
    metadata.childrenMode === 'icon-only'
    && metadata.iconComponentName
    && metadata.iconImportPath
  ) {
    addNamedImport(importsByPath, metadata.iconImportPath, metadata.iconComponentName);
  }

  return Array.from(importsByPath, ([importPath, componentNames]) => {
    return `import { ${Array.from(componentNames).join(', ')} } from ${JSON.stringify(importPath)};`;
  });
}

function addNamedImport(
  importsByPath: Map<string, Set<string>>,
  importPath: string,
  componentName: string,
): void {
  const componentNames = importsByPath.get(importPath) ?? new Set<string>();
  componentNames.add(componentName);
  importsByPath.set(importPath, componentNames);
}

/**
 * Render a label as JSX children. Safe, single-line labels are emitted as bare
 * JSX text. Characters or boundary whitespace that JSX could escape, trim, or
 * normalize are wrapped in a string expression so the generated value remains
 * exact. `>` alone is valid in JSX text but is wrapped for predictability.
 */
export function formatJsxChildren(value: string): string {
  if (value.trim() === value && !UNSAFE_JSX_TEXT_PATTERN.test(value)) {
    return value;
  }

  return formatPropValue(value);
}

// ---- Metadata validation -------------------------------------------------

export type PersistedConnectionMetadata = {
  metadata: Record<string, unknown>;
  schemaVersion: 1 | 2 | 3 | typeof CURRENT_SCHEMA_VERSION;
};

export type PersistedConnectionValidationResult =
  | { metadata: PersistedConnectionMetadata; ok: true }
  | { issue: ConnectionIssue; ok: false };

/**
 * Validate persisted data before migration. Missing versions are legacy v1
 * only at this storage boundary; runtime metadata must always be current.
 */
export function validatePersistedConnectionMetadata(
  value: unknown,
): PersistedConnectionValidationResult {
  if (!isRecord(value)) {
    return persistedFailure(
      'invalid-root',
      [
        'Stored Storybook connection data must be a JSON object.',
        'The data was left unchanged; repair it with a compatible plugin version before saving or clearing.',
      ].join(' '),
    );
  }

  const rawVersion = value.schemaVersion;
  const schemaVersion = rawVersion === undefined ? 1 : rawVersion;

  if (
    typeof schemaVersion !== 'number'
    || !Number.isFinite(schemaVersion)
    || !Number.isInteger(schemaVersion)
    || schemaVersion <= 0
  ) {
    return persistedFailure(
      'invalid-schema-version',
      [
        'Stored Storybook connection data has an invalid schema version; expected a finite positive integer.',
        'The data was left unchanged; repair it with a compatible plugin version before saving or clearing.',
      ].join(' '),
    );
  }

  switch (schemaVersion) {
    case 1:
      if (!isLegacyConnectionMetadata(value, 1)) {
        return invalidPersistedMetadata(schemaVersion);
      }
      return { metadata: { metadata: value, schemaVersion }, ok: true };
    case 2:
      if (!isLegacyConnectionMetadata(value, 2)) {
        return invalidPersistedMetadata(schemaVersion);
      }
      return { metadata: { metadata: value, schemaVersion }, ok: true };
    case 3:
      if (!isVersion3ConnectionMetadata(value)) {
        return invalidPersistedMetadata(schemaVersion);
      }
      return { metadata: { metadata: value, schemaVersion }, ok: true };
    case CURRENT_SCHEMA_VERSION:
      if (!isConnectionMetadata(value)) {
        return invalidPersistedMetadata(schemaVersion);
      }
      return { metadata: { metadata: value, schemaVersion }, ok: true };
    default:
      if (schemaVersion > CURRENT_SCHEMA_VERSION) {
        return persistedFailure(
          'future-schema-version',
          [
            `Stored Storybook connection data uses schema version ${schemaVersion}, newer than this plugin supports (version ${CURRENT_SCHEMA_VERSION}).`,
            'Update the plugin before saving or clearing this connection; the data was left unchanged.',
          ].join(' '),
        );
      }

      return persistedFailure(
        'unsupported-schema-version',
        [
          `Stored Storybook connection data uses unsupported schema version ${schemaVersion}.`,
          `This plugin supports versions 1, 2, 3, and ${CURRENT_SCHEMA_VERSION}; the data was left unchanged.`,
        ].join(' '),
      );
  }
}

/** Migrate an already validated persisted value using exact version cases. */
export function migratePersistedConnectionMetadata(
  persisted: PersistedConnectionMetadata,
): ConnectionMetadata {
  switch (persisted.schemaVersion) {
    case 1:
      return migrateLegacyConnectionMetadata(persisted.metadata, 'text');
    case 2: {
      const childrenMode = persisted.metadata.childrenMode === 'icon-only'
        ? persisted.metadata.childrenMode
        : 'text';
      return migrateLegacyConnectionMetadata(persisted.metadata, childrenMode);
    }
    case 3:
      return migrateVersion3ConnectionMetadata(persisted.metadata);
    case CURRENT_SCHEMA_VERSION:
      return persisted.metadata as ConnectionMetadata;
  }
}

export function isConnectionMetadata(value: unknown): value is ConnectionMetadata {
  return isRecord(value)
    && value.schemaVersion === CURRENT_SCHEMA_VERSION
    && hasValidConnectionMetadataShape(value, true);
}

export function isPropMappings(value: unknown): value is Record<string, Record<string, PropMapping>> {
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
        && isPropIdentifier(mapping.prop)
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

export function validateConnectionMetadata(
  metadata: unknown,
): { ok: true } | { ok: false; message: string } {
  if (!isConnectionMetadata(metadata)) {
    return {
      ok: false,
      message: `Connection metadata must use schema version ${CURRENT_SCHEMA_VERSION} and include a valid component name, import path, children configuration, and prop mappings value.`,
    };
  }

  return { ok: true };
}

function isLegacyConnectionMetadata(
  value: Record<string, unknown>,
  schemaVersion: 1 | 2,
): boolean {
  if (!hasValidCommonConnectionFields(value)) {
    return false;
  }

  if (
    value.childrenTextProperty !== undefined
    || value.iconComponentName !== undefined
    || value.iconImportPath !== undefined
  ) {
    return false;
  }

  if (schemaVersion === 1) {
    return value.childrenMode === undefined;
  }

  return value.childrenMode === undefined
    || value.childrenMode === 'text'
    || value.childrenMode === 'icon-only';
}

function isVersion3ConnectionMetadata(value: Record<string, unknown>): boolean {
  return value.schemaVersion === 3
    && value.mappingDocument === undefined
    && hasValidConnectionMetadataShape(value, false);
}

function hasValidConnectionMetadataShape(
  value: Record<string, unknown>,
  allowMappingDocument: boolean,
): boolean {
  if (!hasValidCommonConnectionFields(value)) {
    return false;
  }

  if (
    value.childrenMode !== undefined
    && value.childrenMode !== 'text'
    && value.childrenMode !== 'icon-only'
    && value.childrenMode !== 'none'
  ) {
    return false;
  }

  if (
    value.childrenTextProperty !== undefined
    && (
      typeof value.childrenTextProperty !== 'string'
      || value.childrenTextProperty.trim().length === 0
    )
  ) {
    return false;
  }

  const childrenMode = value.childrenMode ?? 'text';

  if (childrenMode === 'icon-only') {
    if (
      typeof value.iconComponentName !== 'string'
      || !isComponentIdentifier(value.iconComponentName)
      || typeof value.iconImportPath !== 'string'
      || value.iconImportPath.trim().length === 0
    ) {
      return false;
    }

    if (
      value.iconComponentName === value.componentName
      && value.iconImportPath !== value.importPath
    ) {
      return false;
    }
  } else if (value.iconComponentName !== undefined || value.iconImportPath !== undefined) {
    return false;
  }

  if (value.mappingDocument !== undefined) {
    return allowMappingDocument && isMappingDocument(value.mappingDocument);
  }

  return true;
}

function hasValidCommonConnectionFields(value: Record<string, unknown>): boolean {
  return (
    typeof value.componentName === 'string'
    && isComponentIdentifier(value.componentName)
    && typeof value.importPath === 'string'
    && value.importPath.length > 0
    && (value.storybookUrl === undefined || typeof value.storybookUrl === 'string')
    && (value.sourcePath === undefined || typeof value.sourcePath === 'string')
    && (value.sourceUrl === undefined || typeof value.sourceUrl === 'string')
    && (value.updatedAt === undefined || typeof value.updatedAt === 'string')
    && (value.propMappings === undefined || isPropMappings(value.propMappings))
  );
}

function migrateLegacyConnectionMetadata(
  metadata: Record<string, unknown>,
  childrenMode: 'icon-only' | 'none' | 'text',
): ConnectionMetadata {
  const migrated: Record<string, unknown> = {
    ...metadata,
    childrenMode,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  delete migrated.childrenTextProperty;
  delete migrated.iconComponentName;
  delete migrated.iconImportPath;

  if (childrenMode !== 'none') {
    migrated.childrenTextProperty = DEFAULT_CHILDREN_TEXT_PROPERTY;
  }

  if (childrenMode === 'icon-only') {
    migrated.iconComponentName = 'Icon';
    migrated.iconImportPath = metadata.importPath;
  }

  if (!isConnectionMetadata(migrated)) {
    throw new TypeError('Validated legacy connection metadata could not be migrated.');
  }

  return migrated;
}

function migrateVersion3ConnectionMetadata(
  metadata: Record<string, unknown>,
): ConnectionMetadata {
  const migrated = {
    ...metadata,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  if (!isConnectionMetadata(migrated)) {
    throw new TypeError('Validated schema version 3 connection metadata could not be migrated.');
  }

  return migrated;
}

function invalidPersistedMetadata(schemaVersion: number): PersistedConnectionValidationResult {
  return persistedFailure(
    'invalid-metadata',
    [
      `Stored Storybook connection data does not match schema version ${schemaVersion}.`,
      'The data was left unchanged; repair it with a compatible plugin version before saving or clearing.',
    ].join(' '),
  );
}

function persistedFailure(
  reason: ConnectionIssue['reason'],
  message: string,
): PersistedConnectionValidationResult {
  return { issue: { message, reason }, ok: false };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponentIdentifier(value: string): boolean {
  return COMPONENT_IDENTIFIER_PATTERN.test(value);
}

export function isPropIdentifier(value: string): boolean {
  return JSX_ATTRIBUTE_NAME_PATTERN.test(value);
}

function formatDiagnosticValue(value: string | boolean): string {
  return JSON.stringify(value);
}

function assertValidComponentIdentifier(value: string): void {
  if (!isComponentIdentifier(value)) {
    throw new TypeError(`Invalid component identifier: ${JSON.stringify(value)}`);
  }
}

function assertValidPropIdentifier(value: string): void {
  if (!isPropIdentifier(value)) {
    throw new TypeError(`Invalid JSX prop identifier: ${JSON.stringify(value)}`);
  }
}
