/**
 * Validation for persisted semantic connection recipes.
 *
 * Runs on the connection read path before any recipe is trusted. Rejects
 * malformed path segments, unknown source/transform kinds, oversized
 * documents, and anything that could smuggle executable code. Validation
 * failures surface as actionable messages; they never throw.
 */

import type { SourcePropValue } from '../types';
import {
  LOCATOR_KEY_SEPARATOR,
  SEMANTIC_LIMITS,
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  type CodePropTarget,
  type FigmaNestedSourceDescriptor,
  type FigmaSemanticSnapshot,
  type SemanticBinding,
  type SemanticBindingSource,
  type SemanticConnectionRecipe,
  type SemanticLocator,
  type SemanticTransform,
} from './types';

export type RecipeValidationResult =
  | { ok: true; recipe: SemanticConnectionRecipe }
  | { ok: false; message: string };

/** JS identifier or quoted-safe object key; also rejects proto pollution. */
const PATH_SEGMENT_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

export function isValidTargetPathSegment(segment: string): boolean {
  return PATH_SEGMENT_PATTERN.test(segment) && !FORBIDDEN_SEGMENTS.has(segment);
}

export function validateSemanticRecipe(value: unknown): RecipeValidationResult {
  if (!isRecord(value)) {
    return failure('Semantic recipe must be a JSON object.');
  }

  if (typeof value.schemaVersion !== 'number') {
    return failure('Semantic recipe is missing a numeric schemaVersion.');
  }

  if (value.schemaVersion > SEMANTIC_RECIPE_SCHEMA_VERSION) {
    return failure(
      `Semantic recipe uses schema version ${value.schemaVersion}, newer than this plugin supports (version ${SEMANTIC_RECIPE_SCHEMA_VERSION}). Update the plugin; the data was left unchanged.`,
    );
  }

  if (value.schemaVersion !== SEMANTIC_RECIPE_SCHEMA_VERSION) {
    return failure(
      `Semantic recipe uses unsupported schema version ${String(value.schemaVersion)}.`,
    );
  }

  if (
    typeof value.revision !== 'number'
    || !Number.isInteger(value.revision)
    || value.revision <= 0
  ) {
    return failure('Semantic recipe revision must be a positive integer.');
  }

  if (value.lastValidatedAt !== undefined && typeof value.lastValidatedAt !== 'string') {
    return failure('Semantic recipe lastValidatedAt must be a string when present.');
  }

  if (value.lifecycle !== undefined && !isRecipeLifecycle(value.lifecycle)) {
    return failure('Semantic recipe lifecycle metadata is invalid.');
  }

  if (!isFigmaSemanticSnapshot(value.figmaSnapshot)) {
    return failure('Semantic recipe has an invalid Figma semantic snapshot.');
  }

  if (value.sourceContract !== undefined && !isPersistedSourceContract(value.sourceContract)) {
    return failure('Semantic recipe has an invalid source contract.');
  }

  if (!Array.isArray(value.bindings)) {
    return failure('Semantic recipe bindings must be an array.');
  }

  if (value.bindings.length > SEMANTIC_LIMITS.maxBindings) {
    return failure(
      `Semantic recipe has ${value.bindings.length} bindings; the limit is ${SEMANTIC_LIMITS.maxBindings}.`,
    );
  }

  const seenIds = new Set<string>();
  for (const [index, binding] of value.bindings.entries()) {
    const issue = validateBinding(binding, index);
    if (issue) {
      return failure(issue);
    }
    const id = (binding as SemanticBinding).id;
    if (seenIds.has(id)) {
      return failure(`Semantic binding id ${JSON.stringify(id)} is duplicated.`);
    }
    seenIds.add(id);
  }

  const serializedLength = JSON.stringify(value).length;
  if (serializedLength > SEMANTIC_LIMITS.maxSerializedLength) {
    return failure(
      `Semantic recipe is ${serializedLength} characters when serialized; the limit is ${SEMANTIC_LIMITS.maxSerializedLength}.`,
    );
  }

  return { ok: true, recipe: value as unknown as SemanticConnectionRecipe };
}

export function isSemanticConnectionRecipe(
  value: unknown,
): value is SemanticConnectionRecipe {
  return validateSemanticRecipe(value).ok;
}

function validateBinding(value: unknown, index: number): string | undefined {
  if (!isRecord(value)) {
    return `Semantic binding at index ${index} must be an object.`;
  }

  if (typeof value.id !== 'string' || value.id.length === 0) {
    return `Semantic binding at index ${index} is missing a stable id.`;
  }

  if (!isCodePropTarget(value.target)) {
    return `Semantic binding ${JSON.stringify(value.id)} has an invalid code prop target.`;
  }

  if (!isBindingSource(value.source)) {
    return `Semantic binding ${JSON.stringify(value.id)} has an invalid or unsafe source.`;
  }

  if (value.transform !== undefined && !isTransform(value.transform)) {
    return `Semantic binding ${JSON.stringify(value.id)} has an unsupported transform.`;
  }

  if (
    value.requirement !== 'optional'
    && value.requirement !== 'required'
    && value.requirement !== 'runtime'
  ) {
    return `Semantic binding ${JSON.stringify(value.id)} has an invalid requirement.`;
  }

  return undefined;
}

