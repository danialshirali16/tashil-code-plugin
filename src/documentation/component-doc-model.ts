/**
 * Pure builder for Component Documentation documents (IR).
 *
 * Combines source-code props contracts, Figma component snapshots, and connection
 * metadata into structured component specification models.
 */

import type {
  ConnectionMetadata,
  FigmaComponentSnapshot,
  FigmaPropertyDescriptor,
  SourceComponentSnapshot,
} from '../types';
import type {
  ComponentDocDocument,
  ComponentDocMatrixTier,
  ComponentDocMatrixTierGroup,
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

  const onlyVariantProps = variantProps.filter(
    (p) => p.type === 'VARIANT' && p.options && p.options.length > 0,
  );
  if (onlyVariantProps.length === 0) return undefined;

  if (onlyVariantProps.length === 1) {
    const prop = onlyVariantProps[0];
    const xAxis = {
      propertyName: prop.name,
      values: prop.options,
    };
    const yAxis = {
      propertyName: prop.name,
      values: ['All'],
    };
    return {
      columnHeaders: prop.options.map((v) => ({
        propertyName: prop.name,
        value: `${prop.name.toLowerCase()}: ${v}`,
      })),
      primaryXAxis: xAxis,
      primaryYAxis: yAxis,
      rows: [
        {
          cells: prop.options.map((v) => ({
            combination: { [prop.name]: v },
            title: `${prop.name}=${v}`,
          })),
          rowHeader: { propertyName: prop.name, value: 'All' },
        },
      ],
    };
  }

  // Partition properties into Y-axis (vertical) and X-axis (horizontal)
  const isYCandidate = (name: string) =>
    /intent|variant|kind|color|theme|state|status|disabled/i.test(name);
  const isXCandidate = (name: string) =>
    /style|appearance|type|hierarchy|size|isOnlyIcon|icon|select/i.test(name);

  const yProps: FigmaPropertyDescriptor[] = [];
  const xProps: FigmaPropertyDescriptor[] = [];

  for (const prop of onlyVariantProps) {
    if (isYCandidate(prop.name) && !isXCandidate(prop.name)) {
      yProps.push(prop);
    } else if (isXCandidate(prop.name) && !isYCandidate(prop.name)) {
      xProps.push(prop);
    }
  }

  // Handle remaining / unclassified properties
  const assigned = new Set([...yProps, ...xProps].map((p) => p.name));
  const unassigned = onlyVariantProps.filter((p) => !assigned.has(p.name));

  for (const prop of unassigned) {
    const yCount = yProps.reduce((acc, p) => acc * Math.max(1, p.options.length), 1);
    const xCount = xProps.reduce((acc, p) => acc * Math.max(1, p.options.length), 1);
    if (yCount <= xCount) {
      yProps.push(prop);
    } else {
      xProps.push(prop);
    }
  }

  // Ensure neither axis is empty
  if (yProps.length === 0 && xProps.length > 1) {
    yProps.push(xProps.shift()!);
  } else if (xProps.length === 0 && yProps.length > 1) {
    xProps.push(yProps.pop()!);
  }

  // Generate Cartesian Product for Y
  const yCombinations: Array<Record<string, string>> = [];
  function recurseY(current: Record<string, string>, index: number) {
    if (index >= yProps.length) {
      yCombinations.push(current);
      return;
    }
    const prop = yProps[index];
    for (const opt of prop.options) {
      recurseY({ ...current, [prop.name]: opt }, index + 1);
    }
  }
  recurseY({}, 0);

  // Generate Cartesian Product for X
  const xCombinations: Array<Record<string, string>> = [];
  function recurseX(current: Record<string, string>, index: number) {
    if (index >= xProps.length) {
      xCombinations.push(current);
      return;
    }
    const prop = xProps[index];
    for (const opt of prop.options) {
      recurseX({ ...current, [prop.name]: opt }, index + 1);
    }
  }
  recurseX({}, 0);

  const columnHeaders = xCombinations.map((combo) => {
    const formatted = Object.entries(combo)
      .map(([k, v]) => `${k.toLowerCase()}: ${v}`)
      .join(' • ');
    return {
      propertyName: xProps.map((p) => p.name).join(', '),
      value: formatted,
    };
  });

  const rows = yCombinations.map((yCombo) => {
    const rowTitle = Object.entries(yCombo)
      .map(([k, v]) => `${k.toLowerCase()}: ${v}`)
      .join(' • ');
    const cells = xCombinations.map((xCombo) => {
      const fullCombo = { ...yCombo, ...xCombo };
      const title = Object.entries(fullCombo)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return {
        combination: fullCombo,
        title,
      };
    });
    return {
      cells,
      rowHeader: {
        propertyName: yProps.map((p) => p.name).join(', '),
        value: rowTitle,
      },
    };
  });

  const xTiers = buildTiers(xProps, false);
  const yTiers = buildTiers(yProps, true);

  return {
    columnHeaders,
    primaryXAxis: {
      propertyName: xProps.map((p) => p.name).join(', '),
      values: xCombinations.map((c) => Object.values(c).join(', ')),
    },
    primaryYAxis: {
      propertyName: yProps.map((p) => p.name).join(', '),
      values: yCombinations.map((c) => Object.values(c).join(', ')),
    },
    rows,
    xTiers,
    yTiers,
  };
}

export function buildTiers(
  props: FigmaPropertyDescriptor[],
  isVertical: boolean,
): ComponentDocMatrixTier[] {
  if (props.length === 0) return [];

  const tiers: ComponentDocMatrixTier[] = [];

  for (let t = 0; t < props.length; t++) {
    const prop = props[t];
    const isLeaf = t === props.length - 1;
    const isBoolean =
      /is[A-Z]|has[A-Z]|icon|only/i.test(prop.name) ||
      (prop.options.length === 2 &&
        prop.options.some((o) => /^(false|true|no|yes)$/i.test(o)));

    let span = 1;
    for (let after = t + 1; after < props.length; after++) {
      span *= props[after].options.length;
    }

    let outerReps = 1;
    for (let before = 0; before < t; before++) {
      outerReps *= props[before].options.length;
    }

    const groups: ComponentDocMatrixTierGroup[] = [];
    let currentIndex = 0;

    for (let r = 0; r < outerReps; r++) {
      for (const opt of prop.options) {
        let label: string;
        if (isBoolean && isLeaf) {
          if (/^(false|no)$/i.test(opt)) {
            label = '-';
          } else {
            label = prop.name;
          }
        } else if (isLeaf && !isVertical && props.length > 1) {
          label = opt;
        } else {
          label = `${prop.name.toLowerCase()}: ${opt}`;
        }

        groups.push({
          ...(isVertical ? { rowStart: currentIndex } : { colStart: currentIndex }),
          label,
          propertyName: prop.name,
          span,
          value: opt,
        });

        currentIndex += span;
      }
    }

    tiers.push({
      groups,
      propertyName: prop.name,
    });
  }

  return tiers;
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
