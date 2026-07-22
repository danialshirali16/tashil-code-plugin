import type {
  FigmaComponentSnapshot,
  FigmaPropertyDescriptor,
  MappingDocument,
  PropertyMapping,
  PropertyValueMapping,
  PropMapping,
  PropMappings,
  SourceComponentSnapshot,
  SourcePropDescriptor,
  SourcePropValue,
} from './types';

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function copyPropMappings(source: PropMappings): PropMappings {
  const copy = createDictionary<Record<string, PropMapping>>();

  for (const [groupName, group] of Object.entries(source)) {
    const groupCopy = createDictionary<PropMapping>();
    for (const [optionName, mapping] of Object.entries(group)) {
      groupCopy[optionName] = { ...mapping };
    }
    copy[groupName] = groupCopy;
  }

  return copy;
}

/**
 * Compile visual authoring state into the stable JSON format consumed by
 * codegen. Existing advanced entries are copied first and standard visual
 * mappings only replace the exact group/option entries they own.
 */
export function compileMappingDocument(
  document: MappingDocument,
  preservedMappings: PropMappings = {},
): PropMappings {
  const compiled = copyPropMappings(preservedMappings);

  for (const mapping of document.mappings) {
    if (mapping.kind === 'children') {
      continue;
    }

    const group = compiled[mapping.figmaPropertyName]
      ?? createDictionary<PropMapping>();

    if (mapping.kind === 'instance-swap') {
      group['*'] = {
        prop: mapping.sourceProp,
        value: '$instanceSwap',
      };
      compiled[mapping.figmaPropertyName] = group;
      continue;
    }

    for (const valueMapping of mapping.values) {
      group[valueMapping.figmaValue] = {
        prop: mapping.sourceProp,
        value: valueMapping.sourceValue,
      };
    }

    compiled[mapping.figmaPropertyName] = group;
  }

  return compiled;
}

export function isMappingDocument(value: unknown): value is MappingDocument {
  if (!isRecord(value)) {
    return false;
  }

  return Number.isInteger(value.revision)
    && typeof value.revision === 'number'
    && value.revision > 0
    && isFigmaComponentSnapshot(value.figmaSnapshot)
    && (value.sourceSnapshot === undefined || isSourceComponentSnapshot(value.sourceSnapshot))
    && Array.isArray(value.mappings)
    && value.mappings.every(isPropertyMapping)
    && (value.managedFigmaProperties === undefined || (
      Array.isArray(value.managedFigmaProperties)
      && value.managedFigmaProperties.every((property) => typeof property === 'string')
    ))
    && (value.lastValidatedAt === undefined || typeof value.lastValidatedAt === 'string');
}

function isSourceComponentSnapshot(value: unknown): value is SourceComponentSnapshot {
  return isRecord(value)
    && typeof value.componentName === 'string'
    && value.componentName.length > 0
    && typeof value.contentHash === 'string'
    && value.contentHash.length > 0
    && typeof value.fileName === 'string'
    && value.fileName.length > 0
    && Array.isArray(value.props)
    && value.props.every(isSourcePropDescriptor);
}

function isSourcePropDescriptor(value: unknown): value is SourcePropDescriptor {
  return isRecord(value)
    && typeof value.name === 'string'
    && value.name.length > 0
    && typeof value.required === 'boolean'
    && typeof value.typeName === 'string'
    && (
      value.role === 'advanced'
      || value.role === 'children'
      || value.role === 'event'
      || value.role === 'standard'
      || value.role === 'unsupported'
    )
    && (value.values === undefined || (
      Array.isArray(value.values)
      && value.values.every(isSourcePropValue)
    ))
    && (value.defaultValue === undefined || isSourcePropValue(value.defaultValue));
}

function isFigmaComponentSnapshot(value: unknown): value is FigmaComponentSnapshot {
  return isRecord(value)
    && typeof value.componentId === 'string'
    && value.componentId.length > 0
    && typeof value.componentName === 'string'
    && value.componentName.length > 0
    && Array.isArray(value.properties)
    && value.properties.every(isFigmaPropertyDescriptor);
}

function isFigmaPropertyDescriptor(value: unknown): value is FigmaPropertyDescriptor {
  return isRecord(value)
    && typeof value.id === 'string'
    && value.id.length > 0
    && typeof value.name === 'string'
    && value.name.length > 0
    && typeof value.rawKey === 'string'
    && value.rawKey.length > 0
    && (
      value.type === 'BOOLEAN'
      || value.type === 'INSTANCE_SWAP'
      || value.type === 'TEXT'
      || value.type === 'VARIANT'
    )
    && Array.isArray(value.options)
    && value.options.every((option) => typeof option === 'string')
    && (
      value.defaultValue === undefined
      || typeof value.defaultValue === 'string'
      || typeof value.defaultValue === 'boolean'
    );
}

function isPropertyMapping(value: unknown): value is PropertyMapping {
  return isRecord(value)
    && typeof value.figmaPropertyId === 'string'
    && value.figmaPropertyId.length > 0
    && typeof value.figmaPropertyName === 'string'
    && value.figmaPropertyName.length > 0
    && typeof value.sourceProp === 'string'
    && value.sourceProp.length > 0
    && (
      value.kind === undefined
      || value.kind === 'children'
      || value.kind === 'instance-swap'
      || value.kind === 'property'
    )
    && Array.isArray(value.values)
    && value.values.every(isPropertyValueMapping);
}

function isPropertyValueMapping(value: unknown): value is PropertyValueMapping {
  return isRecord(value)
    && typeof value.figmaValue === 'string'
    && value.figmaValue.length > 0
    && isSourcePropValue(value.sourceValue);
}

function isSourcePropValue(value: unknown): value is SourcePropValue {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