export function isCodePropTarget(value: unknown): value is CodePropTarget {
  return isRecord(value)
    && Array.isArray(value.path)
    && value.path.length > 0
    && value.path.length <= SEMANTIC_LIMITS.maxTargetPathDepth
    && value.path.every(
      (segment) => typeof segment === 'string' && isValidTargetPathSegment(segment),
    )
    && typeof value.typeName === 'string'
    && value.typeName.length > 0;
}

function isBindingSource(value: unknown): value is SemanticBindingSource {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case 'component-property':
      return typeof value.propertyId === 'string'
        && value.propertyId.length > 0
        && typeof value.propertyName === 'string'
        && value.propertyName.length > 0;
    case 'nested-text':
      return isLocator(value.locator);
    case 'nested-property':
      return isLocator(value.locator)
        && typeof value.propertyName === 'string'
        && value.propertyName.length > 0;
    case 'instance':
      // The component name must be a valid JSX component identifier so a
      // persisted recipe can never inject arbitrary text into generated JSX.
      return isConnectedInstanceItem(value);
    case 'instances':
      return Array.isArray(value.items)
        && value.items.length > 0
        && value.items.length <= SEMANTIC_LIMITS.maxRepeatedSlotItems
        && value.items.every(isConnectedInstanceItem)
        && (value.itemPath === undefined || (
          Array.isArray(value.itemPath)
          && value.itemPath.length > 0
          && value.itemPath.length <= SEMANTIC_LIMITS.maxTargetPathDepth
          && value.itemPath.every(
            (segment) => typeof segment === 'string' && isValidTargetPathSegment(segment),
          )
        ));
    case 'omitted':
      return true;
    case 'static':
      return isSourcePropValue(value.value);
    case 'runtime':
      return value.note === undefined || typeof value.note === 'string';
    default:
      return false;
  }
}

const COMPONENT_IDENTIFIER_PATTERN = /^[A-Z_$][A-Za-z0-9_$]*$/;

function isConnectedInstanceItem(value: unknown): boolean {
  return isRecord(value)
    && isLocator(value.locator)
    && typeof value.componentName === 'string'
    && COMPONENT_IDENTIFIER_PATTERN.test(value.componentName)
    && typeof value.importPath === 'string'
    && value.importPath.length > 0;
}

export function isLocator(value: unknown): value is SemanticLocator {
  return isRecord(value)
    && Array.isArray(value.namePath)
    && value.namePath.length > 0
    && value.namePath.length <= SEMANTIC_LIMITS.maxLocatorDepth
    && value.namePath.every(
      (segment) => typeof segment === 'string' && segment.length > 0 && !segment.includes(LOCATOR_KEY_SEPARATOR),
    )
    && (value.componentKey === undefined || typeof value.componentKey === 'string')
    && typeof value.fragile === 'boolean';
}

function isTransform(value: unknown): value is SemanticTransform {
  if (!isRecord(value)) {
    return false;
  }

  switch (value.kind) {
    case 'enum':
      return isRecord(value.map)
        && Object.keys(value.map).length > 0
        && Object.keys(value.map).every((key) => !FORBIDDEN_SEGMENTS.has(key))
        && Object.values(value.map).every(isSourcePropValue);
    case 'boolean':
      return (value.whenTrue === undefined || isSourcePropValue(value.whenTrue))
        && (value.whenFalse === undefined || isSourcePropValue(value.whenFalse));
    case 'omit-when-empty':
      return true;
    default:
      return false;
  }
}

function isFigmaSemanticSnapshot(value: unknown): value is FigmaSemanticSnapshot {
  return isRecord(value)
    && typeof value.componentId === 'string'
    && value.componentId.length > 0
    && typeof value.componentName === 'string'
    && value.componentName.length > 0
    && Array.isArray(value.nestedSources)
    && value.nestedSources.length <= SEMANTIC_LIMITS.maxNestedSources
    && value.nestedSources.every(isNestedSourceDescriptor);
}

