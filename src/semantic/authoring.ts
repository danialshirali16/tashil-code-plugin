/**
 * Pure authoring model for semantic connection recipes.
 *
 * The editor state *is* the recipe: the source contract, the Figma semantic
 * snapshot, and one decision per code target, serialized in the connection
 * form like the legacy mapping document. Everything here is deterministic and
 * UI-framework free so the flow can be unit-tested against the Dialog fixture.
 *
 * Spec: docs/semantic-connect-roadmap.md §"M3 — Authoring UI" and
 * §"Suggestion engine".
 */

import type {
  FigmaComponentSnapshot,
  FigmaPropertyDescriptor,
  SourcePropValue,
} from '../types';
import { getAcceptedComponentNames } from './component-compatibility';
import {
  getComplexComponentRecipe,
  getExclusiveTargetSiblings,
} from './complex-recipes';
import {
  isRuntimeSourceTargetKind,
  type SourceCollectionItemSchema,
  type SourceContract,
  type SourceTargetDescriptor,
} from './source-contract';
import {
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  SEMANTIC_LIMITS,
  formatTargetPath,
  locatorKey,
  type FigmaNestedSourceDescriptor,
  type FigmaSemanticSnapshot,
  type ConnectedInstanceItem,
  type SemanticBinding,
  type SemanticBindingSource,
  type SemanticConnectionRecipe,
  type SemanticTransform,
} from './types';

export type SemanticTargetSection =
  | 'content'
  | 'variants'
  | 'actions'
  | 'data'
  | 'slots'
  | 'behavior'
  | 'excluded';

export const SECTION_LABELS: Record<SemanticTargetSection, string> = {
  actions: 'Actions',
  behavior: 'Application behavior',
  content: 'Content',
  data: 'Application data',
  excluded: 'Excluded by policy',
  slots: 'Slots',
  variants: 'Variants & states',
};

/** Stable option ids for the single value-selection control. */
export const OPTION_UNSET = '';
export const OPTION_RUNTIME = 'runtime';
export const OPTION_STATIC = 'static';
export const OPTION_OMITTED = 'omitted';
export const OPTION_REPEATED = 'repeated';

export type SemanticValueOption = {
  id: string;
  label: string;
  /** Sample value or short description shown next to the label. */
  detail?: string;
  fragile?: boolean;
  /**
   * The types do not obviously line up. Still offered — a designer knows their
   * own component, and the per-value pairs can bridge most mismatches — but
   * flagged so the choice is deliberate.
   */
  needsCheck?: boolean;
};

/** One source value and the Figma option that should produce it. */
export type SemanticValueMappingRow = {
  sourceValue: SourcePropValue;
  /** Figma option currently mapped to this source value; '' when unmapped. */
  figmaOption: string;
  options: string[];
};

export type SemanticTargetRow = {
  target: SourceTargetDescriptor;
  targetPath: string;
  section: SemanticTargetSection;
  optionId: string;
  /** Stable source ids in authored order for an array-valued component slot. */
  repeatedOptionIds?: string[];
  staticValue?: SourcePropValue;
  options: SemanticValueOption[];
  suggestion?: { optionId: string; reason: string };
  /**
   * Present when the target is an enum bound to a Figma variant: the user must
   * be able to pair each source value with a Figma option directly, because no
   * synonym dictionary can cover every design system's naming.
   */
  valueMappings?: SemanticValueMappingRow[];
};

export type RecipeDraftValidation = {
  errors: string[];
  warnings: string[];
  /** Resolved required visual targets over total required visual targets. */
  progress: { completed: number; total: number };
  saveable: boolean;
  /**
   * One-line pre-save summary (roadmap M7). Counts each blocking/review
   * category so the editor can show a scannable status before the detail lists.
   */
  summary: RecipeValidationSummary;
};

export type RecipeValidationSummary = {
  /** Required visual props still unmapped. */
  unresolvedRequired: number;
  /** Required runtime props (callbacks/data) still unmarked. */
  unresolvedRuntime: number;
  /** Connected components whose source type rejects them. */
  incompatibleSlots: number;
  /** Total blocking issues (everything that makes saveable false). */
  blocking: number;
  /** Non-blocking review items (fragile locators, unmapped enum values). */
  review: number;
};

export function getTargetSection(target: SourceTargetDescriptor): SemanticTargetSection {
  if (target.kind === 'event') {
    return 'behavior';
  }
  if (target.kind === 'node' || target.kind === 'render') {
    return 'slots';
  }
  if (isRuntimeSourceTargetKind(target.kind)) {
    return 'data';
  }
  if (target.kind === 'excluded' || target.kind === 'unsupported') {
    return 'excluded';
  }
  if (target.path.length > 1) {
    return 'actions';
  }
  if (target.values !== undefined && target.values.length > 0) {
    return 'variants';
  }
  return 'content';
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** Explicit, testable synonym dictionary (roadmap: no fuzzy magic). */
const NAME_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  cancel: ['secondary', 'dismiss'],
  children: ['label', 'text', 'content'],
  confirm: ['primary', 'submit'],
  description: ['body', 'subtitle', 'supportingtext'],
  label: ['text', 'buttontext'],
  title: ['heading', 'headline'],
};

