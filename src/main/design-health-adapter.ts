import { emit } from '@create-figma-plugin/utilities';
import {
  calculateTokenAuditSummary,
  createTokenCandidateIndex,
  isValueEqual,
  rankTokenSuggestion,
  type TokenCandidateInput,
  type TokenCandidateIndex,
} from '../design-health/token-audit';
import type {
  DeprecatedInstanceNotice,
  DesignHealthScanResult,
  LibraryUpdateNotice,
  TokenBindingRequest,
  TokenPropertyIssue,
  TokenPropertyKind,
  TokenSuggestion,
} from '../design-health/types';
import type {
  ApplyLibraryUpdatesResultHandler,
  ApplyTokenBindingsResultHandler,
  ScanDesignHealthResultHandler,
} from '../types';
import { armProgrammaticSelection } from './selection-adapter';

let latestScanId = '';
const MAX_SCAN_NODES = 800;
const FIGMA_LOOKUP_CHUNK_SIZE = 25;

type DesignHealthScanRequest = {
  scanId: string;
  targetNodeId?: string;
};

let pendingDesignHealthScan: DesignHealthScanRequest | undefined;
let designHealthScanWorker: Promise<void> | undefined;

type AuditNodeSnapshot = {
  node: SceneNode;
  isInsideInstance: boolean;
  parentInstanceId?: string;
  fills?: readonly Paint[];
  strokes?: readonly Paint[];
  boundVariables?: Record<string, VariableAlias | VariableAlias[]>;
  inferredVariables?: Record<string, unknown>;
};

type AuditTraversalSnapshot = {
  nodes: AuditNodeSnapshot[];
  referencedVariableIds: Set<string>;
  nodesVisited: number;
  capReached: boolean;
};

type ConsumerResolution = {
  resolvedType?: VariableResolvedDataType;
  value?: string | number;
};

type ConsumerResolutionCache = WeakMap<
  SceneNode,
  Map<string, ConsumerResolution>
>;

export function scanDesignHealth(
  scanId: string,
  targetNodeId?: string,
): Promise<void> {
  latestScanId = scanId;
  pendingDesignHealthScan = { scanId, targetNodeId };
  if (!designHealthScanWorker) {
    designHealthScanWorker = drainDesignHealthScans();
  }
  return designHealthScanWorker;
}

async function drainDesignHealthScans(): Promise<void> {
  try {
    while (pendingDesignHealthScan) {
      const request = pendingDesignHealthScan;
      pendingDesignHealthScan = undefined;
      await runDesignHealthScan(request.scanId, request.targetNodeId);
    }
  } finally {
    designHealthScanWorker = undefined;
    // Defensive restart for a request that arrived as the current worker was
    // settling. In ordinary event-loop ordering the loop above consumes it.
    if (pendingDesignHealthScan) {
      designHealthScanWorker = drainDesignHealthScans();
    }
  }
}

