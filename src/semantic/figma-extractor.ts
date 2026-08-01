/**
 * Bounded semantic extraction of nested design values, for connect authoring
 * and codegen resolution only. Layout Composer never consumes these results;
 * a connected component stays an atomic boundary there.
 *
 * Operates on a minimal structural node shape so it can run against real
 * Figma nodes in `main.ts` and against plain fixtures in tests. Traversal is
 * depth-, node-, and result-limited and returns partial results with
 * diagnostics instead of failing the whole scan.
 */

import {
  SEMANTIC_LIMITS,
  locatorKey,
  type FigmaNestedSourceDescriptor,
  type FigmaSemanticSnapshot,
  type SemanticExtractionDiagnostic,
  type SemanticExtractionLimits,
  type SemanticConnectionRecipe,
  type SemanticLocator,
} from './types';

/** Structural mirror of the Figma nodes the extractor needs. */
export type SemanticNodeLike = {
  name: string;
  type: string;
  visible?: boolean;
  characters?: string;
  children?: readonly SemanticNodeLike[];
  /** Main-component key when the node is an INSTANCE with a resolvable main. */
  mainComponentKey?: string;
  /** Exposed component property values on an INSTANCE node. */
  componentProperties?: Readonly<Record<string, string | boolean>>;
  /** Resolved identities for INSTANCE_SWAP properties on this exact instance. */
  instanceSwaps?: Readonly<Record<string, {
    componentId: string;
    componentName: string;
    importPath?: string;
  }>>;
  /** True when a Tashil connection is stored on the instance's main component. */
  hasOwnConnection?: boolean;
  /** The connected child's public component identity, when it has one. */
  connectedComponentName?: string;
  connectedImportPath?: string;
  /**
   * Validated recipe stored on the connected child's own main component.
   * Kept only in the live semantic tree; parent snapshots still persist the
   * child's public identity rather than duplicating its recipe.
   */
  connectedRecipe?: SemanticConnectionRecipe;
};

export type SemanticExtractionResult = {
  snapshot: FigmaSemanticSnapshot;
  /** Human-readable notes about truncation or skipped subtrees. */
  diagnostics: string[];
  /** Machine-readable truncation details for UI and compatibility reports. */
  extractionDiagnostics: SemanticExtractionDiagnostic[];
  /** True when limits truncated the scan and results are partial. */
  partial: boolean;
};

const SAMPLE_VALUE_MAX_LENGTH = 80;

/**
 * Walk the component's descendants and capture nested text layers and nested
 * instance properties as candidate semantic sources. Hidden layers are
 * excluded by default. Text reachable through a top-level component property
 * is still captured; the authoring layer prefers the stable property id.
 */