function nameMatches(targetName: string, candidateName: string): boolean {
  const target = normalize(targetName);
  const candidate = normalize(candidateName);
  if (target === candidate) {
    return true;
  }
  return NAME_SYNONYMS[target]?.some((synonym) => normalize(synonym) === candidate) ?? false;
}

function nameRelates(targetName: string, candidateName: string): boolean {
  const target = normalize(targetName);
  const candidate = normalize(candidateName);
  if (candidate.includes(target) || target.includes(candidate)) {
    return true;
  }
  return NAME_SYNONYMS[target]?.some(
    (synonym) => candidate.includes(normalize(synonym)),
  ) ?? false;
}

export function propertyOptionId(property: FigmaPropertyDescriptor): string {
  return `prop:${property.id}`;
}

export function nestedOptionId(descriptor: FigmaNestedSourceDescriptor): string {
  return `nested:${descriptor.kind}:${locatorKey(descriptor.locator)}:${descriptor.propertyName ?? descriptor.instancePropertyName ?? ''}`;
}

function isPropertyCompatible(
  target: SourceTargetDescriptor,
  property: FigmaPropertyDescriptor,
): boolean {
  if (target.kind === 'node') {
    return property.type === 'INSTANCE_SWAP'
      || (target.path[target.path.length - 1] === 'children' && property.type === 'TEXT');
  }
  if (target.kind !== 'visual') {
    return false;
  }

  const values = target.values ?? [];
  const isBoolean = values.length === 2 && values.every((value) => typeof value === 'boolean');

  if (isBoolean) {
    // A boolean prop is often driven by one option of a multi-option variant
    // (`disabled` ← `State=Disabled`), so accept any variant and let the
    // per-value rows decide which options mean true and false.
    return property.type === 'BOOLEAN' || property.type === 'VARIANT';
  }
  if (values.length > 0) {
    return property.type === 'VARIANT';
  }
  return property.type === 'TEXT';
}

function isNestedCompatible(
  target: SourceTargetDescriptor,
  descriptor: FigmaNestedSourceDescriptor,
): boolean {
  // A connected nested instance is a whole component, so it fits exactly the
  // targets that expect one (ReactNode slots) and nothing else.
  if (descriptor.kind === 'nested-instance') {
    const itemNode = findRepeatedNodeItemSchema(target);
    const acceptsComponents = target.kind === 'node' || itemNode !== undefined;
    if (!acceptsComponents || descriptor.connectedComponentName === undefined) {
      return false;
    }
    const accepted = getAcceptedComponentNames(itemNode?.typeName ?? target.typeName);
    return accepted.length === 0 || accepted.includes(descriptor.connectedComponentName);
  }

  if (target.kind !== 'visual') {
    return false;
  }
  const values = target.values ?? [];
  const isBoolean = values.length === 2
    && values.every((value) => typeof value === 'boolean');
  if (descriptor.kind === 'nested-text') {
    // Free text feeds strings; enum/boolean targets need a discrete source.
    return values.length === 0 && target.typeName !== 'number';
  }
  // Literal unions need a declarative transform; v1 authors that only for
  // top-level variant properties, so nested properties feed free values.
  return values.length === 0 || isBoolean;
}

function findRepeatedNodeItemSchema(
  target: SourceTargetDescriptor,
): SourceCollectionItemSchema | undefined {
  return target.kind === 'array'
    ? target.itemSchemas?.find((item) => item.role === 'item' && item.kind === 'node')
    : undefined;
}

/**
 * Every design value this component offers, for one code target. Values whose
 * type obviously fits come first; the rest follow, marked `needsCheck` rather
 * than hidden, because hiding them makes a real property look unavailable and
 * only the person who built the component knows what it means.
 */
export function buildValueOptions(
  target: SourceTargetDescriptor,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: FigmaSemanticSnapshot,
): SemanticValueOption[] {
  const fitting: SemanticValueOption[] = [];
  const rest: SemanticValueOption[] = [];

  for (const property of figmaSnapshot?.properties ?? []) {
    const option: SemanticValueOption = {
      detail: property.type === 'VARIANT'
        ? property.options.join(' · ')
        : property.type.toLowerCase(),
      id: propertyOptionId(property),
      label: property.name,
    };
    if (isPropertyCompatible(target, property)) {
      fitting.push(option);
    } else {
      rest.push({ ...option, needsCheck: true });
    }
  }

  for (const descriptor of semanticSnapshot.nestedSources) {
    const option: SemanticValueOption = {
      id: nestedOptionId(descriptor),
      label: descriptor.displayPath,
      ...(descriptor.sampleValue !== undefined ? { detail: descriptor.sampleValue } : {}),
      ...(descriptor.locator.fragile ? { fragile: true } : {}),
    };
    if (isNestedCompatible(target, descriptor)) {
      fitting.push(option);
    } else {
      rest.push({ ...option, needsCheck: true });
    }
  }

  return [...fitting, ...rest];
}

