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
import type { SourceContract, SourceTargetDescriptor } from './source-contract';
import {
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  formatTargetPath,
  locatorKey,
  type FigmaNestedSourceDescriptor,
  type FigmaSemanticSnapshot,
  type SemanticBinding,
  type SemanticBindingSource,
  type SemanticConnectionRecipe,
  type SemanticTransform,
} from './types';

export type SemanticTargetSection =
  | 'content'
  | 'variants'
  | 'actions'
  | 'slots'
  | 'behavior'
  | 'excluded';

export const SECTION_LABELS: Record<SemanticTargetSection, string> = {
  actions: 'Actions',
  behavior: 'Application behavior',
  content: 'Content',
  excluded: 'Excluded by policy',
  slots: 'Slots',
  variants: 'Variants & states',
};

/** Stable option ids for the single value-selection control. */
export const OPTION_UNSET = '';
export const OPTION_RUNTIME = 'runtime';
export const OPTION_STATIC = 'static';
export const OPTION_OMITTED = 'omitted';

export type SemanticValueOption = {
  id: string;
  label: string;
  /** Sample value or short description shown next to the label. */
  detail?: string;
  fragile?: boolean;
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
};

export function getTargetSection(target: SourceTargetDescriptor): SemanticTargetSection {
  if (target.kind === 'event') {
    return 'behavior';
  }
  if (target.kind === 'node') {
    return 'slots';
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
  return `nested:${descriptor.kind}:${locatorKey(descriptor.locator)}:${descriptor.propertyName ?? ''}`;
}

function isPropertyCompatible(
  target: SourceTargetDescriptor,
  property: FigmaPropertyDescriptor,
): boolean {
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
    return target.kind === 'node' && descriptor.connectedComponentName !== undefined;
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

/** Build the selectable design values for one code target, stable order. */
export function buildValueOptions(
  target: SourceTargetDescriptor,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  semanticSnapshot: FigmaSemanticSnapshot,
): SemanticValueOption[] {
  const options: SemanticValueOption[] = [];

  for (const property of figmaSnapshot?.properties ?? []) {
    if (isPropertyCompatible(target, property)) {
      options.push({
        id: propertyOptionId(property),
        label: property.name,
        detail: property.type === 'VARIANT'
          ? property.options.join(' · ')
          : property.type.toLowerCase(),
      });
    }
  }

  for (const descriptor of semanticSnapshot.nestedSources) {
    if (isNestedCompatible(target, descriptor)) {
      options.push({
        id: nestedOptionId(descriptor),
        label: descriptor.displayPath,
        ...(descriptor.sampleValue !== undefined ? { detail: descriptor.sampleValue } : {}),
        ...(descriptor.locator.fragile ? { fragile: true } : {}),
      });
    }
  }

  return options;
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
  if (target.kind === 'event') {
    return {
      optionId: OPTION_RUNTIME,
      reason: 'Callbacks are provided by application code.',
    };
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
  const existingByTarget = new Map(
    (existing?.bindings ?? []).map((binding) => [formatTargetPath(binding.target), binding]),
  );
  const bindings: SemanticBinding[] = [];

  for (const target of contract.targets) {
    const targetPath = target.path.join('.');
    const kept = existingByTarget.get(targetPath);
    if (kept) {
      bindings.push(kept);
      continue;
    }

    const suggestion = suggestOption(target, figmaSnapshot, semanticSnapshot);
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
  };
}

/** Apply one decision from the single value-selection control. */
export function setTargetOption(
  recipe: SemanticConnectionRecipe,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
  targetPath: readonly string[],
  optionId: string,
  staticValue?: SourcePropValue,
): SemanticConnectionRecipe {
  const target = recipe.sourceContract?.targets.find(
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

  return binding
    ? { ...recipe, bindings: [...remaining, binding] }
    : { ...recipe, bindings: remaining };
}

/** Read the active option id for a target back out of the recipe. */
export function getTargetOptionId(
  recipe: SemanticConnectionRecipe,
  target: SourceTargetDescriptor,
): { optionId: string; staticValue?: SourcePropValue } {
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
      return { optionId: `nested:nested-instance:${locatorKey(source.locator)}:` };
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
    requirement: target.kind === 'event'
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
    return target.required
      ? undefined
      : { ...base, source: { kind: 'omitted' } };
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
      return {
        ...base,
        source: {
          componentName: descriptor.connectedComponentName,
          importPath: descriptor.connectedImportPath,
          kind: 'instance',
          locator: descriptor.locator,
        },
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

/** Build the grouped row model the editor renders. */
export function buildTargetRows(
  recipe: SemanticConnectionRecipe,
  figmaSnapshot: FigmaComponentSnapshot | undefined,
): SemanticTargetRow[] {
  const contract = recipe.sourceContract;
  if (!contract) {
    return [];
  }

  const sectionOrder: SemanticTargetSection[] = [
    'content',
    'variants',
    'actions',
    'slots',
    'behavior',
    'excluded',
  ];

  const rows = contract.targets.map((target): SemanticTargetRow => {
    const { optionId, staticValue } = getTargetOptionId(recipe, target);
    const binding = recipe.bindings.find(
      (candidate) => formatTargetPath(candidate.target) === target.path.join('.'),
    );
    const valueMappings = buildValueMappings(binding, target, figmaSnapshot);

    return {
      optionId,
      options: buildValueOptions(target, figmaSnapshot, recipe.figmaSnapshot),
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
  const contract = recipe.sourceContract;
  let completed = 0;
  let total = 0;

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
        errors.push(`"${targetPath}" is required and cannot be omitted.`);
      } else {
        errors.push(`Map, set, or mark "${targetPath}" before saving — it is required.`);
      }
    }

    if (target.kind === 'event' && target.required && !binding) {
      errors.push(`Mark the required callback "${targetPath}" as set in application.`);
    }

    if (binding) {
      if (
        (binding.source.kind === 'nested-text' || binding.source.kind === 'nested-property')
        && binding.source.locator.fragile
      ) {
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
    warnings,
  };
}

/** True when confirmed bindings pull values from nested design regions. */
export function hasStructuralMismatch(recipe: SemanticConnectionRecipe): boolean {
  return recipe.bindings.some(
    (binding) => binding.source.kind === 'nested-text'
      || binding.source.kind === 'nested-property',
  );
}
