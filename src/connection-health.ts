import { getPropertyMappingKind } from './mapping-editor';
import type {
  FigmaComponentSnapshot,
  MappingDocument,
  SourceComponentSnapshot,
  SourcePropDescriptor,
} from './types';

export type ConnectionHealthStatus =
  | 'broken'
  | 'healthy'
  | 'needs-review'
  | 'source-refresh-required';

export type ConnectionDriftKind =
  | 'figma-option-added'
  | 'figma-option-removed'
  | 'figma-property-added'
  | 'figma-property-removed'
  | 'figma-property-renamed'
  | 'figma-property-type-changed'
  | 'incomplete-mapping'
  | 'mapping-conflict'
  | 'source-prop-added'
  | 'source-prop-removed'
  | 'source-prop-renamed'
  | 'source-prop-type-changed';

export type ConnectionDrift = {
  figmaPropertyId?: string;
  kind: ConnectionDriftKind;
  message: string;
  severity: 'error' | 'review';
  sourceProp?: string;
};

export type ConnectionHealth = {
  changes: ConnectionDrift[];
  status: ConnectionHealthStatus;
};

export function evaluateConnectionHealth(
  savedDocument: MappingDocument | undefined,
  currentFigma: FigmaComponentSnapshot | undefined,
  workingDocument: MappingDocument | undefined,
  sourceVerified: boolean,
): ConnectionHealth | undefined {
  if (!savedDocument && !workingDocument) {
    return undefined;
  }

  const document = workingDocument ?? savedDocument!;
  const changes: ConnectionDrift[] = [
    ...(savedDocument && currentFigma
      ? compareFigmaSnapshots(savedDocument, currentFigma, document)
      : []),
    ...(savedDocument?.sourceSnapshot && document.sourceSnapshot && sourceVerified
      ? compareSourceSnapshots(savedDocument.sourceSnapshot, document.sourceSnapshot, document)
      : []),
    ...findMappingConflicts(document),
    ...findIncompleteMappings(document),
  ];

  if (changes.some((change) => change.severity === 'error')) {
    return { changes, status: 'broken' };
  }
  if (changes.length > 0) {
    return { changes, status: 'needs-review' };
  }
  if (savedDocument?.sourceSnapshot && !sourceVerified) {
    return { changes: [], status: 'source-refresh-required' };
  }
  return { changes: [], status: 'healthy' };
}

export function findMappingConflicts(document: MappingDocument): ConnectionDrift[] {
  const sourceProps = new Set(document.sourceSnapshot?.props.map((prop) => prop.name) ?? []);
  const figmaProperties = new Set(document.figmaSnapshot.properties.map((property) => property.id));

  return document.mappings.flatMap((mapping) => {
    if (document.sourceSnapshot && !sourceProps.has(mapping.sourceProp)) {
      return [{
        kind: 'mapping-conflict' as const,
        message: `${mapping.sourceProp} no longer exists in the uploaded source.`,
        severity: 'error' as const,
        sourceProp: mapping.sourceProp,
      }];
    }
    if (!figmaProperties.has(mapping.figmaPropertyId)) {
      return [{
        figmaPropertyId: mapping.figmaPropertyId,
        kind: 'mapping-conflict' as const,
        message: `${mapping.figmaPropertyName} no longer exists in the selected Figma component.`,
        severity: 'error' as const,
        sourceProp: mapping.sourceProp,
      }];
    }
    return [];
  });
}

export function findIncompleteMappings(document: MappingDocument): ConnectionDrift[] {
  if (!document.sourceSnapshot) {
    return [];
  }

  return document.sourceSnapshot.props.flatMap((sourceProp) => {
    const kind = getPropertyMappingKind(sourceProp);
    if (!kind) {
      return [];
    }

    const mapping = document.mappings.find((candidate) => candidate.sourceProp === sourceProp.name);
    if (!mapping) {
      return [{
        kind: 'incomplete-mapping' as const,
        message: `${sourceProp.name} is not connected to a Figma property.`,
        severity: 'review' as const,
        sourceProp: sourceProp.name,
      }];
    }

    if (kind !== 'property') {
      return [];
    }

    const mappedValues = new Set(mapping.values.map((value) => value.sourceValue));
    return (sourceProp.values ?? []).flatMap((sourceValue) => (
      mappedValues.has(sourceValue)
        ? []
        : [{
            kind: 'incomplete-mapping' as const,
            message: `${sourceProp.name} value ${JSON.stringify(sourceValue)} is not mapped.`,
            severity: 'review' as const,
            sourceProp: sourceProp.name,
          }]
    ));
  });
}