async function runDesignHealthScan(
  scanId: string,
  targetNodeId?: string,
): Promise<void> {
  try {
    let targetNode: SceneNode | null = null;
    const currentSel = figma.currentPage.selection;
    if (targetNodeId && currentSel.length > 0 && currentSel[0].id === targetNodeId) {
      targetNode = currentSel[0];
    } else if (targetNodeId) {
      try {
        const found = await figma.getNodeByIdAsync(targetNodeId);
        if (found && 'type' in found) {
          targetNode = found as SceneNode;
        }
      } catch {
        targetNode = null;
      }
    } else if (currentSel.length > 0) {
      targetNode = currentSel[0];
    }

    if (!targetNode || ('removed' in targetNode && targetNode.removed)) {
      emit<ScanDesignHealthResultHandler>('SCAN_DESIGN_HEALTH_RESULT', {
        ok: true,
        scanId,
        scanResult: undefined,
        message: '',
      });
      return;
    }

    const selectionCount = figma.currentPage.selection.length;

    // 1. Build comprehensive variable map from local collections and referenced document variables
    const variableMap = new Map<string, Variable>();

    // One call covers every local collection's tokens; a per-collection
    // variableIds walk would only re-fetch variables already in this list.
    try {
      const localVariables = await figma.variables.getLocalVariablesAsync();
      for (const v of localVariables) {
        variableMap.set(v.id, v);
      }
    } catch {
      // ignore
    }
    if (scanId !== latestScanId) {
      return;
    }

    // Traverse once and retain the property-group snapshots used by both
    // variable discovery and the audit. This avoids reading the same Figma
    // fields again after external collections have loaded.
    const traversal = collectAuditTraversal(targetNode);
    const referencedVarIds = traversal.referencedVariableIds;

    // Fetch referenced variables that are not local, then expand their full
    // collections so the complete library token set is available in memory.
    // Fetches run in parallel chunks — sequential per-variable awaits are the
    // dominant scan cost once a library holds hundreds of tokens.
    const referencedMissing = Array.from(referencedVarIds).filter((id) => !variableMap.has(id));
    if (!await fetchVariablesChunked(referencedMissing, variableMap, scanId)) {
      return;
    }

    const collectionIdsToExpand = new Set<string>();
    for (const varId of referencedVarIds) {
      const v = variableMap.get(varId);
      if (v?.variableCollectionId) {
        collectionIdsToExpand.add(v.variableCollectionId);
      }
    }

    const collections = await fetchVariableCollectionsChunked(
      Array.from(collectionIdsToExpand),
      scanId,
    );
    if (!collections) {
      return;
    }

    const sisterVarIds = new Set<string>();
    for (const collection of collections) {
      if (Array.isArray(collection.variableIds)) {
        for (const varId of collection.variableIds) {
          if (!variableMap.has(varId)) {
            sisterVarIds.add(varId);
          }
        }
      }
    }
    if (!await fetchVariablesChunked(Array.from(sisterVarIds), variableMap, scanId)) {
      return;
    }

    // Resolve candidate values once for the audit root's variable-mode context.
    // Resolving every variable for every node would cost nodes × variables
    // bridge calls; per-node mode divergence inside the selection is instead
    // handled by verifying each exact-match suggestion against its consuming
    // node (see rankAndVerifySuggestions).
    const variableList = Array.from(variableMap.values());
    const consumerResolutionCache: ConsumerResolutionCache = new WeakMap();
    const tokenCandidates = createTokenCandidatesForConsumer(
      variableList,
      targetNode,
      consumerResolutionCache,
    );
    const tokenCandidateIndex = createTokenCandidateIndex(tokenCandidates);
    const mainComponentsByInstanceId = await fetchMainComponentsChunked(
      traversal.nodes,
      scanId,
    );
    if (!mainComponentsByInstanceId) {
      return;
    }
    const latestRemoteComponentsByKey = await fetchLatestRemoteComponentsChunked(
      mainComponentsByInstanceId,
      scanId,
    );
    if (!latestRemoteComponentsByKey) {
      return;
    }

    // Traverse the subtree
    const issues: TokenPropertyIssue[] = [];
    let boundPropertiesCount = 0;
    const uniqueComponentKeys = new Set<string>();
    const deprecatedInstances: DeprecatedInstanceNotice[] = [];
    const updateAvailableInstances: LibraryUpdateNotice[] = [];
    let remoteInstancesCount = 0;
    let localInstancesCount = 0;
    let currentRemoteInstancesCount = 0;
    let updateCheckFailuresCount = 0;
    let totalInstances = 0;

    for (const current of traversal.nodes) {
      if (scanId !== latestScanId) {
        // Cancelled by a newer scan
        return;
      }

      const n = current.node;

      if ('removed' in n && n.removed) {
        continue;
      }

      try {
        const isEditableHere = !current.isInsideInstance || n.id === current.parentInstanceId;
        const { fills, strokes, boundVariables, inferredVariables } = current;
        const hasBoundVariable = (field: string): boolean => Boolean(
          boundVariables && field in boundVariables,
        );

        // Check Component Instances
        if (n.type === 'INSTANCE') {
          totalInstances++;
          const mainComp = mainComponentsByInstanceId.get(n.id) ?? null;
          if (mainComp) {
            if (mainComp.remote) {
              remoteInstancesCount++;

              const latestComponent = mainComp.key
                ? latestRemoteComponentsByKey.get(mainComp.key)
                : null;
              if (!latestComponent) {
                updateCheckFailuresCount++;
              } else if (latestComponent.id !== mainComp.id) {
                updateAvailableInstances.push({
                  nodeId: n.id,
                  instanceName: n.name,
                  componentName: mainComp.name,
                });
              } else {
                currentRemoteInstancesCount++;
              }
            } else {
              localInstancesCount++;
            }

            const compKey = mainComp.key || mainComp.id;
            const compName = mainComp.name;
            uniqueComponentKeys.add(compKey);

            // Check deprecation
            const desc = (mainComp.description || '').toLowerCase();
            const name = compName.toLowerCase();
            if (desc.includes('[deprecated]') || desc.includes('deprecated') || name.startsWith('_deprecated') || name.startsWith('.deprecated')) {
              deprecatedInstances.push({
                nodeId: n.id,
                instanceName: n.name,
                componentName: compName,
                deprecationNotice: mainComp.description || 'Component marked as deprecated in library',
              });
            }
          } else {
            updateCheckFailuresCount++;
          }
        }

      // Check Fills (Colors)
      if (fills) {
        for (let paintIndex = 0; paintIndex < fills.length; paintIndex += 1) {
          const paint = fills[paintIndex];
          if (paint.type === 'SOLID' && paint.visible !== false) {
            const hasBoundVar = Boolean(
              paint.boundVariables?.color || getBoundPaintVariable(boundVariables, 'fills', paintIndex),
            );
            if (hasBoundVar) {
              boundPropertiesCount++;
            } else {
              const hex = colorToHex(paint.color, paint.opacity);
              const inferred = await readInferredVariable(inferredVariables, 'fills', variableMap, paintIndex);
              const { suggestion, alternatives } = await rankAndVerifySuggestions({
                node: n,
                property: 'fill',
                currentValue: hex,
                inferredVariable: inferred,
                candidateIndex: tokenCandidateIndex,
                nodeName: n.name,
                resolutionCache: consumerResolutionCache,
                variableMap,
              });

              issues.push({
                id: `${n.id}:fill:${paintIndex}`,
                nodeId: n.id,
                nodeName: n.name,
                property: 'fill',
                bindingTarget: { field: 'fills', paintIndex },
                currentValue: hex,
                isEditableHere,
                containerInstanceId: current.parentInstanceId,
                suggestion,
                alternativeSuggestions: alternatives,
              });
            }
          }
        }
      }

      // Check Strokes (Colors)
      if (strokes) {
        for (let paintIndex = 0; paintIndex < strokes.length; paintIndex += 1) {
          const paint = strokes[paintIndex];
          if (paint.type === 'SOLID' && paint.visible !== false) {
            const hasBoundVar = Boolean(
              paint.boundVariables?.color || getBoundPaintVariable(boundVariables, 'strokes', paintIndex),
            );
            if (hasBoundVar) {
              boundPropertiesCount++;
            } else {
              const hex = colorToHex(paint.color, paint.opacity);
              const inferred = await readInferredVariable(inferredVariables, 'strokes', variableMap, paintIndex);
              const { suggestion, alternatives } = await rankAndVerifySuggestions({
                node: n,
                property: 'stroke',
                currentValue: hex,
                inferredVariable: inferred,
                candidateIndex: tokenCandidateIndex,
                nodeName: n.name,
                resolutionCache: consumerResolutionCache,
                variableMap,
              });

              issues.push({
                id: `${n.id}:stroke:${paintIndex}`,
                nodeId: n.id,
                nodeName: n.name,
                property: 'stroke',
                bindingTarget: { field: 'strokes', paintIndex },
                currentValue: hex,
                isEditableHere,
                containerInstanceId: current.parentInstanceId,
                suggestion,
                alternativeSuggestions: alternatives,
              });
            }
          }
        }
      }

      // Check Corner Radius
      const cornerRadius = 'cornerRadius' in n ? n.cornerRadius : undefined;
      if (typeof cornerRadius === 'number' && cornerRadius > 0) {
        const hasBoundVar = hasBoundVariable('cornerRadius') || hasBoundVariable('topLeftRadius');
        if (hasBoundVar) {
          boundPropertiesCount++;
        } else {
          const inferred = (await readInferredVariable(inferredVariables, 'cornerRadius', variableMap))
            || (await readInferredVariable(inferredVariables, 'topLeftRadius', variableMap));
          const { suggestion, alternatives } = await rankAndVerifySuggestions({
            node: n,
            property: 'cornerRadius',
            currentValue: cornerRadius,
            inferredVariable: inferred,
            candidateIndex: tokenCandidateIndex,
            nodeName: n.name,
            resolutionCache: consumerResolutionCache,
            variableMap,
          });

          issues.push({
            id: `${n.id}:cornerRadius`,
            nodeId: n.id,
            nodeName: n.name,
            property: 'cornerRadius',
            bindingTarget: { field: 'cornerRadius' },
            currentValue: cornerRadius,
            isEditableHere,
            containerInstanceId: current.parentInstanceId,
            suggestion,
            alternativeSuggestions: alternatives,
          });
        }
      }

      // Check Layout Gap (itemSpacing)
      const layoutMode = 'layoutMode' in n ? n.layoutMode : undefined;
      if (layoutMode && layoutMode !== 'NONE') {
        const itemSpacing = 'itemSpacing' in n ? n.itemSpacing : undefined;
        if (typeof itemSpacing === 'number' && itemSpacing > 0) {
          const hasBoundVar = hasBoundVariable('itemSpacing');
          if (hasBoundVar) {
            boundPropertiesCount++;
          } else {
            const inferred = await readInferredVariable(inferredVariables, 'itemSpacing', variableMap);
            const { suggestion, alternatives } = await rankAndVerifySuggestions({
              node: n,
              property: 'gap',
              currentValue: itemSpacing,
              inferredVariable: inferred,
              candidateIndex: tokenCandidateIndex,
              nodeName: n.name,
              resolutionCache: consumerResolutionCache,
              variableMap,
            });

            issues.push({
              id: `${n.id}:gap`,
              nodeId: n.id,
              nodeName: n.name,
              property: 'gap',
              bindingTarget: { field: 'itemSpacing' },
              currentValue: itemSpacing,
              isEditableHere,
              containerInstanceId: current.parentInstanceId,
              suggestion,
              alternativeSuggestions: alternatives,
            });
          }
        }

        // Check each padding edge independently. Collapsing four edges into a
        // single issue would destroy asymmetric padding when applying a token.
        const paddingFields = [
          ['paddingTop', 'paddingTop' in n ? n.paddingTop : undefined],
          ['paddingRight', 'paddingRight' in n ? n.paddingRight : undefined],
          ['paddingBottom', 'paddingBottom' in n ? n.paddingBottom : undefined],
          ['paddingLeft', 'paddingLeft' in n ? n.paddingLeft : undefined],
        ] as const;

        for (const [field, paddingValue] of paddingFields) {
          if (typeof paddingValue !== 'number' || paddingValue <= 0) continue;
          const hasBoundVar = hasBoundVariable(field);
          if (hasBoundVar) {
            boundPropertiesCount++;
            continue;
          }

          const inferred = await readInferredVariable(inferredVariables, field, variableMap);
          const { suggestion, alternatives } = await rankAndVerifySuggestions({
            node: n,
            property: 'padding',
            currentValue: paddingValue,
            inferredVariable: inferred,
            candidateIndex: tokenCandidateIndex,
            nodeName: n.name,
            resolutionCache: consumerResolutionCache,
            variableMap,
          });

          issues.push({
            id: `${n.id}:padding:${field}`,
            nodeId: n.id,
            nodeName: n.name,
            property: 'padding',
            bindingTarget: { field },
            currentValue: paddingValue,
            isEditableHere,
            containerInstanceId: current.parentInstanceId,
            suggestion,
            alternativeSuggestions: alternatives,
          });
        }
      }

      // Opacity is tokenizable independently of color. Ignore the default 1
      // because it does not represent an intentional raw opacity value.
      const opacity = 'opacity' in n ? n.opacity : undefined;
      if (typeof opacity === 'number' && opacity >= 0 && opacity < 1) {
        const hasBoundVar = hasBoundVariable('opacity');
        if (hasBoundVar) {
          boundPropertiesCount++;
        } else {
          const inferred = await readInferredVariable(inferredVariables, 'opacity', variableMap);
          const { suggestion, alternatives } = await rankAndVerifySuggestions({
            node: n,
            property: 'opacity',
            currentValue: opacity,
            inferredVariable: inferred,
            candidateIndex: tokenCandidateIndex,
            nodeName: n.name,
            resolutionCache: consumerResolutionCache,
            variableMap,
          });
          issues.push({
            id: `${n.id}:opacity`,
            nodeId: n.id,
            nodeName: n.name,
            property: 'opacity',
            bindingTarget: { field: 'opacity' },
            currentValue: opacity,
            isEditableHere,
            containerInstanceId: current.parentInstanceId,
            suggestion,
            alternativeSuggestions: alternatives,
          });
        }
      }

      } catch {
        // Continue scanning remaining nodes even if one node fails
      }
    }

    const tokenAudit = calculateTokenAuditSummary(boundPropertiesCount, issues);

    const scanResult: DesignHealthScanResult = {
      scanId,
      targetNode: {
        id: targetNode.id,
        name: targetNode.name,
        type: targetNode.type,
      },
      tokenAudit,
      libraryHealth: {
        totalInstances,
        uniqueComponentsCount: uniqueComponentKeys.size,
        deprecatedInstances,
        updateAvailableInstances,
        remoteInstancesCount,
        localInstancesCount,
        currentRemoteInstancesCount,
        updateCheckFailuresCount,
      },
      nodesVisited: traversal.nodesVisited,
      capReached: traversal.capReached,
      selectionCount,
      scannedAt: Date.now(),
    };

    if (scanId !== latestScanId) {
      return;
    }

    emit<ScanDesignHealthResultHandler>('SCAN_DESIGN_HEALTH_RESULT', {
      ok: true,
      scanId,
      scanResult,
    });
  } catch (error) {
    if (scanId !== latestScanId) {
      return;
    }
    emit<ScanDesignHealthResultHandler>('SCAN_DESIGN_HEALTH_RESULT', {
      ok: false,
      scanId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function applyTokenBindings(
  operationId: string,
  bindings: TokenBindingRequest[],
): Promise<void> {
  let boundCount = 0;
  let failedCount = 0;

  const nodeMap = new Map<string, BaseNode>();
  const variableMap = new Map<string, Variable>();
  await prefetchBindingTargets(bindings, nodeMap, variableMap);

  for (const req of bindings) {
    try {
      const node = nodeMap.get(req.nodeId);
      const variable = variableMap.get(req.variableId);

      if (!node || !variable || !('type' in node) || ('removed' in node && node.removed)) {
        throw new Error('Binding target or variable is no longer available.');
      }

      applyTokenBindingToTarget(node as SceneNode, variable, req);
      boundCount++;
    } catch {
      failedCount++;
    }
  }

  if (boundCount > 0) {
    figma.commitUndo();
  }

  const ok = failedCount === 0;
  emit<ApplyTokenBindingsResultHandler>('APPLY_TOKEN_BINDINGS_RESULT', {
    ok,
    operationId,
    boundCount,
    failedCount,
    message: failedCount === 0
      ? `Successfully bound ${boundCount} properties to design tokens.`
      : `Bound ${boundCount} properties; ${failedCount} could not be updated. Review the remaining findings.`,
  });
}

export async function applyLibraryUpdates(
  operationId: string,
  nodeIds: readonly string[],
): Promise<void> {
  const uniqueNodeIds = Array.from(new Set(nodeIds));
  const instancesById = new Map<string, InstanceNode>();

  for (let start = 0; start < uniqueNodeIds.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    const chunk = uniqueNodeIds.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    await Promise.all(chunk.map(async (nodeId) => {
      try {
        const node = await figma.getNodeByIdAsync(nodeId);
        if (node?.type === 'INSTANCE' && !node.removed) {
          instancesById.set(nodeId, node);
        }
      } catch {
        // Missing/inaccessible targets are counted while applying below.
      }
    }));
  }

  const mainComponentsByInstanceId = new Map<string, ComponentNode | null>();
  const instances = Array.from(instancesById.values());
  for (let start = 0; start < instances.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    const chunk = instances.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const resolved = await Promise.all(chunk.map(async (instance) => {
      try {
        return [instance.id, await instance.getMainComponentAsync()] as const;
      } catch {
        return [instance.id, null] as const;
      }
    }));
    for (const [nodeId, component] of resolved) {
      mainComponentsByInstanceId.set(nodeId, component);
    }
  }

  const componentKeys = new Set<string>();
  for (const component of mainComponentsByInstanceId.values()) {
    if (component?.remote && component.key) {
      componentKeys.add(component.key);
    }
  }

  const latestComponentsByKey = new Map<string, ComponentNode | null>();
  const keys = Array.from(componentKeys);
  for (let start = 0; start < keys.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    const chunk = keys.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const imported = await Promise.all(chunk.map(async (key) => {
      try {
        return [key, await figma.importComponentByKeyAsync(key)] as const;
      } catch {
        return [key, null] as const;
      }
    }));
    for (const [key, component] of imported) {
      latestComponentsByKey.set(key, component);
    }
  }

  let updatedCount = 0;
  let currentCount = 0;
  let failedCount = 0;

  for (const nodeId of uniqueNodeIds) {
    try {
      const instance = instancesById.get(nodeId);
      const currentComponent = mainComponentsByInstanceId.get(nodeId) ?? null;
      if (!instance || !currentComponent?.remote || !currentComponent.key) {
        throw new Error('Library update target is no longer available.');
      }

      const latestComponent = latestComponentsByKey.get(currentComponent.key) ?? null;
      if (!latestComponent) {
        throw new Error('Latest library component could not be loaded.');
      }
      if (latestComponent.id === currentComponent.id) {
        currentCount++;
        continue;
      }

      instance.swapComponent(latestComponent);
      updatedCount++;
    } catch {
      failedCount++;
    }
  }

  if (updatedCount > 0) {
    figma.commitUndo();
  }

  const ok = failedCount === 0;
  let message: string;
  if (uniqueNodeIds.length === 0) {
    message = 'No library instances were selected for update.';
  } else if (failedCount > 0) {
    message = `Updated ${updatedCount} instances; ${currentCount} were already current; ${failedCount} could not be updated.`;
  } else if (updatedCount === 0) {
    message = `All ${currentCount} selected library instances are already current.`;
  } else {
    message = `Successfully updated ${updatedCount} library instances.${currentCount > 0 ? ` ${currentCount} were already current.` : ''}`;
  }

  emit<ApplyLibraryUpdatesResultHandler>('APPLY_LIBRARY_UPDATES_RESULT', {
    ok,
    operationId,
    updatedCount,
    currentCount,
    failedCount,
    message,
  });
}

const BINDING_LOOKUP_CHUNK_SIZE = 25;

async function prefetchBindingTargets(
  bindings: readonly TokenBindingRequest[],
  nodeMap: Map<string, BaseNode>,
  variableMap: Map<string, Variable>,
): Promise<void> {
  const tasks: Array<
    | {kind: 'node'; id: string}
    | {kind: 'variable'; id: string}
  > = [
    ...Array.from(new Set(bindings.map((binding) => binding.nodeId))).map((id) => ({
      kind: 'node' as const,
      id,
    })),
    ...Array.from(new Set(bindings.map((binding) => binding.variableId))).map((id) => ({
      kind: 'variable' as const,
      id,
    })),
  ];

  for (let start = 0; start < tasks.length; start += BINDING_LOOKUP_CHUNK_SIZE) {
    const chunk = tasks.slice(start, start + BINDING_LOOKUP_CHUNK_SIZE);
    await Promise.all(
      chunk.map(async (task) => {
        try {
          if (task.kind === 'node') {
            const node = await figma.getNodeByIdAsync(task.id);
            if (node) nodeMap.set(task.id, node);
            return;
          }

          const variable = await figma.variables.getVariableByIdAsync(task.id);
          if (variable) variableMap.set(task.id, variable);
        } catch {
          // A failed lookup is counted per binding while the batch is applied below.
        }
      }),
    );
  }
}

function applyTokenBindingToTarget(
  node: SceneNode,
  variable: Variable,
  request: TokenBindingRequest,
): void {
  const { field, paintIndex } = request.bindingTarget;

  if (field === 'fills' || field === 'strokes') {
    if (paintIndex === undefined || !(field in node)) {
      throw new Error('Paint binding target is incomplete.');
    }
    const paints = field === 'fills'
      ? (node as SceneNode & MinimalFillsMixin).fills
      : (node as SceneNode & MinimalStrokesMixin).strokes;
    if (!Array.isArray(paints) || paintIndex < 0 || paintIndex >= paints.length) {
      throw new Error('Paint binding target changed after the scan.');
    }
    const paint = paints[paintIndex];
    if (paint.type !== 'SOLID') {
      throw new Error('Only solid paints can be bound to color variables.');
    }
    const nextPaints = [...paints];
    nextPaints[paintIndex] = figma.variables.setBoundVariableForPaint(paint, 'color', variable);
    if (field === 'fills') {
      (node as SceneNode & MinimalFillsMixin).fills = nextPaints;
    } else {
      (node as SceneNode & MinimalStrokesMixin).strokes = nextPaints;
    }
    return;
  }

  if (!('setBoundVariable' in node)) {
    throw new Error('This node does not support variable bindings.');
  }

  switch (field) {
    case 'cornerRadius':
      node.setBoundVariable('cornerRadius', variable);
      return;
    case 'itemSpacing':
      node.setBoundVariable('itemSpacing', variable);
      return;
    case 'paddingTop':
      node.setBoundVariable('paddingTop', variable);
      return;
    case 'paddingRight':
      node.setBoundVariable('paddingRight', variable);
      return;
    case 'paddingBottom':
      node.setBoundVariable('paddingBottom', variable);
      return;
    case 'paddingLeft':
      node.setBoundVariable('paddingLeft', variable);
      return;
    case 'opacity':
      node.setBoundVariable('opacity', variable);
      return;
    default:
      throw new Error(`Unsupported binding field: ${field}`);
  }
}

export async function focusNodeOnCanvas(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node && 'type' in node) {
    // The reveal IS the selection: Figma's own selection chrome identifies the
    // layer in both themes. The selectionchange this assignment fires is
    // armed here and consumed exactly once in main.ts, so it never rescans
    // the audit the user is reading.
    const sceneNode = node as SceneNode;
    const currentSelection = figma.currentPage.selection;
    if (currentSelection.length !== 1 || currentSelection[0]?.id !== sceneNode.id) {
      armProgrammaticSelection(sceneNode);
      figma.currentPage.selection = [sceneNode];
    }
    figma.viewport.scrollAndZoomIntoView([sceneNode]);
  }
}

function collectAuditTraversal(
  root: SceneNode,
  maxNodes = MAX_SCAN_NODES,
): AuditTraversalSnapshot {
  const pending: Array<{
    node: SceneNode;
    isInsideInstance: boolean;
    parentInstanceId?: string;
  }> = [{
    node: root,
    isInsideInstance: root.type === 'INSTANCE',
    parentInstanceId: root.type === 'INSTANCE' ? root.id : undefined,
  }];
  const nodes: AuditNodeSnapshot[] = [];
  const referencedVariableIds = new Set<string>();
  let cursor = 0;
  let nodesVisited = 0;

  while (cursor < pending.length && nodesVisited < maxNodes) {
    const current = pending[cursor++];
    const node = current.node;
    nodesVisited++;

    if ('removed' in node && node.removed) continue;

    const fills = readPaints(node, 'fills');
    const strokes = readPaints(node, 'strokes');
    const boundVariables = readBoundVariables(node);
    const inferredVariables = readInferredVariables(node);
    collectVariableIds(boundVariables, referencedVariableIds);
    collectPaintVariableIds(fills, referencedVariableIds);
    collectPaintVariableIds(strokes, referencedVariableIds);
    collectVariableIds(inferredVariables, referencedVariableIds);

    nodes.push({
      ...current,
      fills,
      strokes,
      boundVariables,
      inferredVariables,
    });

    // Component instances stay atomic. The selected root instance is the one
    // exception because selecting it explicitly requests its own subtree.
    try {
      if ('children' in node) {
        const children = node.children;
        if (Array.isArray(children) && (node.type !== 'INSTANCE' || node.id === root.id)) {
          for (const child of children) {
            pending.push({
              node: child,
              isInsideInstance: current.isInsideInstance || node.type === 'INSTANCE',
              parentInstanceId: current.parentInstanceId
                || (node.type === 'INSTANCE' ? node.id : undefined),
            });
          }
        }
      }
    } catch {
      // A node whose children are unavailable remains auditable on its own.
    }
  }

  return {
    nodes,
    referencedVariableIds,
    nodesVisited,
    capReached: cursor < pending.length,
  };
}

function readPaints(
  node: SceneNode,
  field: 'fills' | 'strokes',
): readonly Paint[] | undefined {
  try {
    if (field === 'fills' && 'fills' in node) {
      const fills = node.fills;
      return Array.isArray(fills) ? fills : undefined;
    }
    if (field === 'strokes' && 'strokes' in node) {
      const strokes = node.strokes;
      return Array.isArray(strokes) ? strokes : undefined;
    }
  } catch {
    // The remaining property groups and descendants can still be audited.
  }
  return undefined;
}

function readBoundVariables(
  node: SceneNode,
): Record<string, VariableAlias | VariableAlias[]> | undefined {
  try {
    if ('boundVariables' in node) {
      return node.boundVariables as Record<string, VariableAlias | VariableAlias[]> | undefined;
    }
  } catch {
    // The remaining property groups and descendants can still be audited.
  }
  return undefined;
}

function readInferredVariables(node: SceneNode): Record<string, unknown> | undefined {
  try {
    if ('inferredVariables' in node) {
      return node.inferredVariables as Record<string, unknown> | undefined;
    }
  } catch {
    // The remaining property groups and descendants can still be audited.
  }
  return undefined;
}

function collectPaintVariableIds(
  paints: readonly Paint[] | undefined,
  idSet: Set<string>,
): void {
  if (!paints) return;
  for (const paint of paints) {
    if ('boundVariables' in paint && paint.boundVariables?.color?.id) {
      idSet.add(paint.boundVariables.color.id);
    }
  }
}

function collectVariableIds(
  values: Record<string, unknown> | undefined,
  idSet: Set<string>,
): void {
  if (!values) return;
  for (const value of Object.values(values)) {
    collectVariableIdsFromValue(value, idSet);
  }
}

function collectVariableIdsFromValue(value: unknown, idSet: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectVariableIdsFromValue(item, idSet);
    }
    return;
  }
  if (value && typeof value === 'object' && 'id' in value) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === 'string') {
      idSet.add(id);
    }
  }
}

