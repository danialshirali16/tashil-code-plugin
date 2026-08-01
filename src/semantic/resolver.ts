/**
 * Semantic resolver: recipe + live design values → typed component usage.
 *
 * Resolves every binding to a structured {@link UsageValue}, assembles nested
 * object props from separately bound leaves, and only then formats JSX. Each
 * emitted or omitted target carries a structured explanation, and runtime
 * requirements are listed separately so they never read as mapping errors.
 *
 * One resolution path feeds Dev Mode, Inspect Code, and Layout Composer; the
 * result is a plain {@link ComponentUsage} so the connected component remains
 * one atomic node in layout generation.
 */

import type { ComponentUsage } from '../layout/types';
import { createIconName, createOpeningTag, createSelfClosingTag } from '../codegen';
import type { SourcePropValue } from '../types';
import { getAcceptedComponentNames } from './component-compatibility';
import { resolveLocator, type SemanticNodeLike } from './figma-extractor';
import type { SourceTargetDescriptor } from './source-contract';
import { formatUsageChildren, formatUsageProp, type UsageValue } from './usage-ir';
import {
  formatTargetPath,
  locatorKey,
  SEMANTIC_LIMITS,
  type FigmaSemanticSnapshot,
  type ConnectedInstanceItem,
  type SemanticBinding,
  type SemanticConnectionRecipe,
  type SemanticLocator,
  type SemanticTransform,
} from './types';

export type SemanticDesignInput = {
  /** Top-level component property values of the selected instance. */
  componentProperties: Readonly<Record<string, string | boolean>>;
  /** Resolved component identities for top-level INSTANCE_SWAP properties. */
  instanceSwaps?: Readonly<Record<string, { componentId: string; componentName: string }>>;
  /** Instance subtree for nested locator resolution; omit in tests without one. */
  root?: SemanticNodeLike;
  /**
   * Fallback nested values for authoring previews: when no live subtree is
   * available, nested sources resolve from the snapshot's captured samples.
   */
  samples?: FigmaSemanticSnapshot;
};

export type SemanticTargetExplanation = {
  targetPath: string;
  outcome: 'emitted' | 'omitted' | 'runtime' | 'unresolved';
  reason: string;
};

export type SemanticRuntimeRequirement = {
  placeholder: string;
  targetPath: string;
  typeName: string;
  note?: string;
};

export type SemanticUsageResult = {
  usage: ComponentUsage;
  explanations: SemanticTargetExplanation[];
  runtimeRequirements: SemanticRuntimeRequirement[];
  /** Human-readable problems (broken locators, missing required values). */
  issues: string[];
  /** Deprecation notice when the recipe is marked deprecated; never blocks code. */
  deprecation?: string;
};

type ResolvedBinding =
  | { status: 'value'; value: UsageValue; nestedResults?: SemanticUsageResult[] }
  | { status: 'omitted'; reason: string }
  | { status: 'unresolved'; reason: string };

export function resolveSemanticUsage(
  componentName: string,
  importPath: string,
  recipe: SemanticConnectionRecipe,
  design: SemanticDesignInput,
): SemanticUsageResult {
  return resolveSemanticUsageInternal(componentName, importPath, recipe, design, {
    depth: 0,
    runtimePlaceholders: new Set<string>(),
  });
}

type ResolutionContext = {
  depth: number;
  runtimePlaceholders: Set<string>;
};