export function extractFigmaSemanticSnapshot(
  root: SemanticNodeLike,
  rootId: string,
  limitOverrides: Partial<SemanticExtractionLimits> = {},
): SemanticExtractionResult {
  const limits: SemanticExtractionLimits = {
    maxExtractionNodes: normalizeLimit(
      limitOverrides.maxExtractionNodes,
      SEMANTIC_LIMITS.maxExtractionNodes,
    ),
    maxLocatorDepth: normalizeLimit(
      limitOverrides.maxLocatorDepth,
      SEMANTIC_LIMITS.maxLocatorDepth,
    ),
    maxNestedSources: normalizeLimit(
      limitOverrides.maxNestedSources,
      SEMANTIC_LIMITS.maxNestedSources,
    ),
  };
  const nestedSources: FigmaNestedSourceDescriptor[] = [];
  const extractionDiagnostics: SemanticExtractionDiagnostic[] = [];
  const diagnosticKeys = new Set<string>();
  const seenKeys = new Set<string>();
  let visited = 0;
  let partial = false;

  const visit = (
    node: SemanticNodeLike,
    namePath: string[],
    depth: number,
    anchorComponentKey: string | undefined,
  ): void => {
    if (visited >= limits.maxExtractionNodes) {
      partial = true;
      addDiagnostic({
        code: 'node-limit',
        limit: limits.maxExtractionNodes,
        message: `Stopped after visiting ${limits.maxExtractionNodes} layers; remaining values were not scanned.`,
      });
      return;
    }
    visited += 1;

    if (node.visible === false) {
      return;
    }

    if (depth > limits.maxLocatorDepth) {
      partial = true;
      const path = namePath.join(' / ');
      addDiagnostic({
        code: 'locator-depth-limit',
        limit: limits.maxLocatorDepth,
        message: `Skipped values deeper than ${limits.maxLocatorDepth} layers under ${JSON.stringify(path)}.`,
        path,
      });
      return;
    }

    const isRoot = namePath.length === 0;

    if (!isRoot && nestedSources.length >= limits.maxNestedSources) {
      partial = true;
      addDiagnostic({
        code: 'nested-source-limit',
        limit: limits.maxNestedSources,
        message: `Captured the maximum of ${limits.maxNestedSources} nested sources; remaining candidates were skipped.`,
      });
      return;
    }

    if (!isRoot && node.type === 'TEXT') {
      addSource(node, namePath, 'nested-text', anchorComponentKey);
      return;
    }

    let nextAnchor = anchorComponentKey;
    if (!isRoot && node.type === 'INSTANCE') {
      nextAnchor = node.mainComponentKey ?? anchorComponentKey;

      for (const propertyName of Object.keys(node.componentProperties ?? {})) {
        if (nestedSources.length >= limits.maxNestedSources) {
          break;
        }
        addSource(node, namePath, 'nested-property', nextAnchor, propertyName);
      }

      // A separately connected nested instance keeps its own public API; do
      // not harvest its internals as parent semantic sources. It is still
      // offered as a whole-component value for props that expect a component.
      if (node.hasOwnConnection) {
        if (
          node.connectedComponentName !== undefined
          && node.connectedImportPath !== undefined
          && nestedSources.length < limits.maxNestedSources
        ) {
          addSource(node, namePath, 'nested-instance', nextAnchor);
        }
        return;
      }

      for (const [propertyName, swap] of Object.entries(node.instanceSwaps ?? {})) {
        if (nestedSources.length >= limits.maxNestedSources) {
          partial = true;
          addDiagnostic({
            code: 'nested-source-limit',
            limit: limits.maxNestedSources,
            message: `Captured the maximum of ${limits.maxNestedSources} nested sources; remaining candidates were skipped.`,
          });
          break;
        }
        addSource(
          {
            ...node,
            connectedComponentName: swap.componentName,
            connectedImportPath: swap.importPath,
          },
          namePath,
          'nested-instance',
          nextAnchor,
          undefined,
          propertyName,
        );
      }
    }

    for (const child of node.children ?? []) {
      visit(child, [...namePath, child.name], depth + 1, nextAnchor);
    }
  };

  const addSource = (
    node: SemanticNodeLike,
    namePath: string[],
    kind: 'nested-property' | 'nested-text' | 'nested-instance',
    componentKey: string | undefined,
    propertyName?: string,
    instancePropertyName?: string,
  ): void => {
    const locator: SemanticLocator = {
      fragile: componentKey === undefined,
      namePath,
      ...(componentKey !== undefined ? { componentKey } : {}),
    };
    const key = `${kind}:${locatorKey(locator)}:${propertyName ?? instancePropertyName ?? ''}`;
    if (seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);

    const sampleValue = kind === 'nested-text'
      ? node.characters
      : kind === 'nested-instance'
        ? node.connectedComponentName
        : formatPropertySample(node.componentProperties?.[propertyName ?? '']);

    nestedSources.push({
      displayPath: propertyName === undefined && instancePropertyName === undefined
        ? namePath.join(' / ')
        : `${namePath.join(' / ')} / ${propertyName ?? instancePropertyName}`,
      kind,
      locator,
      ...(propertyName !== undefined ? { propertyName } : {}),
      ...(kind === 'nested-instance'
        ? {
            connectedComponentName: node.connectedComponentName,
            connectedImportPath: node.connectedImportPath,
            ...(instancePropertyName !== undefined ? { instancePropertyName } : {}),
          }
        : {}),
      ...(sampleValue !== undefined
        ? { sampleValue: sampleValue.slice(0, SAMPLE_VALUE_MAX_LENGTH) }
        : {}),
    });
  };

  const addDiagnostic = (diagnostic: SemanticExtractionDiagnostic): void => {
    const key = `${diagnostic.code}:${diagnostic.path ?? ''}`;
    if (diagnosticKeys.has(key)) {
      return;
    }
    diagnosticKeys.add(key);
    extractionDiagnostics.push(diagnostic);
  };

  visit(root, [], 0, undefined);

  return {
    diagnostics: extractionDiagnostics.map(({ message }) => message),
    extractionDiagnostics,
    partial,
    snapshot: {
      componentId: rootId,
      componentName: root.name,
      nestedSources,
      extraction: {
        diagnostics: extractionDiagnostics,
        partial,
        visitedNodes: visited,
      },
    },
  };
}

/**
 * Resolve one locator against a live node tree. Matching is by name path;
 * when the locator carries a component key, an instance along the path must
 * still expose that key so pure display renames of ancestors do not silently
 * rebind to an unrelated layer. Returns undefined when no unambiguous match
 * exists.
 */
export function resolveLocator(
  root: SemanticNodeLike,
  locator: SemanticLocator,
): SemanticNodeLike | undefined {
  let current: readonly SemanticNodeLike[] = root.children ?? [];
  let node: SemanticNodeLike | undefined;
  let sawComponentKey = false;

  for (const segment of locator.namePath) {
    const matches = current.filter(
      (candidate) => candidate.name === segment && candidate.visible !== false,
    );
    if (matches.length !== 1) {
      return undefined;
    }
    node = matches[0];
    if (locator.componentKey !== undefined
      && node.mainComponentKey === locator.componentKey) {
      sawComponentKey = true;
    }
    current = node.children ?? [];
  }

  if (locator.componentKey !== undefined && !sawComponentKey) {
    return undefined;
  }

  return node;
}

function formatPropertySample(value: string | boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined || !Number.isInteger(value) || value <= 0
    ? fallback
    : Math.min(value, fallback);
}
