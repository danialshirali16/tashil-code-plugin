import type { PropMappings } from './types';

export type MergePropMappingsJsonResult =
  | { ok: true; value: string }
  | { message: string; ok: false; value: string };

const INVALID_PROP_MAPPINGS_MESSAGE = 'Fix the existing prop mappings JSON before scaffolding.';

function invalidPropMappings(currentValue: string): MergePropMappingsJsonResult {
  return {
    message: INVALID_PROP_MAPPINGS_MESSAGE,
    ok: false,
    value: currentValue,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

    if (!isRecord(parsed) || Object.values(parsed).some((group) => !isRecord(group))) {
      return invalidPropMappings(currentValue);
    }

    existing = parsed as PropMappings;
  } catch (_error) {
    return invalidPropMappings(currentValue);
  }

  const merged: PropMappings = { ...incoming };

  for (const [groupName, existingGroup] of Object.entries(existing)) {
    merged[groupName] = {
      ...incoming[groupName],
      ...existingGroup,
    };
  }

  return {
    ok: true,
    value: JSON.stringify(merged, null, 2),
  };
}
