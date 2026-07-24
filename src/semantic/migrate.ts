/**
 * Migration between the schema-v4 `MappingDocument` world and semantic
 * recipes, in both directions:
 *
 * - `migrateMappingDocumentToRecipe` lifts existing visual property mappings
 *   into equivalent direct component-property bindings so a v4 connection can
 *   be opened in the semantic editor without re-authoring.
 * - `compileRecipeToPropMappings` lowers the simple subset back to the legacy
 *   `PropMappings` JSON so `createUsageSnippet` output stays byte-for-byte
 *   stable during the compatibility period. Bindings that need nested values
 *   or object assembly are not compiled; they resolve through the usage IR.
 *
 * Neither direction deletes anything: unsupported legacy mappings are
 * reported, never dropped from the document they came from.
 */

import type { MappingDocument, PropMappings, PropMapping } from '../types';
import {
  SEMANTIC_RECIPE_SCHEMA_VERSION,
  type SemanticBinding,
  type SemanticConnectionRecipe,
} from './types';

export type MigrateMappingDocumentResult = {
  recipe: SemanticConnectionRecipe;
  /** Legacy mappings the semantic model does not lift yet (children, swaps). */
  skipped: Array<{ figmaPropertyName: string; reason: string }>;
};

export function migrateMappingDocumentToRecipe(
  document: MappingDocument,
): MigrateMappingDocumentResult {
  const bindings: SemanticBinding[] = [];
  const skipped: MigrateMappingDocumentResult['skipped'] = [];
  const sourceProps = new Map(
    (document.sourceSnapshot?.props ?? []).map((prop) => [prop.name, prop]),
  );

  for (const mapping of document.mappings) {
    const kind = mapping.kind ?? 'property';

    if (kind !== 'property') {
      skipped.push({
        figmaPropertyName: mapping.figmaPropertyName,
        reason: `Legacy ${kind} mappings stay on the compatibility pipeline.`,
      });
      continue;
    }

    const sourceProp = sourceProps.get(mapping.sourceProp);
    const map: Record<string, string | number | boolean> = {};
    for (const value of mapping.values) {
      map[value.figmaValue] = value.sourceValue;
    }

    bindings.push({
      id: `legacy:${mapping.figmaPropertyId}:${mapping.sourceProp}`,
      requirement: 'optional',
      source: {
        kind: 'component-property',
        propertyId: mapping.figmaPropertyId,
        propertyName: mapping.figmaPropertyName,
      },
      target: {
        path: [mapping.sourceProp],
        typeName: sourceProp?.typeName ?? 'unknown',
      },
      transform: { kind: 'enum', map },
    });
  }

  return {
    recipe: {
      bindings,
      figmaSnapshot: {
        componentId: document.figmaSnapshot.componentId,
        componentName: document.figmaSnapshot.componentName,
        nestedSources: [],
      },
      revision: document.revision,
      schemaVersion: SEMANTIC_RECIPE_SCHEMA_VERSION,
      ...(document.lastValidatedAt !== undefined
        ? { lastValidatedAt: document.lastValidatedAt }
        : {}),
    },
    skipped,
  };
}

/**
 * Lower the simple subset (direct component-property bindings with enum
 * transforms and single-segment targets) to legacy `PropMappings`. Returns
 * the compiled table plus the bindings that could not be lowered.
 */
export function compileRecipeToPropMappings(
  recipe: SemanticConnectionRecipe,
): { propMappings: PropMappings; uncompiled: SemanticBinding[] } {
  const propMappings: PropMappings = Object.create(null) as PropMappings;
  const uncompiled: SemanticBinding[] = [];

  for (const binding of recipe.bindings) {
    if (
      binding.source.kind !== 'component-property'
      || binding.transform?.kind !== 'enum'
      || binding.target.path.length !== 1
    ) {
      uncompiled.push(binding);
      continue;
    }

    const group = propMappings[binding.source.propertyName]
      ?? (Object.create(null) as Record<string, PropMapping>);
    for (const [figmaValue, sourceValue] of Object.entries(binding.transform.map)) {
      group[figmaValue] = {
        prop: binding.target.path[0],
        value: sourceValue,
      };
    }
    propMappings[binding.source.propertyName] = group;
  }

  return { propMappings, uncompiled };
}
