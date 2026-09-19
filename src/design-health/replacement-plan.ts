import type {
  CompatibilityPlan,
  PropertyCompatibility,
} from './types';

export interface ComponentPropertyDescriptor {
  name: string;
  type: string; // 'VARIANT' | 'TEXT' | 'BOOLEAN' | 'INSTANCE_SWAP'
  variantOptions?: string[];
  defaultValue?: string | boolean;
}

export interface ComponentDescriptor {
  key: string;
  name: string;
  properties: ComponentPropertyDescriptor[];
}

export function normalizePropertyName(rawName: string): string {
  if (!rawName) return '';
  const hashIndex = rawName.indexOf('#');
  const cleanName = hashIndex !== -1 ? rawName.slice(0, hashIndex) : rawName;
  return cleanName.trim();
}

export function buildCompatibilityPlan(params: {
  sourceComponent: ComponentDescriptor;
  targetComponent: ComponentDescriptor;
  instancesCount: number;
}): CompatibilityPlan {
  const { sourceComponent, targetComponent, instancesCount } = params;

  const targetPropertiesByNormalized = new Map<string, ComponentPropertyDescriptor>();
  for (const prop of targetComponent.properties) {
    const norm = normalizePropertyName(prop.name).toLowerCase();
    targetPropertiesByNormalized.set(norm, prop);
  }

  const propertyCompatibilities: PropertyCompatibility[] = [];
  let preservedCount = 0;
  let needsReviewCount = 0;
  let atRiskCount = 0;

  for (const sourceProp of sourceComponent.properties) {
    const rawName = sourceProp.name;
    const normalized = normalizePropertyName(rawName);
    const targetMatch = targetPropertiesByNormalized.get(normalized.toLowerCase())
      ?? findFuzzyPropertyMatch(normalized, targetPropertiesByNormalized);

    if (!targetMatch) {
      propertyCompatibilities.push({
        name: rawName,
        normalizedName: normalized,
        sourceType: sourceProp.type,
        status: 'unmapped',
        details: `Property "${normalized}" not found on target component`,
      });
      atRiskCount++;
      continue;
    }

    // Compare types
    if (sourceProp.type !== targetMatch.type) {
      propertyCompatibilities.push({
        name: rawName,
        normalizedName: normalized,
        sourceType: sourceProp.type,
        targetType: targetMatch.type,
        targetName: normalizePropertyName(targetMatch.name),
        status: 'needs-review',
        details: `Type mismatch: source is ${sourceProp.type}, target is ${targetMatch.type}`,
      });
      needsReviewCount++;
      continue;
    }

    // Compare Variant Options if applicable
    if (sourceProp.type === 'VARIANT' && sourceProp.variantOptions && targetMatch.variantOptions) {
      const targetOptionsLower = new Set(targetMatch.variantOptions.map((o) => o.trim().toLowerCase()));
      const missingInTarget = sourceProp.variantOptions.filter(
        (opt) => !targetOptionsLower.has(opt.trim().toLowerCase()),
      );

      if (missingInTarget.length > 0) {
        propertyCompatibilities.push({
          name: rawName,
          normalizedName: normalized,
          sourceType: sourceProp.type,
          targetType: targetMatch.type,
          targetName: normalizePropertyName(targetMatch.name),
          status: 'needs-review',
          details: `Options missing in target: ${missingInTarget.join(', ')}`,
        });
        needsReviewCount++;
        continue;
      }
    }

    // Preserved!
    propertyCompatibilities.push({
      name: rawName,
      normalizedName: normalized,
      sourceType: sourceProp.type,
      targetType: targetMatch.type,
      targetName: normalizePropertyName(targetMatch.name),
      status: 'preserved',
      details: 'Preserved with matching type and options',
    });
    preservedCount++;
  }

  return {
    sourceComponentKey: sourceComponent.key,
    sourceComponentName: sourceComponent.name,
    targetComponentKey: targetComponent.key,
    targetComponentName: targetComponent.name,
    instancesCount,
    properties: propertyCompatibilities,
    preservedCount,
    needsReviewCount,
    atRiskCount,
    canAutoMigrate: needsReviewCount === 0 && atRiskCount === 0,
  };
}

function findFuzzyPropertyMatch(
  normalized: string,
  targetMap: Map<string, ComponentPropertyDescriptor>,
): ComponentPropertyDescriptor | undefined {
  const normLower = normalized.toLowerCase();

  // Common UI Aliases
  const commonAliases: Record<string, string[]> = {
    label: ['children', 'text', 'content', 'title'],
    children: ['label', 'text', 'content'],
    type: ['variant', 'kind', 'intent'],
    variant: ['type', 'kind', 'intent'],
    size: ['scale', 'dimension'],
    icon: ['leadingicon', 'starticon', 'trailingicon'],
  };

  const aliases = commonAliases[normLower];
  if (aliases) {
    for (const alias of aliases) {
      const found = targetMap.get(alias);
      if (found) return found;
    }
  }

  return undefined;
}
