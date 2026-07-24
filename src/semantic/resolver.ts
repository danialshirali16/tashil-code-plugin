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
import { createSelfClosingTag } from '../codegen';
import type { SourcePropValue } from '../types';
import { resolveLocator, type SemanticNodeLike } from './figma-extractor';
import { formatUsageProp, type UsageValue } from './usage-ir';
import {
  formatTargetPath,
  locatorKey,
  type FigmaSemanticSnapshot,
  type SemanticBinding,
  type SemanticConnectionRecipe,
  type SemanticLocator,
  type SemanticTransform,
} from './types';

export type SemanticDesignInput = {
  /** Top-level component property values of the selected instance. */
  componentProperties: Readonly<Record<string, string | boolean>>;
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
  | { status: 'value'; value: UsageValue }
  | { status: 'omitted'; reason: string }
  | { status: 'unresolved'; reason: string };

export function resolveSemanticUsage(
  componentName: string,
  importPath: string,
  recipe: SemanticConnectionRecipe,
  design: SemanticDesignInput,
): SemanticUsageResult {
  const explanations: SemanticTargetExplanation[] = [];
  const runtimeRequirements: SemanticRuntimeRequirement[] = [];
  const issues: string[] = [];

  /** Top-level prop name → assembled value, in binding order. */
  const assembled = new Map<string, UsageValue>();

  for (const binding of recipe.bindings) {
    const targetPath = formatTargetPath(binding.target);

    if (binding.requirement === 'runtime' || binding.source.kind === 'runtime') {
      const note = binding.source.kind === 'runtime' ? binding.source.note : undefined;
      runtimeRequirements.push({
        targetPath,
        typeName: binding.target.typeName,
        ...(note !== undefined ? { note } : {}),
      });
      explanations.push({
        outcome: 'runtime',
        reason: 'Provided by application code.',
        targetPath,
      });
      assign(assembled, binding, { kind: 'runtime', ...(note !== undefined ? { note } : {}) }, issues);
      continue;
    }

    const resolved = resolveBinding(binding, design);

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
  }

  const props: string[] = [];
  for (const [propName, value] of assembled) {
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
      imports: [
        { importedName: componentName, localName: componentName, modulePath: importPath },
        ...collectInstanceImports(recipe),
      ],
      jsx: createSelfClosingTag(componentName, props),
    },
  };
}

function assign(
  assembled: Map<string, UsageValue>,
  binding: SemanticBinding,
  value: UsageValue,
  issues: string[],
): void {
  const [head, leaf] = binding.target.path;

  if (leaf === undefined) {
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
  if (container.fields.some((field) => field.name === leaf)) {
    issues.push(
      `Multiple bindings target ${JSON.stringify(formatTargetPath(binding.target))}; the first one was kept.`,
    );
    return;
  }
  container.fields.push({ name: leaf, value });
  assembled.set(head, container);
}

function resolveBinding(
  binding: SemanticBinding,
  design: SemanticDesignInput,
): ResolvedBinding {
  // A connected nested instance resolves to a whole component value; it is not
  // a primitive and no declarative transform applies to it.
  if (binding.source.kind === 'instance') {
    return {
      status: 'value',
      value: { componentName: binding.source.componentName, kind: 'component' },
    };
  }

  const raw = readDesignValue(binding, design);

  if (raw.status !== 'value') {
    return raw;
  }

  return applyTransform(binding.transform, raw.value);
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
 * Imports for connected nested instances used as component values, in binding
 * order and deduplicated. `renderImportLines` groups them by module path.
 */
function collectInstanceImports(
  recipe: SemanticConnectionRecipe,
): ComponentUsage['imports'] {
  const imports: ComponentUsage['imports'] = [];
  const seen = new Set<string>();

  for (const binding of recipe.bindings) {
    if (binding.source.kind !== 'instance') {
      continue;
    }
    const { componentName, importPath } = binding.source;
    const key = `${componentName} ${importPath}`;
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
    case 'static':
      return 'Static value authored in the recipe.';
    case 'runtime':
      return 'Provided by application code.';
  }
}