function compareFigmaSnapshots(
  savedDocument: MappingDocument,
  current: FigmaComponentSnapshot,
  workingDocument: MappingDocument,
): ConnectionDrift[] {
  const changes: ConnectionDrift[] = [];
  const saved = savedDocument.figmaSnapshot;
  const savedById = new Map(saved.properties.map((property) => [property.id, property]));
  const currentById = new Map(current.properties.map((property) => [property.id, property]));
  const mappedIds = new Set(workingDocument.mappings.map((mapping) => mapping.figmaPropertyId));

  for (const property of saved.properties) {
    const next = currentById.get(property.id);
    if (!next) {
      changes.push({
        figmaPropertyId: property.id,
        kind: 'figma-property-removed',
        message: `Figma property ${property.name} was removed.`,
        severity: mappedIds.has(property.id) ? 'error' : 'review',
      });
      continue;
    }
    if (property.name !== next.name) {
      changes.push({
        figmaPropertyId: property.id,
        kind: 'figma-property-renamed',
        message: `Figma property ${property.name} was renamed to ${next.name}.`,
        severity: 'review',
      });
    }
    if (property.type !== next.type) {
      changes.push({
        figmaPropertyId: property.id,
        kind: 'figma-property-type-changed',
        message: `${next.name} changed from ${property.type} to ${next.type}.`,
        severity: mappedIds.has(property.id) ? 'error' : 'review',
      });
    }

    const previousOptions = new Set(property.options);
    const nextOptions = new Set(next.options);
    for (const option of property.options) {
      if (!nextOptions.has(option)) {
        const mapped = workingDocument.mappings.some((mapping) => (
          mapping.figmaPropertyId === property.id
          && mapping.values.some((value) => value.figmaValue === option)
        ));
        changes.push({
          figmaPropertyId: property.id,
          kind: 'figma-option-removed',
          message: `${property.name} option ${option} was removed.`,
          severity: mapped ? 'error' : 'review',
        });
      }
    }
    for (const option of next.options) {
      if (!previousOptions.has(option)) {
        changes.push({
          figmaPropertyId: property.id,
          kind: 'figma-option-added',
          message: `${next.name} option ${option} was added.`,
          severity: 'review',
        });
      }
    }
  }

  for (const property of current.properties) {
    if (!savedById.has(property.id)) {
      changes.push({
        figmaPropertyId: property.id,
        kind: 'figma-property-added',
        message: `Figma property ${property.name} was added.`,
        severity: 'review',
      });
    }
  }
  return changes;
}

function compareSourceSnapshots(
  saved: SourceComponentSnapshot,
  current: SourceComponentSnapshot,
  savedDocument: MappingDocument,
): ConnectionDrift[] {
  if (saved.contentHash === current.contentHash) {
    return [];
  }

  const changes: ConnectionDrift[] = [];
  const savedByName = new Map(saved.props.map((prop) => [prop.name, prop]));
  const currentByName = new Map(current.props.map((prop) => [prop.name, prop]));
  const removed = saved.props.filter((prop) => !currentByName.has(prop.name));
  const added = current.props.filter((prop) => !savedByName.has(prop.name));
  const matchedAdded = new Set<string>();
  const mappedProps = new Set(savedDocument.mappings.map((mapping) => mapping.sourceProp));

  for (const previous of removed) {
    const renamed = added.find((candidate) => (
      !matchedAdded.has(candidate.name) && haveEquivalentTypes(previous, candidate)
    ));
    if (renamed) {
      matchedAdded.add(renamed.name);
      changes.push({
        kind: 'source-prop-renamed',
        message: `Source prop ${previous.name} may have been renamed to ${renamed.name}.`,
        severity: 'review',
        sourceProp: previous.name,
      });
    } else {
      changes.push({
        kind: 'source-prop-removed',
        message: `Source prop ${previous.name} was removed.`,
        severity: mappedProps.has(previous.name) ? 'error' : 'review',
        sourceProp: previous.name,
      });
    }
  }

  for (const prop of added) {
    if (!matchedAdded.has(prop.name)) {
      changes.push({
        kind: 'source-prop-added',
        message: `Source prop ${prop.name} was added.`,
        severity: 'review',
        sourceProp: prop.name,
      });
    }
  }

  for (const previous of saved.props) {
    const next = currentByName.get(previous.name);
    if (next && !haveEquivalentTypes(previous, next)) {
      changes.push({
        kind: 'source-prop-type-changed',
        message: `Source prop ${previous.name} changed from ${previous.typeName} to ${next.typeName}.`,
        severity: mappedProps.has(previous.name) ? 'error' : 'review',
        sourceProp: previous.name,
      });
    }
  }
  return changes;
}

function haveEquivalentTypes(
  first: SourcePropDescriptor,
  second: SourcePropDescriptor,
): boolean {
  return first.role === second.role
    && first.typeName === second.typeName
    && JSON.stringify(first.values ?? []) === JSON.stringify(second.values ?? []);
}