function resolveSemanticUsageInternal(
  componentName: string,
  importPath: string,
  recipe: SemanticConnectionRecipe,
  design: SemanticDesignInput,
  context: ResolutionContext,
): SemanticUsageResult {
  const explanations: SemanticTargetExplanation[] = [];
  const runtimeRequirements: SemanticRuntimeRequirement[] = [];
  const issues: string[] = [];
  const nestedImports: ComponentUsage['imports'] = [];

  /** Top-level prop name → assembled value, in binding order. */
  const assembled = new Map<string, UsageValue>();

  for (const binding of recipe.bindings) {
    const targetPath = formatTargetPath(binding.target);

    // The source is the author's decision; the requirement only describes the
    // target. An explicit "leave out" therefore beats the runtime requirement
    // an event prop carries by default, or the prop would be emitted anyway.
    if (binding.source.kind === 'omitted') {
      explanations.push({
        outcome: 'omitted',
        reason: 'Intentionally omitted.',
        targetPath,
      });
      continue;
    }

    if (binding.requirement === 'runtime' || binding.source.kind === 'runtime') {
      const note = binding.source.kind === 'runtime' ? binding.source.note : undefined;
      const placeholder = allocateRuntimePlaceholder(
        binding.target.path,
        context.runtimePlaceholders,
      );
      runtimeRequirements.push({
        placeholder,
        targetPath,
        typeName: binding.target.typeName,
        ...(note !== undefined ? { note } : {}),
      });
      explanations.push({
        outcome: 'runtime',
        reason: 'Provided by application code.',
        targetPath,
      });
      assign(
        assembled,
        binding,
        {
          identifier: placeholder,
          kind: 'runtime',
          ...(note !== undefined ? { note } : {}),
        },
        issues,
      );
      continue;
    }

    const resolved = resolveBinding(
      binding,
      design,
      importPath,
      context,
      componentName,
      findContractTarget(recipe, binding),
    );

    if (resolved.status === 'unresolved') {
      explanations.push({ outcome: 'unresolved', reason: resolved.reason, targetPath });
      if (binding.requirement === 'required') {
        issues.push(`Required value ${JSON.stringify(targetPath)} could not be resolved: ${resolved.reason}`);
      }
      continue;
    }

    if (resolved.status === 'omitted') {
      explanations.push({ outcome: 'omitted', reason: resolved.reason, targetPath });
      continue;
    }

    explanations.push({
      outcome: 'emitted',
      reason: describeSource(binding),
      targetPath,
    });
    assign(assembled, binding, resolved.value, issues);
    for (const nestedResult of resolved.nestedResults ?? []) {
      mergeNestedResult(
        targetPath,
        nestedResult,
        explanations,
        runtimeRequirements,
        issues,
        nestedImports,
      );
    }
  }

  const props: string[] = [];
  const children = assembled.get('children');
  for (const [propName, value] of assembled) {
    if (propName === 'children') {
      continue;
    }
    const formatted = formatUsageProp(propName, value);
    if (formatted !== null) {
      props.push(formatted);
    }
  }

  const deprecation = describeDeprecation(recipe, componentName);

  return {
    explanations,
    issues,
    runtimeRequirements,
    ...(deprecation !== undefined ? { deprecation } : {}),
    usage: {
      diagnostics: [],
      imports: dedupeImports([
        { importedName: componentName, localName: componentName, modulePath: importPath },
        ...collectComponentImports(recipe, importPath),
        ...nestedImports,
      ]),
      jsx: children === undefined
        ? createSelfClosingTag(componentName, props)
        : [
            createOpeningTag(componentName, props),
            ...formatUsageChildren(children).split('\n').map((line) => `  ${line}`),
            `</${componentName}>`,
          ].join('\n'),
      ...(runtimeRequirements.length > 0
        ? {
            runtimeRequirements: runtimeRequirements.map((requirement) => {
              const note = requirement.note ? ` — ${requirement.note}` : '';
              const label = requirement.placeholder === requirement.targetPath
                ? requirement.targetPath
                : `${requirement.placeholder} → ${requirement.targetPath}`;
              return `${label}: ${requirement.typeName}${note}`;
            }),
          }
        : {}),
    },
  };
}

