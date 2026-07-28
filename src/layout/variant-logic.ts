import { toComponentName } from './naming';

type VariantDefinition = {
  defaultValue: string | boolean;
  type: string;
  variantOptions?: readonly string[];
};

type VariantNode = {
  type: string;
  variantProperties?: Readonly<Record<string, string>> | null;
};

export type VariantLogicSource = {
  children?: readonly VariantNode[];
  componentPropertyDefinitions?: Readonly<Record<string, VariantDefinition>>;
  name: string;
};

export type VariantLogicResult = {
  axisCount: number;
  code: string;
  combinationCount: number;
};

type VariantAxis = {
  defaultValue: string;
  figmaName: string;
  propName: string;
  values: string[];
};

/** Generate typed, executable selection logic for a Figma component set. */
export function generateVariantLogic(
  source: VariantLogicSource,
  selectedValues: Readonly<Record<string, string | boolean>> = {},
): VariantLogicResult | undefined {
  const definitions = source.componentPropertyDefinitions ?? {};
  const variants = (source.children ?? [])
    .filter((child) => child.type === 'COMPONENT' && child.variantProperties)
    .map((child) => child.variantProperties as Readonly<Record<string, string>>);
  const axes = collectAxes(definitions, variants, selectedValues);

  if (axes.length === 0) {
    return undefined;
  }

  const combinations = deduplicateCombinations(
    variants
      .map((variant) => createCombination(axes, variant))
      .filter((combination): combination is Record<string, string> => combination !== null),
  );
  const componentName = toComponentName(source.name);
  const propsType = `${componentName}VariantProps`;
  const defaultsName = `${lowerFirst(componentName)}VariantDefaults`;
  const matrixName = `${lowerFirst(componentName)}VariantMatrix`;
  const resolverName = `resolve${componentName}Variant`;
  const matchExpression = axes
    .map((axis) => `candidate.${axis.propName} === resolved.${axis.propName}`)
    .join('\n      && ');
  const lines = [
    `export type ${propsType} = {`,
    ...axes.map((axis) => (
      `  ${axis.propName}?: ${axis.values.map(quote).join(' | ')};`
    )),
    '};',
    '',
    `export const ${defaultsName}: Required<${propsType}> = {`,
    ...axes.map((axis) => `  ${axis.propName}: ${quote(axis.defaultValue)},`),
    '};',
    '',
    `export const ${matrixName} = [`,
    ...combinations.map((combination) => [
      '  {',
      ...axes.map((axis) => `    ${axis.propName}: ${quote(combination[axis.propName])},`),
      '  },',
    ].join('\n')),
    `] as const satisfies ReadonlyArray<Required<${propsType}>>;`,
    '',
    `export function ${resolverName}(`,
    `  input: ${propsType} = {},`,
    `): Required<${propsType}> | undefined {`,
    `  const resolved = { ...${defaultsName}, ...input };`,
    '',
    `  return ${matrixName}.find((candidate) => (`,
    `    ${matchExpression}`,
    '  ));',
    '}',
  ];

  return {
    axisCount: axes.length,
    code: lines.join('\n'),
    combinationCount: combinations.length,
  };
}

function collectAxes(
  definitions: Readonly<Record<string, VariantDefinition>>,
  variants: ReadonlyArray<Readonly<Record<string, string>>>,
  selectedValues: Readonly<Record<string, string | boolean>>,
): VariantAxis[] {
  const figmaNames = new Set<string>();
  for (const [name, definition] of Object.entries(definitions)) {
    if (definition.type === 'VARIANT') {
      figmaNames.add(name);
    }
  }
  for (const variant of variants) {
    for (const name of Object.keys(variant)) {
      figmaNames.add(name);
    }
  }

  const usedPropNames = new Set<string>();
  return Array.from(figmaNames, (figmaName) => {
    const definition = definitions[figmaName];
    const values = unique([
      ...(definition?.variantOptions ?? []),
      ...variants.map((variant) => variant[figmaName]).filter(isString),
    ]);
    const selectedValue = selectedValues[figmaName];
    const defaultValue = typeof selectedValue === 'string'
      ? selectedValue
      : typeof definition?.defaultValue === 'string'
        ? definition.defaultValue
        : values[0] ?? '';
    if (!values.includes(defaultValue)) {
      values.unshift(defaultValue);
    }

    return {
      defaultValue,
      figmaName,
      propName: uniquePropName(figmaName, usedPropNames),
      values,
    };
  }).filter((axis) => axis.values.length > 0);
}

function createCombination(
  axes: readonly VariantAxis[],
  variant: Readonly<Record<string, string>>,
): Record<string, string> | null {
  const combination: Record<string, string> = {};
  for (const axis of axes) {
    const value = variant[axis.figmaName];
    if (typeof value !== 'string') {
      return null;
    }
    combination[axis.propName] = value;
  }
  return combination;
}

function deduplicateCombinations(
  combinations: ReadonlyArray<Record<string, string>>,
): Record<string, string>[] {
  const seen = new Set<string>();
  return combinations.filter((combination) => {
    const key = JSON.stringify(combination);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function uniquePropName(name: string, used: Set<string>): string {
  const componentName = toComponentName(name.replace(/#.*$/, ''));
  const base = legalIdentifier(lowerFirst(componentName));
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function legalIdentifier(value: string): string {
  const candidate = value.replace(/[^A-Za-z0-9_$]/g, '');
  if (/^[A-Za-z_$]/.test(candidate)) {
    return candidate;
  }
  return `variant${candidate}`;
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0].toLowerCase() + value.slice(1);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values));
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string';
}
