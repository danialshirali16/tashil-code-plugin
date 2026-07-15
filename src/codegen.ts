import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CHILDREN_TEXT_PROPERTY,
  type ConnectionIssue,
  type ConnectionMetadata,
  type PropMapping,
} from './types';

/**
 * Pure, Figma-agnostic codegen + validation helpers. Kept separate from
 * `main.ts` so they can be unit-tested without the Figma runtime.
 */

export type CodeProp = {
  value: string | number | boolean;
  raw?: boolean;
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
  reservedReactProps?: ReadonlySet<string>;
};

export type ResolvedChildrenText = {
  sourceProperty?: string;
  text: string;
};

export type MappedPropsResult = {
  diagnostics: MappingDiagnostic[];
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

  const childrenMode = metadata.childrenMode ?? 'text';
  const resolvedChildren = childrenMode === 'none'
    ? undefined
    : resolveChildrenText(
        selection,
        metadata.childrenTextProperty ?? DEFAULT_CHILDREN_TEXT_PROPERTY,
      );
  const mappedProps = createMappedProps(
    metadata.propMappings ?? {},
    selection.componentProperties,
    {
      consumedFigmaProperty: resolvedChildren?.sourceProperty,
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
    ...createImportLines(metadata),
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
    const mappingGroup = getOwnEntry(propMappings, figmaProperty);

    if (!mappingGroup) {
      if (figmaProperty !== options.consumedFigmaProperty) {
        diagnostics.push({ kind: 'unmapped-property', figmaProperty, figmaValue });
      }
      continue;
    }

    const mapping = getOwnEntry(mappingGroup, String(figmaValue));

    if (!mapping) {
      if (figmaProperty !== options.consumedFigmaProperty) {
        diagnostics.push({ kind: 'unmapped-value', figmaProperty, figmaValue });
      }
      continue;
    }

    const candidatesForProp = candidates.get(mapping.prop) ?? [];
    candidatesForProp.push({
      source: { figmaProperty, figmaValue },
      value: { value: mapping.value, raw: mapping.raw },
    });
    candidates.set(mapping.prop, candidatesForProp);
  }

  const props: string[] = [];

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
    }
  }

  return { diagnostics, props };
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
  const exactValue = getOwnEntry(selection.componentProperties, propertyName);

  if (typeof exactValue === 'string' && exactValue.trim().length > 0) {
    return { sourceProperty: propertyName, text: exactValue };
  }

  if (exactValue === undefined) {
    const normalizedPropertyName = propertyName.toLowerCase();
    const caseInsensitiveMatch = Object.entries(selection.componentProperties).find(
      ([candidate, value]) => candidate.toLowerCase() === normalizedPropertyName
        && typeof value === 'string'
        && value.trim().length > 0,
    );

    if (caseInsensitiveMatch) {
      return {
        sourceProperty: caseInsensitiveMatch[0],
        text: caseInsensitiveMatch[1] as string,
      };
    }
  }

  return { text: selection.displayText };
}

function createImportLines(metadata: ConnectionMetadata): string[] {
  const importsByPath = new Map<string, Set<string>>();

  addNamedImport(importsByPath, metadata.importPath, metadata.componentName);

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
  schemaVersion: 1 | 2 | typeof CURRENT_SCHEMA_VERSION;
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
          `This plugin supports versions 1, 2, and ${CURRENT_SCHEMA_VERSION}; the data was left unchanged.`,
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
    case CURRENT_SCHEMA_VERSION:
      return persisted.metadata as ConnectionMetadata;
  }
}

export function isConnectionMetadata(value: unknown): value is ConnectionMetadata {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.componentName !== 'string' || !isComponentIdentifier(value.componentName)) {
    return false;
  }

  if (typeof value.importPath !== 'string' || value.importPath.length === 0) {
    return false;
  }

  if (value.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return false;
  }

  if (value.storybookUrl !== undefined && typeof value.storybookUrl !== 'string') {
    return false;
  }

  if (value.sourcePath !== undefined && typeof value.sourcePath !== 'string') {
    return false;
  }

  if (value.sourceUrl !== undefined && typeof value.sourceUrl !== 'string') {
    return false;
  }

  if (value.updatedAt !== undefined && typeof value.updatedAt !== 'string') {
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

  if (value.propMappings !== undefined && !isPropMappings(value.propMappings)) {
    return false;
  }

  return true;
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