async function readInferredVariable(
  inferredVariables: Record<string, unknown> | undefined,
  prop: string,
  variableMap: Map<string, Variable>,
  paintIndex?: number,
): Promise<{ id: string; name: string; key?: string } | undefined> {
  try {
    if (!inferredVariables) {
      return undefined;
    }
    const inferred = inferredVariables[prop];
    if (!inferred) return undefined;

  let aliasId: string | undefined;

  if (Array.isArray(inferred) && inferred.length > 0) {
    const first = paintIndex === undefined ? inferred[0] : inferred[paintIndex];
    if (Array.isArray(first) && first.length > 0) {
      const alias = first[0] as { type?: string; id?: string } | undefined;
      if (alias && typeof alias.id === 'string') {
        aliasId = alias.id;
      }
    } else if (typeof first === 'object' && first !== null && 'id' in first) {
      const alias = first as { type?: string; id?: string };
      if (typeof alias.id === 'string') {
        aliasId = alias.id;
      }
    }
  } else if (typeof inferred === 'object' && inferred !== null && 'id' in inferred) {
    const alias = inferred as { id: string };
    if (typeof alias.id === 'string') {
      aliasId = alias.id;
    }
  }

  if (!aliasId) return undefined;

  let v: Variable | null | undefined = variableMap.get(aliasId);
  if (!v) {
    try {
      v = await figma.variables.getVariableByIdAsync(aliasId);
      if (v) {
        variableMap.set(v.id, v);
      }
    } catch {
      // ignore
    }
  }

  if (v) {
    return {
      id: v.id,
      name: v.name,
      key: v.key,
    };
  }

  return {
    id: aliasId,
    name: aliasId,
  };
  } catch {
    return undefined;
  }
}

