import type {
  FigmaComponentSnapshot,
  FigmaPropertyDescriptor,
  MappingDocument,
  PropertyMappingKind,
  PropertyMapping,
  PropMappings,
  SourceComponentSnapshot,
  SourcePropDescriptor,
  SourcePropValue,
} from './types';

const VALUE_ALIASES: Readonly<Record<string, readonly string[]>> = {
  error: ['danger', 'destructive', 'negative'],
  false: ['false', 'no', 'off'],
  primary: ['brand', 'main'],
  success: ['positive'],
  true: ['on', 'true', 'yes'],
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function sourceValues(prop: SourcePropDescriptor): SourcePropValue[] {
  if (prop.values && prop.values.length > 0) {
    return [...prop.values];
  }

  return prop.typeName === 'boolean' ? [false, true] : [];
}

export function getPropertyMappingKind(
  sourceProp: SourcePropDescriptor,
): PropertyMappingKind | undefined {
  if (sourceProp.role === 'standard') {
    return 'property';
  }
  if (sourceProp.role === 'children') {
    return 'children';
  }
  if (
    sourceProp.role === 'advanced'
    && (sourceProp.name === 'renderLeftIcon' || sourceProp.name === 'renderRightIcon')
  ) {
    return 'instance-swap';
  }
  return undefined;
}

function isCompatible(
  sourceProp: SourcePropDescriptor,
  figmaProperty: FigmaPropertyDescriptor,
): boolean {
  const kind = getPropertyMappingKind(sourceProp);
  if (kind === 'children') {
    return figmaProperty.type === 'TEXT';
  }
  if (kind === 'instance-swap') {
    return figmaProperty.type === 'INSTANCE_SWAP';
  }
  if (kind !== 'property') {
    return false;
  }

  const values = sourceValues(sourceProp);
  const booleanSource = values.length === 2
    && values.every((value) => typeof value === 'boolean');

  if (booleanSource) {
    return figmaProperty.type === 'BOOLEAN'
      || (figmaProperty.type === 'VARIANT' && figmaProperty.options.length === 2);
  }

  return figmaProperty.type === 'VARIANT';
}

function valuesEquivalent(sourceValue: SourcePropValue, figmaValue: string): boolean {
  const normalizedSource = normalize(String(sourceValue));
  const normalizedFigma = normalize(figmaValue);
  if (normalizedSource === normalizedFigma) {
    return true;
  }

  return VALUE_ALIASES[normalizedSource]?.some((alias) => normalize(alias) === normalizedFigma)
    ?? false;
}

function scoreProperty(
  sourceProp: SourcePropDescriptor,
  figmaProperty: FigmaPropertyDescriptor,
): number {
  if (!isCompatible(sourceProp, figmaProperty)) {
    return Number.NEGATIVE_INFINITY;
  }

  const sourceName = normalize(sourceProp.name);
  const figmaName = normalize(figmaProperty.name);
  let score = sourceName === figmaName ? 100 : 0;

  if (
    sourceProp.name === 'children'
    && ['buttontext', 'label', 'text'].includes(figmaName)
  ) {
    score += 120;
  }
  if (
    sourceProp.name === 'renderRightIcon'
    && ['leadingicon', 'lefticon'].includes(figmaName)
  ) {
    score += 120;
  }
  if (
    sourceProp.name === 'renderLeftIcon'
    && ['righticon', 'trailingicon'].includes(figmaName)
  ) {
    score += 120;
  }
  if (sourceName.includes(figmaName) || figmaName.includes(sourceName)) {
    score += 30;
  }

  for (const sourceValue of sourceValues(sourceProp)) {
    if (figmaProperty.options.some((option) => valuesEquivalent(sourceValue, option))) {
      score += 10;
    }
  }

  return score;
}

function findExistingFigmaProperty(
  sourceProp: SourcePropDescriptor,
  figmaSnapshot: FigmaComponentSnapshot,
  existingMappings: PropMappings,
): FigmaPropertyDescriptor | undefined {
  for (const [propertyName, group] of Object.entries(existingMappings)) {
    if (Object.values(group).some((entry) => entry.prop === sourceProp.name)) {
      return figmaSnapshot.properties.find((property) => property.name === propertyName);
    }
  }

  return undefined;
}

function suggestFigmaProperty(
  sourceProp: SourcePropDescriptor,
  figmaSnapshot: FigmaComponentSnapshot,
  existingMappings: PropMappings,
): FigmaPropertyDescriptor | undefined {
  const existing = findExistingFigmaProperty(sourceProp, figmaSnapshot, existingMappings);
  if (existing) {
    return existing;
  }

  return figmaSnapshot.properties
    .map((property) => ({ property, score: scoreProperty(sourceProp, property) }))
    .filter(({ score }) => score > 0)
    .sort((first, second) => second.score - first.score)[0]?.property;
}

function createValueMappings(
  sourceProp: SourcePropDescriptor,
  figmaProperty: FigmaPropertyDescriptor,
  existingMappings: PropMappings,
): PropertyMapping['values'] {
  const group = existingMappings[figmaProperty.name] ?? {};

  return sourceValues(sourceProp).flatMap((sourceValue) => {
    const existing = Object.entries(group).find(([, mapping]) => (
      mapping.prop === sourceProp.name && mapping.value === sourceValue
    ));
    const figmaValue = existing?.[0]
      ?? figmaProperty.options.find((option) => valuesEquivalent(sourceValue, option));

    return figmaValue ? [{ figmaValue, sourceValue }] : [];
  });
}

export function createMappingDocumentDraft(
  sourceSnapshot: SourceComponentSnapshot,
  figmaSnapshot: FigmaComponentSnapshot,
  existingMappings: PropMappings = {},
  existingDocument?: MappingDocument,
): MappingDocument {
  const previousBySourceProp = new Map(
    existingDocument?.mappings.map((mapping) => [mapping.sourceProp, mapping]) ?? [],
  );

  const mappings = sourceSnapshot.props
    .filter((prop) => getPropertyMappingKind(prop) !== undefined)
    .flatMap((sourceProp) => {
      const previous = previousBySourceProp.get(sourceProp.name);
      const previousProperty = previous
        ? figmaSnapshot.properties.find((property) => property.id === previous.figmaPropertyId)
        : undefined;
      const property = previousProperty
        ?? suggestFigmaProperty(sourceProp, figmaSnapshot, existingMappings);

      if (!property) {
        return [];
      }

      const kind = getPropertyMappingKind(sourceProp)!;

      return [{
        figmaPropertyId: property.id,
        figmaPropertyName: property.name,
        ...(kind === 'property' ? {} : { kind }),
        sourceProp: sourceProp.name,
        values: kind !== 'property'
          ? []
          : previousProperty && previous
          ? previous.values.filter((value) => property.options.includes(value.figmaValue))
          : createValueMappings(sourceProp, property, existingMappings),
      }];
    });
  const representedSourceProps = new Set(mappings.map((mapping) => mapping.sourceProp));
  const orphanedMappings = existingDocument?.mappings.filter(
    (mapping) => !representedSourceProps.has(mapping.sourceProp),
  ) ?? [];
  const nextMappings = [...mappings, ...orphanedMappings];

  return {
    figmaSnapshot,
    managedFigmaProperties: Array.from(new Set([
      ...(existingDocument?.managedFigmaProperties ?? []),
      ...nextMappings
        .filter((mapping) => mapping.kind === 'instance-swap')
        .map((mapping) => mapping.figmaPropertyName),
    ])),
    mappings: nextMappings,
    revision: existingDocument?.revision ?? 1,
    sourceSnapshot,
  };
}

export function setMappedFigmaProperty(
  document: MappingDocument,
  sourcePropName: string,
  figmaPropertyId: string,
): MappingDocument {
  const sourceProp = document.sourceSnapshot?.props.find((prop) => prop.name === sourcePropName);
  const figmaProperty = document.figmaSnapshot.properties.find(
    (property) => property.id === figmaPropertyId,
  );
  const existingMapping = document.mappings.find(
    (mapping) => mapping.sourceProp === sourcePropName,
  );
  const remaining = document.mappings.filter((mapping) => mapping.sourceProp !== sourcePropName);
  const managedFigmaProperties = Array.from(new Set([
    ...(document.managedFigmaProperties ?? []),
    ...(existingMapping?.kind === 'instance-swap'
      ? [existingMapping.figmaPropertyName]
      : []),
    ...(figmaProperty?.type === 'INSTANCE_SWAP' ? [figmaProperty.name] : []),
  ]));

  if (!sourceProp || !figmaPropertyId || !figmaProperty) {
    return {
      ...document,
      managedFigmaProperties,
      mappings: remaining,
      revision: document.revision,
    };
  }

  const kind = getPropertyMappingKind(sourceProp);
  if (!kind || !isCompatible(sourceProp, figmaProperty)) {
    return {
      ...document,
      managedFigmaProperties,
      mappings: remaining,
      revision: document.revision,
    };
  }

  return {
    ...document,
    managedFigmaProperties,
    mappings: [...remaining, {
      figmaPropertyId: figmaProperty.id,
      figmaPropertyName: figmaProperty.name,
      ...(kind === 'property' ? {} : { kind }),
      sourceProp: sourcePropName,
      values: kind === 'property'
        ? createValueMappings(sourceProp, figmaProperty, {})
        : [],
    }],
    revision: document.revision,
  };
}

export function setMappedFigmaValue(
  document: MappingDocument,
  sourcePropName: string,
  sourceValue: SourcePropValue,
  figmaValue: string,
): MappingDocument {
  return {
    ...document,
    mappings: document.mappings.map((mapping) => {
      if (mapping.sourceProp !== sourcePropName) {
        return mapping;
      }

      const values = mapping.values.filter((value) => value.sourceValue !== sourceValue);
      return {
        ...mapping,
        values: figmaValue ? [...values, { figmaValue, sourceValue }] : values,
      };
    }),
    revision: document.revision,
  };
}

/** Keep mappings that the standard visual editor cannot safely represent. */
export function extractAdvancedPropMappings(
  mappings: PropMappings,
  visualDocument?: MappingDocument,
): PropMappings {
  const advanced: PropMappings = Object.create(null) as PropMappings;
  const visualInstanceSwapGroups = new Set(
    [
      ...(visualDocument?.managedFigmaProperties ?? []),
      ...(visualDocument?.mappings
        .filter((mapping) => mapping.kind === 'instance-swap')
        .map((mapping) => mapping.figmaPropertyName) ?? []),
    ],
  );

  for (const [groupName, group] of Object.entries(mappings)) {
    for (const [optionName, mapping] of Object.entries(group)) {
      if (visualInstanceSwapGroups.has(groupName) && optionName === '*') {
        continue;
      }
      if (optionName === '*' || mapping.value === '$instanceSwap' || mapping.value === '$raw') {
        advanced[groupName] ??= Object.create(null) as Record<string, typeof mapping>;
        advanced[groupName][optionName] = { ...mapping };
      }
    }
  }

  return advanced;
}