/**
 * Deterministic suggestion for one target: unique name match on the leaf,
 * disambiguated by the owning prop's relation to the locator path. Ties
 * produce no suggestion — the user must decide.
 */
export function suggestOption(
  target: SourceTargetDescriptor,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: FigmaSemanticSnapshot,
): { optionId: string; reason: string } | undefined {
  if (isRuntimeSourceTargetKind(target.kind)) {
    return {
      optionId: OPTION_RUNTIME,
      reason: target.kind === 'event'
        ? 'Callbacks are provided by application code.'
        : 'Complex values are provided by application code.',
    };
  }
  if (target.kind === 'node') {
    const preferredName = normalize(target.path[target.path.length - 1])
      .replace(/^render/, '')
      .replace(/^left/, 'leading')
      .replace(/^right/, 'trailing');
    const propertyMatches = (figmaSnapshot?.properties ?? []).filter(
      (property) => isPropertyCompatible(target, property)
        && nameMatches(preferredName, property.name),
    );
    if (propertyMatches.length === 1) {
      return {
        optionId: propertyOptionId(propertyMatches[0]),
        reason: `Figma instance property "${propertyMatches[0].name}" supplies "${target.path[target.path.length - 1]}".`,
      };
    }
  }
  if (target.kind !== 'visual') {
    return undefined;
  }

  const leafName = target.path[target.path.length - 1];

  const propertyMatches = (figmaSnapshot?.properties ?? []).filter(
    (property) => isPropertyCompatible(target, property)
      && nameMatches(leafName, property.name),
  );
  if (propertyMatches.length === 1) {
    return {
      optionId: propertyOptionId(propertyMatches[0]),
      reason: `Figma property "${propertyMatches[0].name}" matches "${leafName}".`,
    };
  }
  if (propertyMatches.length > 1) {
    return undefined;
  }

  const nestedMatches = semanticSnapshot.nestedSources.filter((descriptor) => {
    if (!isNestedCompatible(target, descriptor)) {
      return false;
    }
    const nestedLeafName = descriptor.propertyName
      ?? descriptor.locator.namePath[descriptor.locator.namePath.length - 1];
    return nameMatches(leafName, nestedLeafName);
  });

  if (nestedMatches.length === 1) {
    return {
      optionId: nestedOptionId(nestedMatches[0]),
      reason: `Nested value "${nestedMatches[0].displayPath}" matches "${leafName}".`,
    };
  }

  if (nestedMatches.length > 1 && target.path.length > 1) {
    const contextual = nestedMatches.filter((descriptor) => (
      descriptor.locator.namePath.some((segment) => segmentRelates(target.ownerProp, segment))
    ));
    if (contextual.length === 1) {
      return {
        optionId: nestedOptionId(contextual[0]),
        reason: `"${contextual[0].displayPath}" relates to "${target.ownerProp}" and matches "${leafName}".`,
      };
    }
  }

  return undefined;
}

function segmentRelates(ownerProp: string, segment: string): boolean {
  const stems = ownerProp
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/\s+/)
    .filter((stem) => normalize(stem) !== 'action' && stem.length > 0);
  return stems.some((stem) => nameRelates(stem, segment) || nameMatches(stem, segment));
}

/**
 * Build a recipe draft: contract + snapshot + one binding per confirmed or
 * suggested decision. Existing bindings survive when their target still
 * exists; suggestions fill only untouched targets and are visible as such in
 * the row model until the user reviews and saves.
 */