function getBoundPaintVariable(
  boundVariables: Record<string, VariableAlias | VariableAlias[]> | undefined,
  field: 'fills' | 'strokes',
  paintIndex: number,
): VariableAlias | undefined {
  const aliases = boundVariables?.[field];
  return Array.isArray(aliases) ? aliases[paintIndex] : undefined;
}

/**
 * Rank same-value token candidates and verify the top suggestions against the
 * consuming node. Candidate values come from the audit root's variable-mode
 * context; cached per-consumer verification keeps a mode switch inside the
 * selection from ever offering a token whose value on this node differs from
 * the layer's raw value.
 */
async function rankAndVerifySuggestions(params: {
  node: SceneNode;
  property: TokenPropertyKind;
  currentValue: string | number;
  inferredVariable?: { id: string; name: string; key?: string };
  candidateIndex: TokenCandidateIndex;
  nodeName?: string;
  resolutionCache: ConsumerResolutionCache;
  variableMap: Map<string, Variable>;
}): Promise<{ suggestion?: TokenSuggestion; alternatives?: TokenSuggestion[] }> {
  const {
    node,
    property,
    currentValue,
    inferredVariable,
    candidateIndex,
    nodeName,
    resolutionCache,
    variableMap,
  } = params;
  const ranked = rankTokenSuggestion({
    property,
    currentValue,
    inferredVariable,
    candidateIndex,
    nodeName,
  });
  const isExactMatch = ranked.suggestion?.source === 'exact-value'
    || ranked.suggestion?.source === 'scope-match';
  if (!ranked.suggestion || !isExactMatch) {
    // Inferred matches were resolved by Figma for this exact node; near-value
    // and name-match suggestions intentionally propose a different value and
    // must not be re-verified against the layer's raw value.
    return ranked;
  }

  const all = [ranked.suggestion, ...(ranked.alternatives ?? [])];
  let verified: TokenSuggestion | undefined;
  // Cap verification so a worst-case property still costs only a handful of
  // bridge calls instead of one per library token.
  for (const candidate of all.slice(0, 3)) {
    const variable = variableMap.get(candidate.variableId);
    if (!variable) continue;
    const resolved = resolveVariableForConsumerCached(variable, node, resolutionCache);
    if (resolved.value !== undefined && isValueEqual(resolved.value, currentValue)) {
      verified = candidate;
      break;
    }
  }
  if (!verified) {
    // No token holds this value under the node's own mode context. Near/name
    // alternatives remain valid (their values differ by design), so promote
    // them instead of discarding the whole ranking.
    const proximityAlternatives = all.filter(
      (candidate) => candidate.source === 'near-value' || candidate.source === 'name-match',
    );
    if (proximityAlternatives.length > 0) {
      return {
        suggestion: proximityAlternatives[0],
        alternatives: proximityAlternatives.length > 1 ? proximityAlternatives.slice(1) : undefined,
      };
    }
    // Reporting no match is safer than a binding that would change the layer's appearance.
    return {};
  }
  const alternatives = all.filter((candidate) => candidate.variableId !== verified!.variableId);
  return {
    suggestion: verified,
    alternatives: alternatives.length > 0 ? alternatives : undefined,
  };
}

