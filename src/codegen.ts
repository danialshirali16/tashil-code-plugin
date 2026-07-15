import type { ConnectionMetadata, PropMapping } from './types';

/**
 * Pure, Figma-agnostic codegen + validation helpers. Kept separate from
 * `main.ts` so they can be unit-tested without the Figma runtime.
 */

export type CodeProp = {
  value: string | number | boolean;
  raw?: boolean;
};

/**
 * Minimal view of a resolved selection. Mirrors the relevant fields of
 * `ResolvedSelection` in main.ts without dragging in Figma node types.
 */
export type SelectionLike = {
  componentProperties: Record<string, string | boolean>;
  displayText: string;
};

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;
const JSX_ATTRIBUTE_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*$/;

export function createUsageSnippet(metadata: ConnectionMetadata, selection: SelectionLike): string {
  const validation = validateConnectionMetadata(metadata);

  if (!validation.ok) {
    throw new TypeError(validation.message);
  }

  const props = createMappedProps(metadata, selection.componentProperties);
  const label = getComponentLabel(selection);
  const isIconOnly = props.includes('iconOnly');
  const openTag = createOpeningTag(metadata.componentName, props);

  const lines = [
    `import { ${metadata.componentName} } from ${JSON.stringify(metadata.importPath)};`,
    '',
  ];

  if (isIconOnly) {
    const iconOnlyOpenTag = createOpeningTag(metadata.componentName, [
      ...props,
      `aria-label=${formatPropValue(label)}`,
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

export function createMappedProps(
  metadata: ConnectionMetadata,
  componentProperties: Record<string, string | boolean>,
): string[] {
  const propValues = new Map<string, CodeProp>();

  for (const [prop, value] of Object.entries(metadata.defaultProps ?? {})) {
    propValues.set(prop, { value });
  }

  for (const [prop, value] of Object.entries(
    getMappedPropValues(metadata.propMappings ?? {}, componentProperties),
  )) {
    propValues.set(prop, value);
  }

  return Array.from(propValues.entries()).flatMap(([prop, value]) => {
    const assignment = formatPropAssignment(prop, value);
    return assignment ? [assignment] : [];
  });
}

export function getMappedPropValues(
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

export function getComponentLabel(selection: SelectionLike): string {
  const label = selection.componentProperties.label;

  if (typeof label === 'string' && label.trim().length > 0) {
    return label;
  }

  return selection.displayText;
}

export function escapeJsxText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/{/g, '&#123;')
    .replace(/}/g, '&#125;');
}

// ---- Metadata validation -------------------------------------------------

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

  if (value.schemaVersion !== undefined && typeof value.schemaVersion !== 'number') {
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

export function isDefaultProps(value: unknown): value is Record<string, string | number | boolean> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.entries(value).every(([prop, propValue]) => {
    return (
      isPropIdentifier(prop)
      && (
        typeof propValue === 'string'
        || typeof propValue === 'number'
        || typeof propValue === 'boolean'
      )
    );
  });
}

export function validateConnectionMetadata(
  metadata: ConnectionMetadata,
): { ok: true } | { ok: false; message: string } {
  if (!isConnectionMetadata(metadata)) {
    return {
      ok: false,
      message: 'Connection metadata is missing a valid component name identifier, import path, prop identifier, or prop mappings value.',
    };
  }

  return { ok: true };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isComponentIdentifier(value: string): boolean {
  return COMPONENT_IDENTIFIER_PATTERN.test(value);
}

function isPropIdentifier(value: string): boolean {
  return JSX_ATTRIBUTE_NAME_PATTERN.test(value);
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