function mergeNestedResult(
  parentTargetPath: string,
  nested: SemanticUsageResult,
  explanations: SemanticTargetExplanation[],
  runtimeRequirements: SemanticRuntimeRequirement[],
  issues: string[],
  imports: ComponentUsage['imports'],
): void {
  imports.push(...nested.usage.imports);
  explanations.push(...nested.explanations.map((explanation) => ({
    ...explanation,
    targetPath: `${parentTargetPath}.${explanation.targetPath}`,
  })));
  runtimeRequirements.push(...nested.runtimeRequirements.map((requirement) => ({
    ...requirement,
    targetPath: `${parentTargetPath}.${requirement.targetPath}`,
  })));
  issues.push(...nested.issues.map((issue) => `${parentTargetPath}: ${issue}`));
}

function dedupeImports(imports: ComponentUsage['imports']): ComponentUsage['imports'] {
  const seen = new Set<string>();
  return imports.filter((entry) => {
    const key = `${entry.importedName}\u0000${entry.localName}\u0000${entry.modulePath}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

const RESERVED_RUNTIME_IDENTIFIERS = new Set([
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'package',
  'private',
  'protected',
  'public',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
]);

function allocateRuntimePlaceholder(
  path: readonly string[],
  used: Set<string>,
): string {
  const [head = 'runtimeValue', ...rest] = path;
  const joined = head + rest.map(
    (segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1),
  ).join('');
  const base = RESERVED_RUNTIME_IDENTIFIERS.has(joined)
    ? `runtime${joined.slice(0, 1).toUpperCase()}${joined.slice(1)}`
    : joined;
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function assign(
  assembled: Map<string, UsageValue>,
  binding: SemanticBinding,
  value: UsageValue,
  issues: string[],
): void {
  const [head, ...nestedPath] = binding.target.path;

  if (nestedPath.length === 0) {
    if (assembled.has(head)) {
      issues.push(`Multiple bindings target ${JSON.stringify(head)}; the first one was kept.`);
      return;
    }
    assembled.set(head, value);
    return;
  }

  const existing = assembled.get(head);
  if (existing !== undefined && existing.kind !== 'object') {
    issues.push(
      `Cannot assemble ${JSON.stringify(formatTargetPath(binding.target))}: ${JSON.stringify(head)} is already bound as a whole value.`,
    );
    return;
  }

  const container = existing ?? { fields: [], kind: 'object' as const };
  assignObjectPath(
    container,
    nestedPath,
    value,
    formatTargetPath(binding.target),
    issues,
  );
  assembled.set(head, container);
}

function assignObjectPath(
  container: Extract<UsageValue, { kind: 'object' }>,
  path: readonly string[],
  value: UsageValue,
  targetPath: string,
  issues: string[],
): void {
  const [head, ...rest] = path;
  const existing = container.fields.find((field) => field.name === head);

  if (rest.length === 0) {
    if (existing !== undefined) {
      issues.push(
        `Multiple bindings target ${JSON.stringify(targetPath)}; the first one was kept.`,
      );
      return;
    }
    container.fields.push({ name: head, value });
    return;
  }

  if (existing !== undefined && existing.value.kind !== 'object') {
    issues.push(
      `Cannot assemble ${JSON.stringify(targetPath)}: ${JSON.stringify(head)} is already bound as a whole value.`,
    );
    return;
  }

  let nested: Extract<UsageValue, { kind: 'object' }>;
  if (existing === undefined) {
    nested = { fields: [], kind: 'object' };
    container.fields.push({ name: head, value: nested });
  } else {
    nested = existing.value as Extract<UsageValue, { kind: 'object' }>;
  }
  assignObjectPath(nested, rest, value, targetPath, issues);
}

function resolveBinding(
  binding: SemanticBinding,
  design: SemanticDesignInput,
  importPath: string,
  context: ResolutionContext,
  componentName: string,
  contractTarget: SourceTargetDescriptor | undefined,
): ResolvedBinding {
  // A connected nested instance resolves to a whole component value; it is not
  // a primitive and no declarative transform applies to it.
  if (binding.source.kind === 'instance') {
    return resolveConnectedInstance(
      binding.source,
      binding.target.typeName,
      design,
      context,
      readNestedIconName(binding, design),
    );
  }

  if (binding.source.kind === 'instances') {
    const values: UsageValue[] = [];
    const nestedResults: SemanticUsageResult[] = [];
    for (const [index, item] of binding.source.items.entries()) {
      const resolved = resolveConnectedInstance(
        item,
        binding.target.typeName,
        design,
        context,
      );
      if (resolved.status !== 'value') {
        return {
          ...resolved,
          reason: `Repeated slot item ${index + 1}: ${resolved.reason}`,
        };
      }
      values.push(wrapRepeatedItemValue(binding.source.itemPath, resolved.value));
      nestedResults.push(...(resolved.nestedResults ?? []));
    }
    return {
      nestedResults,
      status: 'value',
      value: { items: values, kind: 'array' },
    };
  }

  const raw = readDesignValue(binding, design);

  if (raw.status !== 'value') {
    return raw;
  }

  const componentPropertyIcon = resolveComponentPropertyIcon(
    binding,
    design,
    raw.value,
  );
  if (componentPropertyIcon !== undefined) {
    return componentPropertyIcon;
  }

  if (
    isNestedIconPropertyBinding(binding)
    && typeof raw.value === 'string'
    && raw.value.trim() !== ''
  ) {
    return {
      status: 'value',
      value: {
        componentName: 'Icon',
        kind: 'component',
        props: [{ name: 'name', value: { kind: 'literal', value: raw.value } }],
      },
    };
  }

  const resolved = applyTransform(binding.transform, raw.value);
  return checkTargetType(binding, resolved, componentName, contractTarget);
}

function wrapRepeatedItemValue(
  itemPath: readonly string[] | undefined,
  value: UsageValue,
): UsageValue {
  if (itemPath === undefined || itemPath.length === 0) {
    return value;
  }

  return itemPath.reduceRight<UsageValue>(
    (nested, name) => ({
      fields: [{ name, value: nested }],
      kind: 'object',
    }),
    value,
  );
}

function findContractTarget(
  recipe: SemanticConnectionRecipe,
  binding: SemanticBinding,
): SourceTargetDescriptor | undefined {
  const path = formatTargetPath(binding.target);
  return recipe.sourceContract?.targets.find(
    (target) => target.path.join('.') === path,
  );
}

function resolveConnectedInstance(
  source: ConnectedInstanceItem,
  targetTypeName: string,
  design: SemanticDesignInput,
  context: ResolutionContext,
  iconName?: string,
): ResolvedBinding {
  const accepted = getAcceptedComponentNames(targetTypeName);
  if (accepted.length > 0 && !accepted.includes(source.componentName)) {
    return {
      reason: `${source.componentName} is incompatible with ${targetTypeName}; expected ${accepted.join(' or ')}.`,
      status: 'unresolved',
    };
  }

  const node = design.root === undefined
    ? undefined
    : resolveLocator(design.root, source.locator);
  if (
    node?.connectedRecipe !== undefined
    && context.depth < SEMANTIC_LIMITS.maxLocatorDepth
  ) {
    const nestedResult = resolveSemanticUsageInternal(
      source.componentName,
      source.importPath,
      node.connectedRecipe,
      {
        componentProperties: node.componentProperties ?? {},
        instanceSwaps: node.instanceSwaps,
        root: node,
      },
      {
        depth: context.depth + 1,
        runtimePlaceholders: context.runtimePlaceholders,
      },
    );
    return {
      nestedResults: [nestedResult],
      status: 'value',
      value: {
        componentName: source.componentName,
        kind: 'component',
        renderedJsx: nestedResult.usage.jsx,
      },
    };
  }

  return {
    status: 'value',
    value: {
      componentName: source.componentName,
      kind: 'component',
      ...(iconName === undefined
        ? {}
        : { props: [{ name: 'name', value: { kind: 'literal', value: iconName } }] }),
    },
  };
}

function isIconNodeTarget(binding: SemanticBinding): boolean {
  return binding.target.typeName.trim() === 'ReactNode'
    && binding.target.path.some((part) => part.toLowerCase().includes('icon'));
}

/**
 * Figma commonly models an icon slot with two exposed properties:
 * `hasLeadingIcon` controls visibility while `leadingIcon` carries the actual
 * nested component identity. Support both direct instance-swap mappings and
 * older saved visibility mappings, but never emit the visibility boolean into
 * a ReactNode prop.
 */
function resolveComponentPropertyIcon(
  binding: SemanticBinding,
  design: SemanticDesignInput,
  rawValue: SourcePropValue,
): ResolvedBinding | undefined {
  if (binding.source.kind !== 'component-property' || !isIconNodeTarget(binding)) {
    return undefined;
  }

  if (rawValue === false) {
    return { reason: 'The icon is hidden in Figma.', status: 'omitted' };
  }

  const sourceName = normalizePropertyName(binding.source.propertyName);
  const desiredSwapName = typeof rawValue === 'boolean'
    ? sourceName.replace(/^has/, '')
    : sourceName;
  const swapEntry = Object.entries(design.instanceSwaps ?? {}).find(
    ([propertyName, instanceSwap]) => (
      normalizePropertyName(propertyName) === desiredSwapName
      && (typeof rawValue !== 'string' || instanceSwap.componentId === rawValue)
    ),
  )?.[1];

  if (swapEntry === undefined) {
    return {
      reason: `Icon property ${JSON.stringify(binding.source.propertyName)} has no resolved instance swap.`,
      status: 'unresolved',
    };
  }

  return {
    status: 'value',
    value: {
      componentName: 'Icon',
      kind: 'component',
      props: [{
        name: 'name',
        value: {
          kind: 'literal',
          value: createIconName(swapEntry.componentName),
        },
      }],
    },
  };
}

function normalizePropertyName(value: string): string {
  return value.replace(/#[^#]+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

/**
 * A nested icon instance commonly exposes only its glyph `name`, while the
 * corresponding code prop accepts a React node. Recreate the public Icon
 * component instead of emitting the name as a string into the node slot.
 */
function isNestedIconPropertyBinding(binding: SemanticBinding): boolean {
  if (
    binding.source.kind !== 'nested-property'
    || binding.target.typeName.trim() !== 'ReactNode'
    || !binding.target.path.some((part) => part.toLowerCase().includes('icon'))
  ) {
    return false;
  }
  const propertyName = binding.source.propertyName.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return propertyName === 'name' || propertyName === 'iconname';
}

/**
 * Icon slots conventionally expose the selected glyph through a nested
 * instance's `name` (or `iconName`) component property. Preserve that identity
 * when formatting the connected child for Inspect Code.
 */
function readNestedIconName(
  binding: SemanticBinding,
  design: SemanticDesignInput,
): string | undefined {
  if (
    binding.source.kind !== 'instance'
    || !binding.target.path.some((part) => part.toLowerCase().includes('icon'))
    || design.root === undefined
  ) {
    return undefined;
  }

  const node = resolveLocator(design.root, binding.source.locator);
  for (const [propertyName, value] of Object.entries(node?.componentProperties ?? {})) {
    const normalizedName = propertyName.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (
      (normalizedName === 'name' || normalizedName === 'iconname')
      && typeof value === 'string'
      && value.trim() !== ''
    ) {
      return value;
    }
  }
  return undefined;
}

/**
 * Guard the emitted literal against the target's declared type. A boolean prop
 * bound to a multi-option variant needs each option mapped to true or false;
 * without that mapping the raw option string would be emitted into a boolean
 * prop, so report it instead of generating type-incorrect code.
 */
function checkTargetType(
  binding: SemanticBinding,
  resolved: ResolvedBinding,
  componentName: string,
  contractTarget: SourceTargetDescriptor | undefined,
): ResolvedBinding {
  if (resolved.status !== 'value' || resolved.value.kind !== 'literal') {
    return resolved;
  }

  const expectsBoolean = binding.target.typeName.trim() === 'boolean';
  if (expectsBoolean && typeof resolved.value.value !== 'boolean') {
    return {
      reason: `Design value ${JSON.stringify(String(resolved.value.value))} is not a boolean. Map each option to true or false.`,
      status: 'unresolved',
    };
  }

  if (
    componentName === 'Icon'
    && binding.target.path.length === 1
    && binding.target.path[0] === 'name'
    && typeof resolved.value.value === 'string'
    && contractTarget?.values !== undefined
    && !contractTarget.values.includes(resolved.value.value)
  ) {
    return {
      reason: `Icon name ${JSON.stringify(resolved.value.value)} is not declared by IconNames.`,
      status: 'unresolved',
    };
  }

  return resolved;
}

type RawDesignValue =
  | { status: 'value'; value: SourcePropValue }
  | { status: 'omitted'; reason: string }
  | { status: 'unresolved'; reason: string };

function readDesignValue(
  binding: SemanticBinding,
  design: SemanticDesignInput,
): RawDesignValue {
  const source = binding.source;

  switch (source.kind) {
    case 'static':
      return { status: 'value', value: source.value };
    case 'component-property': {
      const value = Object.prototype.hasOwnProperty.call(
        design.componentProperties,
        source.propertyName,
      )
        ? design.componentProperties[source.propertyName]
        : undefined;
      if (value === undefined) {
        return {
          reason: `Figma property ${JSON.stringify(source.propertyName)} was not found on the selection.`,
          status: 'unresolved',
        };
      }
      return { status: 'value', value };
    }
    case 'nested-text': {
      if (design.root === undefined) {
        return readSampleValue(design.samples, 'nested-text', source.locator);
      }
      const node = resolveLocator(design.root, source.locator);
      if (node === undefined) {
        return {
          reason: `Nested layer ${JSON.stringify(source.locator.namePath.join(' / '))} was not found.`,
          status: 'unresolved',
        };
      }
      if (typeof node.characters !== 'string') {
        return {
          reason: `Layer ${JSON.stringify(source.locator.namePath.join(' / '))} is not a text layer.`,
          status: 'unresolved',
        };
      }
      return { status: 'value', value: node.characters };
    }
    case 'nested-property': {
      if (design.root === undefined) {
        return readSampleValue(
          design.samples,
          'nested-property',
          source.locator,
          source.propertyName,
        );
      }
      const node = resolveLocator(design.root, source.locator);
      const value = node?.componentProperties === undefined
        ? undefined
        : node.componentProperties[source.propertyName];
      if (value === undefined) {
        return {
          reason: `Nested property ${JSON.stringify(source.propertyName)} at ${JSON.stringify(source.locator.namePath.join(' / '))} was not found.`,
          status: 'unresolved',
        };
      }
      return { status: 'value', value };
    }
    case 'omitted':
      return { reason: 'Intentionally omitted.', status: 'omitted' };
    case 'instance':
    case 'instances':
      // Unreachable: resolveBinding returns a component value before any
      // primitive read. Kept for switch totality.
      return {
        reason: 'A connected component value cannot be read as a primitive.',
        status: 'unresolved',
      };
    case 'runtime':
      // Handled before resolveBinding; kept for exhaustiveness.
      return { reason: 'Runtime values are not design-resolved.', status: 'omitted' };
  }
}

function readSampleValue(
  samples: FigmaSemanticSnapshot | undefined,
  kind: 'nested-property' | 'nested-text',
  locator: SemanticLocator,
  propertyName?: string,
): RawDesignValue {
  const descriptor = samples?.nestedSources.find((source) => (
    source.kind === kind
    && locatorKey(source.locator) === locatorKey(locator)
    && (kind === 'nested-text' || source.propertyName === propertyName)
  ));

  if (descriptor?.sampleValue === undefined) {
    return {
      reason: `Nested value at ${JSON.stringify(locator.namePath.join(' / '))} has no captured sample.`,
      status: 'unresolved',
    };
  }

  const sample = descriptor.sampleValue;
  const value = sample === 'true' && kind === 'nested-property'
    ? true
    : sample === 'false' && kind === 'nested-property'
      ? false
      : sample;
  return { status: 'value', value };
}

function applyTransform(
  transform: SemanticTransform | undefined,
  value: SourcePropValue,
): ResolvedBinding {
  if (transform === undefined) {
    return { status: 'value', value: { kind: 'literal', value } };
  }

  if (transform.kind === 'omit-when-empty') {
    if (value === false || value === '' || (typeof value === 'string' && value.trim() === '')) {
      return { reason: 'The design value is empty.', status: 'omitted' };
    }
    return { status: 'value', value: { kind: 'literal', value } };
  }

  if (transform.kind === 'boolean') {
    if (typeof value !== 'boolean') {
      return {
        reason: `Expected a boolean design value but received ${JSON.stringify(value)}.`,
        status: 'unresolved',
      };
    }
    const mapped = value ? transform.whenTrue : transform.whenFalse;
    if (mapped === undefined) {
      return { reason: `No output is defined for ${String(value)}.`, status: 'omitted' };
    }
    return { status: 'value', value: { kind: 'literal', value: mapped } };
  }

  const key = String(value);
  if (!Object.prototype.hasOwnProperty.call(transform.map, key)) {
    return {
      reason: `No mapping entry for design value ${JSON.stringify(key)}.`,
      status: 'unresolved',
    };
  }
  return { status: 'value', value: { kind: 'literal', value: transform.map[key] } };
}

/**
 * Imports for component values, in binding order and deduplicated.
 * `renderImportLines` groups imports that share a module path.
 */
function collectComponentImports(
  recipe: SemanticConnectionRecipe,
  parentImportPath: string,
): ComponentUsage['imports'] {
  const imports: ComponentUsage['imports'] = [];
  const seen = new Set<string>();

  for (const binding of recipe.bindings) {
    const components = binding.source.kind === 'instance'
      ? [binding.source]
      : binding.source.kind === 'instances'
        ? binding.source.items
        : isNestedIconPropertyBinding(binding)
          || (binding.source.kind === 'component-property' && isIconNodeTarget(binding))
          ? [{ componentName: 'Icon', importPath: parentImportPath }]
          : [];

    for (const { componentName, importPath } of components) {
      const key = `${componentName}\u0000${importPath}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      imports.push({
        importedName: componentName,
        localName: componentName,
        modulePath: importPath,
      });
    }
  }

  return imports;
}