export function createRecipeDraft(
  contract: SourceContract,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: FigmaSemanticSnapshot,
  existing?: SemanticConnectionRecipe,
): SemanticConnectionRecipe {
  if (
    existing?.sourceContract
    && !sourceContractsEquivalent(existing.sourceContract, contract)
  ) {
    return {
      ...existing,
      figmaSnapshot: semanticSnapshot,
      pendingSourceContract: contract,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    };
  }

  const existingByTarget = new Map(
    (existing?.bindings ?? []).map((binding) => [formatTargetPath(binding.target), binding]),
  );
  const bindings: SemanticBinding[] = [];
  const complexRecipe = getComplexComponentRecipe(contract.componentName);

  for (const target of contract.targets) {
    const targetPath = target.path.join('.');
    const kept = existingByTarget.get(targetPath);
    if (kept) {
      bindings.push(kept);
      continue;
    }

    const recipeRuntimeTarget = complexRecipe?.runtimeTargets.includes(targetPath) ?? false;
    const recipeOmittedTarget = complexRecipe?.omittedTargets?.includes(targetPath) ?? false;
    const complexDefault = complexRecipe
      && (recipeOmittedTarget || recipeRuntimeTarget || isRuntimeSourceTargetKind(target.kind))
      ? recipeOmittedTarget
        ? OPTION_OMITTED
        : target.required || recipeRuntimeTarget
          ? OPTION_RUNTIME
          : OPTION_OMITTED
      : undefined;
    const suggestion = complexDefault
      ? {
          optionId: complexDefault,
          reason: complexDefault === OPTION_RUNTIME
            ? complexRecipe?.summary ?? 'Provided by application code.'
            : 'Optional advanced input is left out by the component recipe.',
        }
      : suggestOption(target, figmaSnapshot, semanticSnapshot);
    if (!suggestion) {
      continue;
    }

    const binding = createBindingForOption(
      target,
      suggestion.optionId,
      figmaSnapshot,
      semanticSnapshot,
    );
    if (binding) {
      bindings.push(binding);
    }
  }

  // Preserve bindings whose target is absent from the new contract (a renamed
  // or removed source prop) instead of dropping them silently — reconciliation
  // surfaces them for an explicit remap or removal (roadmap: never silently
  // delete a saved binding).
  const contractPaths = new Set(contract.targets.map((target) => target.path.join('.')));
  for (const binding of existing?.bindings ?? []) {
    if (!contractPaths.has(formatTargetPath(binding.target))) {
      bindings.push(binding);
    }
  }

  return {
    bindings,
    figmaSnapshot: semanticSnapshot,
    revision: existing?.revision ?? 1,
    schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
    sourceContract: contract,
    pendingSourceContract: undefined,
  };
}

