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

  const matrix = figmaSnapshot
    ? buildVariantMatrix(figmaSnapshot.properties.filter((p) => p.type === 'VARIANT'))
    : undefined;

  const defaultSampleCode = sampleUsageCode ?? [
    `import { ${componentName} } from "${metadata.importPath}";`,
    '',
    `<${componentName} />`,
  ].join('\n');

  const contentHash = computeComponentDocHash(metadata, sourceSnapshot, figmaSnapshot, matrix);

  return {
    componentName,
    contentHash,
    description,
    figmaComponentName,
    importPath: metadata.importPath,
    lifecycle: metadata.semanticRecipe?.lifecycle?.state,
    matrix,
    props,
    runtimeRequirements,
    sampleUsageCode: defaultSampleCode,
    storybookUrl: metadata.storybookUrl,
    variants,
  };
}

export function buildVariantMatrix(
  variantProps: FigmaComponentSnapshot['properties'],
): ComponentDocDocument['matrix'] {
  if (!variantProps || variantProps.length === 0) return undefined;

  const yPropIndex = variantProps.findIndex((p) =>
    /intent|variant|kind|color|theme/i.test(p.name),
  );
  const primaryYIndex = yPropIndex >= 0 ? yPropIndex : 0;
  const primaryYProp = variantProps[primaryYIndex];

  const remainingProps = variantProps.filter((_, idx) => idx !== primaryYIndex);
  if (remainingProps.length === 0) {
    const xAxis = {
      propertyName: primaryYProp.name,
      values: primaryYProp.options.length > 0 ? primaryYProp.options : ['default'],
    };
    const yAxis = {
      propertyName: 'Variant',
      values: ['All'],
    };
    const rows = [
      {
        cells: xAxis.values.map((v) => ({
          combination: { [primaryYProp.name]: v },
          title: `${primaryYProp.name}=${v}`,
        })),
        rowHeader: { propertyName: 'Variant', value: 'All' },
      },
    ];
    return {
      columnHeaders: xAxis.values.map((v) => ({ propertyName: primaryYProp.name, value: v })),
      primaryXAxis: xAxis,
      primaryYAxis: yAxis,
      rows,
    };
  }

  const xPropIndex = remainingProps.findIndex((p) =>
    /style|appearance|type|hierarchy/i.test(p.name),
  );
  const primaryXIndex = xPropIndex >= 0 ? xPropIndex : 0;
  const primaryXProp = remainingProps[primaryXIndex];
  const secondaryXProps = remainingProps.filter((_, idx) => idx !== primaryXIndex);

  const primaryXAxis = {
    propertyName: primaryXProp.name,
    values: primaryXProp.options.length > 0 ? primaryXProp.options : ['default'],
  };

  const primaryYAxis = {
    propertyName: primaryYProp.name,
    values: primaryYProp.options.length > 0 ? primaryYProp.options : ['default'],
  };

  const secondaryXAxes = secondaryXProps.map((p) => ({
    propertyName: p.name,
    values: p.options.length > 0 ? p.options : ['default'],
  }));

  const xCombinations: Array<Record<string, string>> = [];
  function recurseX(current: Record<string, string>, propIndex: number) {
    if (propIndex >= secondaryXProps.length) {
      xCombinations.push(current);
      return;
    }
    const prop = secondaryXProps[propIndex];
    const opts = prop.options.length > 0 ? prop.options : ['default'];
    for (const opt of opts) {
      recurseX({ ...current, [prop.name]: opt }, propIndex + 1);
    }
  }

  for (const xVal of primaryXAxis.values) {
    if (secondaryXProps.length === 0) {
      xCombinations.push({ [primaryXProp.name]: xVal });
    } else {
      recurseX({ [primaryXProp.name]: xVal }, 0);
    }
  }

  const cappedXCombos = xCombinations.slice(0, 24);

  const columnHeaders = cappedXCombos.map((combo) => {
    const mainVal = combo[primaryXProp.name] ?? '';
    const subParts = Object.entries(combo)
      .filter(([k]) => k !== primaryXProp.name)
      .map(([k, v]) => `${k.toLowerCase()}: ${v}`)
      .join(' • ');
    return {
      propertyName: primaryXProp.name,
      value: subParts ? `${mainVal} • ${subParts}` : mainVal,
    };
  });

  const rows = primaryYAxis.values.map((yVal) => {
    const cells = cappedXCombos.map((xCombo) => {
      const fullCombo = { [primaryYProp.name]: yVal, ...xCombo };
      const title = Object.entries(fullCombo).map(([k, v]) => `${k}=${v}`).join(', ');
      return {
        combination: fullCombo,
        title,
      };
    });
    return {
      cells,
      rowHeader: { propertyName: primaryYProp.name, value: yVal },
    };
  });

  return {
    columnHeaders,
    primaryXAxis,
    primaryYAxis,
    rows,
    secondaryXAxes: secondaryXAxes.length > 0 ? secondaryXAxes : undefined,
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
  matrix?: ComponentDocDocument['matrix'],
): string {
  const parts: string[] = [
    metadata.componentName,
    metadata.importPath,
    sourceSnapshot?.contentHash ?? '',
    figmaSnapshot?.properties.map((p) => `${p.name}:${p.type}:${p.options.join(',')}`).join(';') ?? '',
    matrix ? `${matrix.primaryXAxis.propertyName}:${matrix.primaryYAxis.propertyName}:${matrix.rows.length}` : '',
  ];
  let hash = 5381;
  const content = parts.join('|');
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