async function fetchVariablesChunked(
  variableIds: readonly string[],
  variableMap: Map<string, Variable>,
  scanId: string,
): Promise<boolean> {
  const uniqueVariableIds = Array.from(new Set(variableIds));
  for (let start = 0; start < uniqueVariableIds.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    if (scanId !== latestScanId) {
      return false;
    }
    const slice = uniqueVariableIds.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const variables = await Promise.all(slice.map(async (id) => {
      try {
        return await figma.variables.getVariableByIdAsync(id);
      } catch {
        return null;
      }
    }));
    if (scanId !== latestScanId) {
      return false;
    }
    for (const v of variables) {
      if (v) {
        variableMap.set(v.id, v);
      }
    }
  }
  return true;
}

async function fetchVariableCollectionsChunked(
  collectionIds: readonly string[],
  scanId: string,
): Promise<VariableCollection[] | undefined> {
  const uniqueCollectionIds = Array.from(new Set(collectionIds));
  const collections: VariableCollection[] = [];
  for (let start = 0; start < uniqueCollectionIds.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    if (scanId !== latestScanId) {
      return undefined;
    }
    const slice = uniqueCollectionIds.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const fetched = await Promise.all(slice.map(async (id) => {
      try {
        return await figma.variables.getVariableCollectionByIdAsync(id);
      } catch {
        return null;
      }
    }));
    if (scanId !== latestScanId) {
      return undefined;
    }
    for (const collection of fetched) {
      if (collection) {
        collections.push(collection);
      }
    }
  }
  return collections;
}