function sourceContractsEquivalent(left: SourceContract, right: SourceContract): boolean {
  const comparable = (contract: SourceContract) => ({
    componentName: contract.componentName,
    propsTypeChain: contract.propsTypeChain ?? [],
    propsTypeName: contract.propsTypeName,
    targets: contract.targets.map(({ declaredIn: _declaredIn, ...target }) => target),
  });
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

/** Contract shown by authoring while the accepted contract remains active for resolution. */
export function getAuthoringSourceContract(
  recipe: SemanticConnectionRecipe,
): SourceContract | undefined {
  return recipe.pendingSourceContract ?? recipe.sourceContract;
}

/** Apply one decision from the single value-selection control. */
export function setTargetOption(
  recipe: SemanticConnectionRecipe,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  targetPath: readonly string[],
  optionId: string,
  staticValue?: SourcePropValue,
): SemanticConnectionRecipe {
  const target = getAuthoringSourceContract(recipe)?.targets.find(
    (candidate) => candidate.path.join('.') === targetPath.join('.'),
  );
  const remaining = recipe.bindings.filter(
    (binding) => formatTargetPath(binding.target) !== targetPath.join('.'),
  );

  if (!target || optionId === OPTION_UNSET) {
    return { ...recipe, bindings: remaining };
  }

  const binding = createBindingForOption(
    target,
    optionId,
    figmaSnapshot,
    recipe.figmaSnapshot,
    staticValue,
  );

  const exclusiveRemaining = binding && binding.source.kind !== 'omitted'
    ? omitExclusiveTargetSiblings(recipe, targetPath.join('.'), remaining)
    : remaining;

  return binding
    ? { ...recipe, bindings: [...exclusiveRemaining, binding] }
    : { ...recipe, bindings: remaining };
}

function omitExclusiveTargetSiblings(
  recipe: SemanticConnectionRecipe,
  targetPath: string,
  bindings: readonly SemanticBinding[],
): SemanticBinding[] {
  const componentName = getAuthoringSourceContract(recipe)?.componentName;
  if (!componentName) {
    return [...bindings];
  }
  const siblingPaths = getExclusiveTargetSiblings(componentName, targetPath);
  if (siblingPaths.length === 0) {
    return [...bindings];
  }
  const siblings = new Set(siblingPaths);
  const withoutSiblings = bindings.filter(
    (binding) => !siblings.has(formatTargetPath(binding.target)),
  );
  const omittedSiblings = (getAuthoringSourceContract(recipe)?.targets ?? [])
    .filter((target) => siblings.has(target.path.join('.')) && !target.required)
    .map<SemanticBinding>((target) => ({
      id: `target:${target.path.join('.')}`,
      requirement: 'optional',
      source: { kind: 'omitted' },
      target: { path: [...target.path], typeName: target.typeName },
    }));
  return [...withoutSiblings, ...omittedSiblings];
}

/**
 * Replace an array target with an explicitly ordered list of connected nested
 * instances. Option ids use the same stable locator-based ids as the ordinary
 * source picker, so reordering never depends on display names.
 */
export function setRepeatedTargetInstances(
  recipe: SemanticConnectionRecipe,
  targetPath: readonly string[],
  orderedOptionIds: readonly string[],
): SemanticConnectionRecipe {
  const path = targetPath.join('.');
  const target = getAuthoringSourceContract(recipe)?.targets.find(
    (candidate) => candidate.path.join('.') === path,
  );
  const remaining = recipe.bindings.filter(
    (binding) => formatTargetPath(binding.target) !== path,
  );
  if (
    target?.kind !== 'array'
    || orderedOptionIds.length === 0
    || orderedOptionIds.length > SEMANTIC_LIMITS.maxRepeatedSlotItems
  ) {
    return { ...recipe, bindings: remaining };
  }

  const items: ConnectedInstanceItem[] = [];
  for (const optionId of orderedOptionIds) {
    const descriptor = findNestedByOptionId(recipe.figmaSnapshot, optionId);
    if (
      descriptor?.kind !== 'nested-instance'
      || descriptor.connectedComponentName === undefined
      || descriptor.connectedImportPath === undefined
      || !isNestedCompatible(target, descriptor)
    ) {
      return recipe;
    }
    items.push({
      componentName: descriptor.connectedComponentName,
      importPath: descriptor.connectedImportPath,
      locator: descriptor.locator,
      ...(descriptor.instancePropertyName !== undefined
        ? { instancePropertyName: descriptor.instancePropertyName }
        : {}),
    });
  }

  const itemNode = findRepeatedNodeItemSchema(target);
  const binding: SemanticBinding = {
    id: `target:${path}`,
    requirement: target.required ? 'required' : 'optional',
    source: {
      items,
      kind: 'instances',
      ...(itemNode?.path
        ? { itemPath: itemNode.path }
        : {}),
    },
    target: { path: [...target.path], typeName: target.typeName },
  };
  return {
    ...recipe,
    bindings: [
      ...omitExclusiveTargetSiblings(recipe, path, remaining),
      binding,
    ],
  };
}

/** Reorder one existing repeated slot item without rebuilding its sources. */
export function moveRepeatedTargetInstance(
  recipe: SemanticConnectionRecipe,
  targetPath: readonly string[],
  fromIndex: number,
  toIndex: number,
): SemanticConnectionRecipe {
  const path = targetPath.join('.');
  return {
    ...recipe,
    bindings: recipe.bindings.map((binding) => {
      if (
        formatTargetPath(binding.target) !== path
        || binding.source.kind !== 'instances'
        || fromIndex < 0
        || fromIndex >= binding.source.items.length
        || toIndex < 0
        || toIndex >= binding.source.items.length
        || fromIndex === toIndex
      ) {
        return binding;
      }
      const items = [...binding.source.items];
      const [moved] = items.splice(fromIndex, 1);
      items.splice(toIndex, 0, moved);
      return { ...binding, source: { ...binding.source, items } };
    }),
  };
}

/** Read the active option id for a target back out of the recipe. */
export function getTargetOptionId(
  recipe: SemanticConnectionRecipe,
  target: SourceTargetDescriptor,
): {
  optionId: string;
  repeatedOptionIds?: string[];
  staticValue?: SourcePropValue;
} {
  const binding = recipe.bindings.find(
    (candidate) => formatTargetPath(candidate.target) === target.path.join('.'),
  );
  if (!binding) {
    return { optionId: OPTION_UNSET };
  }

  const source = binding.source;
  switch (source.kind) {
    case 'component-property':
      return { optionId: `prop:${source.propertyId}` };
    case 'nested-text':
      return { optionId: `nested:nested-text:${locatorKey(source.locator)}:` };
    case 'nested-property':
      return {
        optionId: `nested:nested-property:${locatorKey(source.locator)}:${source.propertyName}`,
      };
    case 'instance':
      return {
        optionId: `nested:nested-instance:${locatorKey(source.locator)}:${source.instancePropertyName ?? ''}`,
      };
    case 'instances':
      return {
        optionId: OPTION_REPEATED,
        repeatedOptionIds: source.items.map(
          (item) => `nested:nested-instance:${locatorKey(item.locator)}:${item.instancePropertyName ?? ''}`,
        ),
      };
    case 'static':
      return { optionId: OPTION_STATIC, staticValue: source.value };
    case 'runtime':
      return { optionId: OPTION_RUNTIME };
    case 'omitted':
      return { optionId: OPTION_OMITTED };
  }
}

function createBindingForOption(
  target: SourceTargetDescriptor,
  optionId: string,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: FigmaSemanticSnapshot,
  staticValue?: SourcePropValue,
): SemanticBinding | undefined {
  const base = {
    id: `target:${target.path.join('.')}`,
    requirement: isRuntimeSourceTargetKind(target.kind)
      ? 'runtime' as const
      : target.required
        ? 'required' as const
        : 'optional' as const,
    target: { path: [...target.path], typeName: target.typeName },
  };

  if (optionId === OPTION_RUNTIME) {
    return { ...base, requirement: 'runtime', source: { kind: 'runtime' } };
  }

  if (optionId === OPTION_OMITTED) {
    // Only optional targets may be omitted; a required prop must be provided.
    // The requirement is restated as optional so an omitted event prop does not
    // carry the runtime requirement its kind would otherwise imply, which read
    // as a contradiction wherever the binding was inspected.
    return target.required
      ? undefined
      : { ...base, requirement: 'optional', source: { kind: 'omitted' } };
  }

  if (optionId === OPTION_STATIC) {
    if (staticValue === undefined) {
      return undefined;
    }
    return { ...base, source: { kind: 'static', value: staticValue } };
  }

  if (optionId.startsWith('prop:')) {
    const propertyId = optionId.slice('prop:'.length);
    const property = figmaSnapshot?.properties.find(
      (candidate) => candidate.id === propertyId,
    );
    const source: SemanticBindingSource = {
      kind: 'component-property',
      propertyId,
      propertyName: property?.name ?? propertyId,
    };
    const transform = property ? deriveTransform(target, property) : undefined;
    return { ...base, source, ...(transform ? { transform } : {}) };
  }

  if (optionId.startsWith('nested:')) {
    const descriptor = findNestedByOptionId(semanticSnapshot, optionId);
    if (!descriptor) {
      return undefined;
    }
    if (descriptor.kind === 'nested-instance') {
      if (
        descriptor.connectedComponentName === undefined
        || descriptor.connectedImportPath === undefined
      ) {
        return undefined;
      }
      const item: ConnectedInstanceItem = {
        componentName: descriptor.connectedComponentName,
        importPath: descriptor.connectedImportPath,
        locator: descriptor.locator,
        ...(descriptor.instancePropertyName !== undefined
          ? { instancePropertyName: descriptor.instancePropertyName }
          : {}),
      };
      return {
        ...base,
        requirement: target.required ? 'required' : 'optional',
        source: target.kind === 'array'
          ? { items: [item], kind: 'instances' }
          : { ...item, kind: 'instance' },
      };
    }

    const source: SemanticBindingSource = descriptor.kind === 'nested-text'
      ? { kind: 'nested-text', locator: descriptor.locator }
      : {
          kind: 'nested-property',
          locator: descriptor.locator,
          propertyName: descriptor.propertyName ?? '',
        };
    return { ...base, source };
  }

  return undefined;
}

function findNestedByOptionId(
  semanticSnapshot: FigmaSemanticSnapshot,
  optionId: string,
): FigmaNestedSourceDescriptor | undefined {
  return semanticSnapshot.nestedSources.find(
    (descriptor) => nestedOptionId(descriptor) === optionId,
  );
}

/**
 * Explicit, testable equivalence classes for enum option values. Two values
 * are aliases when they land in the same group after normalization — so a
 * Figma `Size = Small | Medium | Large | xLarge` variant auto-maps onto a
 * source `'sm' | 'md' | 'lg' | 'xl'` union. Bidirectional by construction; add
 * a token to a group to teach a new synonym. Never fuzzy — an unlisted pairing
 * simply stays unmapped and surfaces as a reviewable warning.
 */
const VALUE_ALIAS_GROUPS: readonly (readonly string[])[] = [
  ['error', 'danger', 'destructive', 'negative'],
  ['success', 'positive'],
  ['warning', 'caution'],
  ['primary', 'brand', 'main'],
  ['true', 'on', 'yes'],
  ['false', 'off', 'no'],
  // Size scale: abbreviation ↔ full word.
  ['xs', 'xsmall', 'extrasmall'],
  ['sm', 'small'],
  ['md', 'medium', 'med'],
  ['lg', 'large'],
  ['xl', 'xlarge', 'extralarge'],
  ['xxl', 'xxlarge'],
];

const VALUE_ALIAS_INDEX: ReadonlyMap<string, number> = (() => {
  const index = new Map<string, number>();
  VALUE_ALIAS_GROUPS.forEach((group, groupIndex) => {
    for (const token of group) {
      index.set(normalize(token), groupIndex);
    }
  });
  return index;
})();

function valuesEquivalent(sourceValue: SourcePropValue, figmaValue: string): boolean {
  const normalizedSource = normalize(String(sourceValue));
  const normalizedFigma = normalize(figmaValue);
  if (normalizedSource === normalizedFigma) {
    return true;
  }
  const sourceGroup = VALUE_ALIAS_INDEX.get(normalizedSource);
  const figmaGroup = VALUE_ALIAS_INDEX.get(normalizedFigma);
  return sourceGroup !== undefined && sourceGroup === figmaGroup;
}

/**
 * Derive the declarative transform a target/property pair needs. VARIANT
 * options map onto literal-union values by normalized equivalence; unmatched
 * options are simply absent from the map and surface as validation warnings.
 */
export function deriveTransform(
  target: SourceTargetDescriptor,
  property: FigmaPropertyDescriptor,
): SemanticTransform | undefined {
  const values = target.values ?? [];

  if (property.type === 'BOOLEAN' || values.length === 0) {
    return undefined;
  }

  const map: Record<string, SourcePropValue> = {};
  for (const option of property.options) {
    const match = values.find((value) => valuesEquivalent(value, option));
    if (match !== undefined) {
      map[option] = match;
    }
  }

  return Object.keys(map).length > 0 ? { kind: 'enum', map } : undefined;
}

/**
 * Option ids of every Figma source a binding currently consumes, so the
 * connect board can show which side of the design surface is already in use
 * and — just as importantly — which parts are not.
 */
export function getUsedSourceOptionIds(recipe: SemanticConnectionRecipe): Set<string> {
  const used = new Set<string>();

  for (const binding of recipe.bindings) {
    const source = binding.source;
    switch (source.kind) {
      case 'component-property':
        used.add(`prop:${source.propertyId}`);
        break;
      case 'nested-text':
        used.add(`nested:nested-text:${locatorKey(source.locator)}:`);
        break;
      case 'nested-property':
        used.add(`nested:nested-property:${locatorKey(source.locator)}:${source.propertyName}`);
        break;
      case 'instance':
        used.add(`nested:nested-instance:${locatorKey(source.locator)}:${source.instancePropertyName ?? ''}`);
        break;
      case 'instances':
        for (const item of source.items) {
          used.add(`nested:nested-instance:${locatorKey(item.locator)}:${item.instancePropertyName ?? ''}`);
        }
        break;
      default:
        break;
    }
  }

  return used;
}

/** Build the grouped row model the editor renders. */
export function buildTargetRows(
  recipe: SemanticConnectionRecipe,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
): SemanticTargetRow[] {
  const contract = getAuthoringSourceContract(recipe);
  if (!contract) {
    return [];
  }

  const sectionOrder: SemanticTargetSection[] = [
    'content',
    'variants',
    'actions',
    'data',
    'slots',
    'behavior',
    'excluded',
  ];

  const rows = contract.targets.map((target): SemanticTargetRow => {
    const { optionId, repeatedOptionIds, staticValue } = getTargetOptionId(recipe, target);
    const binding = recipe.bindings.find(
      (candidate) => formatTargetPath(candidate.target) === target.path.join('.'),
    );
    const valueMappings = buildValueMappings(binding, target, figmaSnapshot);

    return {
      optionId,
      options: buildValueOptions(target, figmaSnapshot, recipe.figmaSnapshot),
      ...(repeatedOptionIds !== undefined ? { repeatedOptionIds } : {}),
      ...(valueMappings ? { valueMappings } : {}),
      section: getTargetSection(target),
      ...(staticValue !== undefined ? { staticValue } : {}),
      suggestion: suggestOption(target, figmaSnapshot, recipe.figmaSnapshot),
      target,
      targetPath: target.path.join('.'),
    };
  });

  return rows.sort((first, second) => (
    sectionOrder.indexOf(first.section) - sectionOrder.indexOf(second.section)
  ));
}

function buildValueMappings(
  binding: SemanticBinding | undefined,
  target: SourceTargetDescriptor,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
): SemanticValueMappingRow[] | undefined {
  if (!binding || binding.source.kind !== 'component-property') {
    return undefined;
  }
  const values = target.values ?? [];
  if (values.length === 0) {
    return undefined;
  }
  const property = figmaSnapshot?.properties.find(
    (candidate) => candidate.id === (binding.source as { propertyId: string }).propertyId,
  );
  if (!property || property.type !== 'VARIANT' || property.options.length === 0) {
    return undefined;
  }

  const map = binding.transform?.kind === 'enum' ? binding.transform.map : {};
  return values.map((sourceValue) => ({
    figmaOption: Object.entries(map).find(([, mapped]) => mapped === sourceValue)?.[0] ?? '',
    options: [...property.options],
    sourceValue,
  }));
}

/**
 * Pair one source value with a Figma option. Each source value is produced by
 * at most one option, so setting a pair clears any previous option for that
 * value; passing an empty option unmaps it.
 */
export function setTargetValueMapping(
  recipe: SemanticConnectionRecipe,
  targetPath: readonly string[],
  sourceValue: SourcePropValue,
  figmaOption: string,
): SemanticConnectionRecipe {
  const path = targetPath.join('.');

  return {
    ...recipe,
    bindings: recipe.bindings.map((binding) => {
      if (formatTargetPath(binding.target) !== path) {
        return binding;
      }

      const existing = binding.transform?.kind === 'enum' ? binding.transform.map : {};
      const map: Record<string, SourcePropValue> = {};
      for (const [option, mapped] of Object.entries(existing)) {
        if (mapped !== sourceValue) {
          map[option] = mapped;
        }
      }
      if (figmaOption !== '') {
        map[figmaOption] = sourceValue;
      }

      const { transform: _dropped, ...rest } = binding;
      return Object.keys(map).length > 0
        ? { ...rest, transform: { kind: 'enum', map } }
        : rest;
    }),
  };
}

/** Roadmap validation rules: what blocks save, what only warns. */
export function validateRecipeDraft(
  recipe: SemanticConnectionRecipe,
): RecipeDraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const contract = getAuthoringSourceContract(recipe);
  let completed = 0;
  let total = 0;
  // Counters for the pre-save summary, incremented at the exact branch that
  // raises each issue so the summary can never drift from the message lists.
  let unresolvedRequired = 0;
  let unresolvedRuntime = 0;
  let incompatibleSlots = 0;
  let review = 0;

  if (recipe.pendingSourceContract) {
    errors.push('Review and accept the uploaded source update before saving.');
  }

  const bindingsByTarget = new Map(
    recipe.bindings.map((binding) => [formatTargetPath(binding.target), binding]),
  );

  for (const target of contract?.targets ?? []) {
    const targetPath = target.path.join('.');
    const binding = bindingsByTarget.get(targetPath);

    if (target.kind === 'visual' && target.required) {
      total += 1;
      // An explicit omission never satisfies a required prop.
      if (binding && binding.source.kind !== 'omitted') {
        completed += 1;
      } else if (binding?.source.kind === 'omitted') {
        unresolvedRequired += 1;
        errors.push(`"${targetPath}" is required and cannot be omitted.`);
      } else {
        unresolvedRequired += 1;
        errors.push(`Map, set, or mark "${targetPath}" before saving — it is required.`);
      }
    }

    if (
      isRuntimeSourceTargetKind(target.kind)
      && target.required
      && (!binding || binding.source.kind === 'omitted')
    ) {
      unresolvedRuntime += 1;
      errors.push(
        target.kind === 'event'
          ? `Mark the required callback "${targetPath}" as set in application.`
          : `Mark the required ${target.kind} value "${targetPath}" as set in application.`,
      );
    }

    if (binding) {
      if (
        target.kind === 'node'
        && binding.source.kind === 'instance'
      ) {
        const accepted = getAcceptedComponentNames(target.typeName);
        if (
          accepted.length > 0
          && !accepted.includes(binding.source.componentName)
        ) {
          incompatibleSlots += 1;
          errors.push(
            `"${targetPath}" accepts ${accepted.join(' or ')}, not ${binding.source.componentName}.`,
          );
        }
      }

      if (target.kind === 'array' && binding.source.kind === 'instances') {
        const acceptedFromItems = (target.itemSchemas ?? [])
          .filter((item) => item.role === 'item' && item.kind === 'node')
          .flatMap((item) => getAcceptedComponentNames(item.typeName));
        const accepted = [...new Set(
          acceptedFromItems.length > 0
            ? acceptedFromItems
            : getAcceptedComponentNames(target.typeName),
        )];
        const incompatibleNames = [...new Set(
          binding.source.items
            .map((item) => item.componentName)
            .filter((name) => accepted.length > 0 && !accepted.includes(name)),
        )];
        if (incompatibleNames.length > 0) {
          incompatibleSlots += 1;
          errors.push(
            `"${targetPath}" accepts ${accepted.join(' or ')}, not ${incompatibleNames.join(', ')}.`,
          );
        }
      }

      if (
        (binding.source.kind === 'nested-text' || binding.source.kind === 'nested-property')
        && binding.source.locator.fragile
      ) {
        review += 1;
        warnings.push(
          `"${targetPath}" is located by layer names only; renaming those layers breaks it.`,
        );
      }

      if (
        binding.source.kind === 'component-property'
        && (target.values?.length ?? 0) > 0
        && binding.transform?.kind === 'enum'
      ) {
        const mappedValues = new Set(Object.values(binding.transform.map));
        const unmapped = (target.values ?? []).filter((value) => !mappedValues.has(value));
        if (unmapped.length > 0) {
          review += 1;
          warnings.push(
            `"${targetPath}": no Figma option maps to ${unmapped.map((value) => JSON.stringify(String(value))).join(', ')}.`,
          );
        }
      }
    }
  }

  return {
    errors,
    progress: { completed, total },
    saveable: errors.length === 0,
    summary: {
      blocking: errors.length,
      incompatibleSlots,
      review,
      unresolvedRequired,
      unresolvedRuntime,
    },
    warnings,
  };
}

/** True when confirmed bindings pull values from nested design regions. */
export function hasStructuralMismatch(recipe: SemanticConnectionRecipe): boolean {
  return recipe.bindings.some(
    (binding) => binding.source.kind === 'nested-text'
      || binding.source.kind === 'nested-property'
      || binding.source.kind === 'instances',
  );
}
