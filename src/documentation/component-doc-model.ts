/**
 * Pure builder for Component Documentation documents (IR).
 *
 * Combines source-code props contracts, Figma component snapshots, and connection
 * metadata into structured component specification models.
 */

import type {
  ConnectionMetadata,
  FigmaComponentSnapshot,
  SourceComponentSnapshot,
} from '../types';
import type {
  ComponentDocDocument,
  ComponentDocProp,
  ComponentDocVariant,
} from './types';

export function buildComponentDocDocument(
  metadata: ConnectionMetadata,
  sourceSnapshot?: SourceComponentSnapshot,
  figmaSnapshot?: FigmaComponentSnapshot,
  sampleUsageCode?: string,
): ComponentDocDocument {
  const componentName = metadata.componentName;
  const figmaComponentName = metadata.figmaComponentName ?? metadata.componentName;
  const description = sourceSnapshot?.description
    ?? figmaSnapshot?.description
    ?? `Production documentation for <${componentName}>.`;

  const props: ComponentDocProp[] = [];
  const mappedFigmaByProp = new Map<string, string>();

  if (metadata.mappingDocument) {
    for (const mapping of metadata.mappingDocument.mappings) {
      mappedFigmaByProp.set(mapping.sourceProp, mapping.figmaPropertyName);
    }
  }

  if (sourceSnapshot) {
    for (const prop of sourceSnapshot.props) {
      props.push({
        defaultValue: prop.defaultValue,
        description: prop.description,
        mappedFigmaProperty: mappedFigmaByProp.get(prop.name),
        name: prop.name,
        required: prop.required,
        role: prop.role,
        typeName: prop.typeName,
        values: prop.values ? [...prop.values] : undefined,
      });
    }
  } else if (figmaSnapshot) {
    for (const prop of figmaSnapshot.properties) {
      props.push({
        defaultValue: prop.defaultValue,
        mappedFigmaProperty: prop.name,
        name: prop.name,
        required: false,
        role: 'figma-only',
        typeName: prop.type.toLowerCase(),
        values: prop.options.length > 0 ? prop.options : undefined,
      });
    }
  }

  props.sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const variants: ComponentDocVariant[] = [];
  if (figmaSnapshot) {
    const variantProps = figmaSnapshot.properties.filter((p) => p.type === 'VARIANT');
    if (variantProps.length > 0) {
      const combinations = generateCombinations(variantProps);
      for (const combo of combinations.slice(0, 32)) {
        const title = Object.entries(combo).map(([k, v]) => `${k}=${v}`).join(', ');
        variants.push({ combination: combo, title });
      }
    }
  }

  const runtimeRequirements: string[] = [];
  if (metadata.semanticRecipe) {
    for (const b of metadata.semanticRecipe.bindings) {
      if (b.requirement === 'runtime' || b.source.kind === 'runtime') {
        runtimeRequirements.push(b.target.path.join('.'));
      }
    }
  }

  const defaultSampleCode = sampleUsageCode ?? [
    `import { ${componentName} } from "${metadata.importPath}";`,
    '',
    `<${componentName} />`,
  ].join('\n');

  const contentHash = computeComponentDocHash(metadata, sourceSnapshot, figmaSnapshot);

  return {
    componentName,
    contentHash,
    description,
    figmaComponentName,
    importPath: metadata.importPath,
    lifecycle: metadata.semanticRecipe?.lifecycle?.state,
    props,
    runtimeRequirements,
    sampleUsageCode: defaultSampleCode,
    storybookUrl: metadata.storybookUrl,
    variants,
  };
}

function generateCombinations(
  props: FigmaComponentSnapshot['properties'],
): Array<Record<string, string>> {
  if (props.length === 0) return [{}];
  const [first, ...rest] = props;
  const restCombinations = generateCombinations(rest);
  const results: Array<Record<string, string>> = [];
  for (const option of first.options) {
    for (const restCombo of restCombinations) {
      results.push({ [first.name]: option, ...restCombo });
    }
  }
  return results;
}

function computeComponentDocHash(
  metadata: ConnectionMetadata,
  sourceSnapshot?: SourceComponentSnapshot,
  figmaSnapshot?: FigmaComponentSnapshot,
): string {
  const parts: string[] = [
    metadata.componentName,
    metadata.importPath,
    sourceSnapshot?.contentHash ?? '',
    figmaSnapshot?.properties.map((p) => `${p.name}:${p.type}:${p.options.join(',')}`).join(';') ?? '',
  ];
  let hash = 5381;
  const content = parts.join('|');
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
