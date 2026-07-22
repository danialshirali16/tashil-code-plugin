import type { PropMappings } from './types';
import { isPropIdentifier, isPropMappings } from './codegen';

export type MergePropMappingsJsonResult =
  | { ok: true; value: string }
  | { message: string; ok: false; value: string };

const INVALID_PROP_MAPPINGS_MESSAGE = 'Fix the existing prop mappings JSON before scaffolding.';
const INVALID_SCAFFOLD_MESSAGE = 'Generated prop mappings are invalid. Rename the Figma variant properties or enter mappings manually.';

function copyToDictionary<T>(source: Readonly<Record<string, T>>): Record<string, T> {
  const dictionary = Object.create(null) as Record<string, T>;

  for (const [key, value] of Object.entries(source)) {
    dictionary[key] = value;
  }

  return dictionary;
}

function invalidPropMappings(currentValue: string): MergePropMappingsJsonResult {
  return {
    message: INVALID_PROP_MAPPINGS_MESSAGE,
    ok: false,
    value: currentValue,
  };
}

function invalidScaffold(currentValue: string): MergePropMappingsJsonResult {
  return {
    message: INVALID_SCAFFOLD_MESSAGE,
    ok: false,
    value: currentValue,
  };
}

function isDynamicInstanceSwapMapping(
  mapping: PropMappings[string][string] | undefined,
): boolean {
  return mapping?.value === '$instanceSwap';
}

/** Convert a Figma property label to a safe lower-camel React prop name. */
export function createReactPropIdentifier(figmaPropertyName: string): string | null {
  const words = figmaPropertyName
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .match(/[A-Za-z0-9]+/g);

  if (!words || words.length === 0) {
    return null;
  }

  const identifier = words.map((word, index) => {
    const lowercaseWord = word.toLowerCase();
    if (index === 0) {
      return lowercaseWord;
    }
    return `${lowercaseWord[0].toUpperCase()}${lowercaseWord.slice(1)}`;
  }).join('');
  const safeIdentifier = /^[0-9]/.test(identifier) ? `_${identifier}` : identifier;

  return isPropIdentifier(safeIdentifier) ? safeIdentifier : null;
}

/**
 * Merge scaffolded mappings into the JSON currently shown in the form.
 * Existing groups and options win so manual edits are never overwritten.
 */
export function mergePropMappingsJson(
  currentValue: string,
  incoming: PropMappings,
): MergePropMappingsJsonResult {
  let existing: PropMappings;

  try {
    const parsed: unknown = currentValue.trim() === ''
      ? {}
      : JSON.parse(currentValue);

    if (!isPropMappings(parsed)) {
      return invalidPropMappings(currentValue);
    }

    existing = parsed;
  } catch (_error) {
    return invalidPropMappings(currentValue);
  }

  if (!isPropMappings(incoming)) {
    return invalidScaffold(currentValue);
  }

  const merged = Object.create(null) as PropMappings;

  for (const [groupName, incomingGroup] of Object.entries(incoming)) {
    merged[groupName] = copyToDictionary(incomingGroup);
  }

  for (const [groupName, existingGroup] of Object.entries(existing)) {
    const mergedGroup = merged[groupName]
      ?? (Object.create(null) as PropMappings[string]);

    for (const [optionName, mapping] of Object.entries(existingGroup)) {
      if (
        optionName === '*'
        && isDynamicInstanceSwapMapping(mapping)
        && isDynamicInstanceSwapMapping(mergedGroup[optionName])
      ) {
        continue;
      }
      mergedGroup[optionName] = mapping;
    }

    merged[groupName] = mergedGroup;
  }

  if (!isPropMappings(merged)) {
    return invalidScaffold(currentValue);
  }

  return {
    ok: true,
    value: JSON.stringify(merged, null, 2),
  };
}