async function fetchMainComponentsChunked(
  snapshots: readonly AuditNodeSnapshot[],
  scanId: string,
): Promise<Map<string, ComponentNode | null> | undefined> {
  const instancesById = new Map<string, InstanceNode>();
  for (const snapshot of snapshots) {
    if (snapshot.node.type === 'INSTANCE') {
      instancesById.set(snapshot.node.id, snapshot.node);
    }
  }

  const instances = Array.from(instancesById.values());
  const mainComponents = new Map<string, ComponentNode | null>();
  for (let start = 0; start < instances.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    if (scanId !== latestScanId) {
      return undefined;
    }
    const chunk = instances.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const fetched = await Promise.all(chunk.map(async (instance) => {
      try {
        return [instance.id, await instance.getMainComponentAsync()] as const;
      } catch {
        return [instance.id, null] as const;
      }
    }));
    if (scanId !== latestScanId) {
      return undefined;
    }
    for (const [instanceId, mainComponent] of fetched) {
      mainComponents.set(instanceId, mainComponent);
    }
  }
  return mainComponents;
}

async function fetchLatestRemoteComponentsChunked(
  mainComponentsByInstanceId: ReadonlyMap<string, ComponentNode | null>,
  scanId: string,
): Promise<Map<string, ComponentNode | null> | undefined> {
  const componentKeys = new Set<string>();
  for (const component of mainComponentsByInstanceId.values()) {
    if (component?.remote && component.key) {
      componentKeys.add(component.key);
    }
  }

  const keys = Array.from(componentKeys);
  const latestComponents = new Map<string, ComponentNode | null>();
  for (let start = 0; start < keys.length; start += FIGMA_LOOKUP_CHUNK_SIZE) {
    if (scanId !== latestScanId) {
      return undefined;
    }
    const chunk = keys.slice(start, start + FIGMA_LOOKUP_CHUNK_SIZE);
    const fetched = await Promise.all(chunk.map(async (key) => {
      try {
        return [key, await figma.importComponentByKeyAsync(key)] as const;
      } catch {
        return [key, null] as const;
      }
    }));
    if (scanId !== latestScanId) {
      return undefined;
    }
    for (const [key, component] of fetched) {
      latestComponents.set(key, component);
    }
  }
  return latestComponents;
}