function isNestedSourceDescriptor(value: unknown): value is FigmaNestedSourceDescriptor {
  return isRecord(value)
    && (
      value.kind === 'nested-property'
      || value.kind === 'nested-text'
      || value.kind === 'nested-instance'
    )
    && isLocator(value.locator)
    && typeof value.displayPath === 'string'
    && (value.propertyName === undefined || typeof value.propertyName === 'string')
    && (value.sampleValue === undefined || typeof value.sampleValue === 'string')
    && (
      value.connectedComponentName === undefined
      || (
        typeof value.connectedComponentName === 'string'
        && COMPONENT_IDENTIFIER_PATTERN.test(value.connectedComponentName)
      )
    )
    && (value.connectedImportPath === undefined || typeof value.connectedImportPath === 'string');
}

/**
 * Structural validation of a persisted source contract. Deliberately does not
 * import the extractor module: only derived, serializable shape is accepted.
 */
function isPersistedSourceContract(value: unknown): boolean {
  return isRecord(value)
    && typeof value.componentName === 'string'
    && value.componentName.length > 0
    && typeof value.fileName === 'string'
    && value.fileName.length > 0
    && typeof value.contentHash === 'string'
    && value.contentHash.length > 0
    && (value.propsTypeName === undefined || (
      typeof value.propsTypeName === 'string'
      && value.propsTypeName.length > 0
    ))
    && Array.isArray(value.targets)
    && value.targets.length <= SEMANTIC_LIMITS.maxContractTargets
    && value.targets.every(isPersistedSourceTarget);
}

function isPersistedSourceTarget(value: unknown): boolean {
  return isRecord(value)
    && Array.isArray(value.path)
    && value.path.length > 0
    && value.path.length <= SEMANTIC_LIMITS.maxTargetPathDepth
    && value.path.every((segment) => typeof segment === 'string' && segment.length > 0)
    && typeof value.ownerProp === 'string'
    && typeof value.typeName === 'string'
    && typeof value.required === 'boolean'
    && (
      value.kind === 'visual'
      || value.kind === 'event'
      || value.kind === 'node'
      || value.kind === 'array'
      || value.kind === 'record'
      || value.kind === 'date'
      || value.kind === 'file'
      || value.kind === 'render'
      || value.kind === 'styling'
      || value.kind === 'controlled'
      || value.kind === 'environment'
      || value.kind === 'excluded'
      || value.kind === 'unsupported'
    )
    && (value.itemSchemas === undefined || (
      Array.isArray(value.itemSchemas)
      && value.itemSchemas.length <= 16
      && value.itemSchemas.every(isPersistedCollectionItemSchema)
    ))
    && (value.controlledBy === undefined || (
      Array.isArray(value.controlledBy)
      && value.controlledBy.length > 0
      && value.controlledBy.length <= SEMANTIC_LIMITS.maxTargetPathDepth
      && value.controlledBy.every(
        (segment) => typeof segment === 'string' && isValidTargetPathSegment(segment),
      )
    ))
    && (value.insideOptionalObject === undefined || typeof value.insideOptionalObject === 'boolean')
    && (value.values === undefined
      || (Array.isArray(value.values) && value.values.every(isSourcePropValue)))
    && (value.defaultValue === undefined || isSourcePropValue(value.defaultValue));
}

function isPersistedCollectionItemSchema(value: unknown): boolean {
  return isRecord(value)
    && (
      value.role === 'item'
      || value.role === 'key'
      || value.role === 'value'
    )
    && typeof value.typeName === 'string'
    && value.typeName.length > 0
    && (value.path === undefined || (
      Array.isArray(value.path)
      && value.path.length > 0
      && value.path.length <= SEMANTIC_LIMITS.maxTargetPathDepth
      && value.path.every(
        (segment) => typeof segment === 'string' && isValidTargetPathSegment(segment),
      )
    ))
    && (
      value.kind === 'visual'
      || value.kind === 'event'
      || value.kind === 'node'
      || value.kind === 'array'
      || value.kind === 'record'
      || value.kind === 'date'
      || value.kind === 'file'
      || value.kind === 'render'
      || value.kind === 'styling'
      || value.kind === 'controlled'
      || value.kind === 'environment'
      || value.kind === 'excluded'
      || value.kind === 'unsupported'
    )
    && (value.values === undefined || (
      Array.isArray(value.values)
      && value.values.every(isSourcePropValue)
    ));
}

function isRecipeLifecycle(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const stateOk = value.state === undefined
    || value.state === 'draft'
    || value.state === 'connected'
    || value.state === 'needs-review'
    || value.state === 'deprecated';
  return stateOk
    && (value.owner === undefined || typeof value.owner === 'string')
    && (value.packageName === undefined || typeof value.packageName === 'string')
    && (value.packageVersion === undefined || typeof value.packageVersion === 'string')
    && (value.replacement === undefined || typeof value.replacement === 'string');
}

function isSourcePropValue(value: unknown): value is SourcePropValue {
  return typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function failure(message: string): RecipeValidationResult {
  return { message, ok: false };
}