/**
 * Build the deprecation notice for a deprecated recipe. The code is still
 * generated as usual; this is advisory guidance shown alongside it.
 */
function describeDeprecation(
  recipe: SemanticConnectionRecipe,
  componentName: string,
): string | undefined {
  if (recipe.lifecycle?.state !== 'deprecated') {
    return undefined;
  }
  const replacement = recipe.lifecycle.replacement?.trim();
  return replacement
    ? `${componentName} is deprecated. ${replacement}`
    : `${componentName} is deprecated.`;
}

function describeSource(binding: SemanticBinding): string {
  const source = binding.source;
  switch (source.kind) {
    case 'component-property':
      return `From Figma property ${JSON.stringify(source.propertyName)}.`;
    case 'nested-text':
      return `From nested text ${JSON.stringify(source.locator.namePath.join(' / '))}.`;
    case 'nested-property':
      return `From nested property ${JSON.stringify(source.propertyName)} at ${JSON.stringify(source.locator.namePath.join(' / '))}.`;
    case 'omitted':
      return 'Intentionally omitted.';
    case 'instance':
      return `From the connected component ${JSON.stringify(source.componentName)} at ${JSON.stringify(source.locator.namePath.join(' / '))}.`;
    case 'instances':
      return `From ${source.items.length} ordered connected components.`;
    case 'static':
      return 'Static value authored in the recipe.';
    case 'runtime':
      return 'Provided by application code.';
  }
}