function createTokenCandidatesForConsumer(
  variables: readonly Variable[],
  consumer: SceneNode,
  resolutionCache: ConsumerResolutionCache,
): TokenCandidateInput[] {
  const candidates: TokenCandidateInput[] = [];
  for (const variable of variables) {
    const resolved = resolveVariableForConsumerCached(variable, consumer, resolutionCache);
    if (resolved.value === undefined || resolved.resolvedType === undefined) continue;
    candidates.push({
      variableId: variable.id,
      variableName: variable.name,
      variableKey: variable.key,
      resolvedType: resolved.resolvedType,
      scopes: variable.scopes,
      value: resolved.value,
    });
  }
  return candidates;
}

function resolveVariableForConsumerCached(
  variable: Variable,
  consumer: SceneNode,
  cache: ConsumerResolutionCache,
): ConsumerResolution {
  let nodeCache = cache.get(consumer);
  if (!nodeCache) {
    nodeCache = new Map();
    cache.set(consumer, nodeCache);
  }

  const cached = nodeCache.get(variable.id);
  if (cached) {
    return cached;
  }

  let resolution: ConsumerResolution = {};
  try {
    const resolved = variable.resolveForConsumer(consumer);
    resolution = {
      resolvedType: resolved.resolvedType,
      value: normalizeResolvedTokenValue(resolved.value, resolved.resolvedType),
    };
  } catch {
    // Failed resolutions are cached too so sibling properties do not retry.
  }
  nodeCache.set(variable.id, resolution);
  return resolution;
}

function normalizeResolvedTokenValue(
  value: VariableValue,
  resolvedType: VariableResolvedDataType,
): string | number | undefined {
  if (resolvedType === 'COLOR' && typeof value === 'object' && 'r' in value) {
    return colorToHex(value, 'a' in value ? value.a : undefined);
  }
  if (resolvedType === 'FLOAT' && typeof value === 'number') return value;
  if (resolvedType === 'STRING' && typeof value === 'string') return value;
  return undefined;
}

function colorToHex(
  color: { r: number; g: number; b: number },
  alpha?: number,
): string {
  const toHex = (val: number) => {
    const hex = Math.round(Math.max(0, Math.min(1, val)) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  const rgb = `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
  const normalizedAlpha = alpha ?? 1;
  return normalizedAlpha < 0.999
    ? `${rgb}${toHex(normalizedAlpha)}`.toUpperCase()
    : rgb.toUpperCase();
}
