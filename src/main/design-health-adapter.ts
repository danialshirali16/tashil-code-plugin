import { emit } from '@create-figma-plugin/utilities';
import {
  calculateTokenAuditSummary,
  rankTokenSuggestion,
  type TokenCandidateInput,
} from '../design-health/token-audit';
import {
  buildCompatibilityPlan,
  normalizePropertyName,
} from '../design-health/replacement-plan';
import type {
  ComponentPropertyDescriptor,
  ComponentDescriptor,
} from '../design-health/replacement-plan';
import type {
  ComponentReplacementCandidate,
  ComponentReplacementExecutionRequest,
  DeprecatedInstanceNotice,
  DesignHealthScanResult,
  TokenBindingRequest,
  TokenPropertyIssue,
} from '../design-health/types';
import type {
  ApplyTokenBindingsResultHandler,
  BuildCompatibilityPlanResultHandler,
  ExecuteComponentReplacementResultHandler,
  ScanDesignHealthResultHandler,
} from '../types';

let latestScanId = '';

export async function scanDesignHealth(
  scanId: string,
  targetNodeId?: string,
): Promise<void> {
  latestScanId = scanId;

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

    // 1. Build comprehensive variable map from local collections and referenced document variables
    const variableMap = new Map<string, Variable>();

    // Local variables
    try {
      const localVariables = await figma.variables.getLocalVariablesAsync();
      for (const v of localVariables) {
        variableMap.set(v.id, v);
      }
    } catch {
      // ignore
    }

    // Local variable collections
    try {
      const localCollections = await figma.variables.getLocalVariableCollectionsAsync();
      for (const col of localCollections) {
        for (const varId of col.variableIds) {
          if (!variableMap.has(varId)) {
            const v = await figma.variables.getVariableByIdAsync(varId);
            if (v) variableMap.set(v.id, v);
          }
        }
      }
    } catch {
      // ignore
    }

    // Fast-scan bound and inferred variables in target subtree to discover referenced collections
    const referencedVarIds = new Set<string>();
    collectVariableReferences(targetNode, referencedVarIds, 400);

    const collectionIdsToExpand = new Set<string>();
    for (const varId of referencedVarIds) {
      if (!variableMap.has(varId)) {
        try {
          const v = await figma.variables.getVariableByIdAsync(varId);
          if (v) {
            variableMap.set(v.id, v);
            if (v.variableCollectionId) {
              collectionIdsToExpand.add(v.variableCollectionId);
            }
          }
        } catch {
          // ignore
        }
      } else {
        const existing = variableMap.get(varId);
        if (existing?.variableCollectionId) {
          collectionIdsToExpand.add(existing.variableCollectionId);
        }
      }
    }

    // Expand all sister variables in referenced collections (discovers full library token set locally)
    for (const colId of collectionIdsToExpand) {
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(colId);
        if (col && Array.isArray(col.variableIds)) {
          for (const varId of col.variableIds) {
            if (!variableMap.has(varId)) {
              const v = await figma.variables.getVariableByIdAsync(varId);
              if (v) variableMap.set(v.id, v);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // Resolve values for each consuming node later so variable modes and alias
    // chains follow that node's explicit/inherited mode configuration.
    const variableList = Array.from(variableMap.values());
    const tokenCandidatesByNodeId = new Map<string, TokenCandidateInput[]>();
    const getAvailableTokens = (consumer: SceneNode): TokenCandidateInput[] => {
      const cached = tokenCandidatesByNodeId.get(consumer.id);
      if (cached) return cached;
      const resolved = createTokenCandidatesForConsumer(variableList, consumer);
      tokenCandidatesByNodeId.set(consumer.id, resolved);
      return resolved;
    };

    // Traverse the subtree
    const issues: TokenPropertyIssue[] = [];
    let boundPropertiesCount = 0;
    const componentCandidatesMap = new Map<string, {
      sourceComponentName: string;
      instanceIds: string[];
    }>();
    const deprecatedInstances: DeprecatedInstanceNotice[] = [];
    let remoteInstancesCount = 0;
    let localInstancesCount = 0;
    let totalInstances = 0;

    // BFS/DFS walk with depth limit
    const nodesToWalk: Array<{ node: SceneNode; isInsideInstance: boolean; parentInstanceId?: string }> = [
      { node: targetNode, isInsideInstance: targetNode.type === 'INSTANCE', parentInstanceId: targetNode.type === 'INSTANCE' ? targetNode.id : undefined },
    ];

    let visitedCount = 0;
    const MAX_NODES = 800; // Safeguard against massive documents

    while (nodesToWalk.length > 0 && visitedCount < MAX_NODES) {
      if (scanId !== latestScanId) {
        // Cancelled by a newer scan
        return;
      }

      visitedCount++;
      const current = nodesToWalk.shift()!;
      const n = current.node;

      if ('removed' in n && n.removed) {
        continue;
      }

      try {
        const isEditableHere = !current.isInsideInstance || n.id === current.parentInstanceId;

        // Check Component Instances
        if (n.type === 'INSTANCE') {
          totalInstances++;
          let mainComp: ComponentNode | null = null;
          try {
            mainComp = await n.getMainComponentAsync();
          } catch {
            mainComp = null;
          }
          if (scanId !== latestScanId) {
            return;
          }
          if (mainComp) {
            if (mainComp.remote) {
              remoteInstancesCount++;
            } else {
              localInstancesCount++;
            }

            const compKey = mainComp.key || mainComp.id;
            const compName = mainComp.name;

            const existingCandidate = componentCandidatesMap.get(compKey);
            if (existingCandidate) {
              existingCandidate.instanceIds.push(n.id);
            } else {
              componentCandidatesMap.set(compKey, {
                sourceComponentName: compName,
                instanceIds: [n.id],
              });
            }

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
          }
        }

      // Check Fills (Colors)
      if ('fills' in n && Array.isArray(n.fills)) {
        for (let paintIndex = 0; paintIndex < n.fills.length; paintIndex += 1) {
          const paint = n.fills[paintIndex];
          if (paint.type === 'SOLID' && paint.visible !== false) {
            const hasBoundVar = Boolean(
              paint.boundVariables?.color || getBoundPaintVariable(n, 'fills', paintIndex),
            );
            if (hasBoundVar) {
              boundPropertiesCount++;
            } else {
              const hex = colorToHex(paint.color, paint.opacity);
              const inferred = await readInferredVariable(n, 'fills', variableMap, paintIndex);
              const { suggestion, alternatives } = rankTokenSuggestion({
                property: 'fill',
                currentValue: hex,
                inferredVariable: inferred,
                availableTokens: getAvailableTokens(n),
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
      if ('strokes' in n && Array.isArray(n.strokes)) {
        for (let paintIndex = 0; paintIndex < n.strokes.length; paintIndex += 1) {
          const paint = n.strokes[paintIndex];
          if (paint.type === 'SOLID' && paint.visible !== false) {
            const hasBoundVar = Boolean(
              paint.boundVariables?.color || getBoundPaintVariable(n, 'strokes', paintIndex),
            );
            if (hasBoundVar) {
              boundPropertiesCount++;
            } else {
              const hex = colorToHex(paint.color, paint.opacity);
              const inferred = await readInferredVariable(n, 'strokes', variableMap, paintIndex);
              const { suggestion, alternatives } = rankTokenSuggestion({
                property: 'stroke',
                currentValue: hex,
                inferredVariable: inferred,
                availableTokens: getAvailableTokens(n),
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
      if ('cornerRadius' in n && typeof n.cornerRadius === 'number' && n.cornerRadius > 0) {
        const hasBoundVar = Boolean(
          (n.boundVariables && 'cornerRadius' in n.boundVariables) ||
          (n.boundVariables && 'topLeftRadius' in n.boundVariables),
        );
        if (hasBoundVar) {
          boundPropertiesCount++;
        } else {
          const inferred = (await readInferredVariable(n, 'cornerRadius', variableMap))
            || (await readInferredVariable(n, 'topLeftRadius', variableMap));
          const { suggestion, alternatives } = rankTokenSuggestion({
            property: 'cornerRadius',
            currentValue: n.cornerRadius,
            inferredVariable: inferred,
            availableTokens: getAvailableTokens(n),
          });

          issues.push({
            id: `${n.id}:cornerRadius`,
            nodeId: n.id,
            nodeName: n.name,
            property: 'cornerRadius',
            bindingTarget: { field: 'cornerRadius' },
            currentValue: n.cornerRadius,
            isEditableHere,
            containerInstanceId: current.parentInstanceId,
            suggestion,
            alternativeSuggestions: alternatives,
          });
        }
      }

      // Check Layout Gap (itemSpacing)
      if ('layoutMode' in n && n.layoutMode !== 'NONE') {
        if (typeof n.itemSpacing === 'number' && n.itemSpacing > 0) {
          const hasBoundVar = Boolean(n.boundVariables && 'itemSpacing' in n.boundVariables);
          if (hasBoundVar) {
            boundPropertiesCount++;
          } else {
            const inferred = await readInferredVariable(n, 'itemSpacing', variableMap);
            const { suggestion, alternatives } = rankTokenSuggestion({
              property: 'gap',
              currentValue: n.itemSpacing,
              inferredVariable: inferred,
              availableTokens: getAvailableTokens(n),
            });

            issues.push({
              id: `${n.id}:gap`,
              nodeId: n.id,
              nodeName: n.name,
              property: 'gap',
              bindingTarget: { field: 'itemSpacing' },
              currentValue: n.itemSpacing,
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
          ['paddingTop', n.paddingTop],
          ['paddingRight', n.paddingRight],
          ['paddingBottom', n.paddingBottom],
          ['paddingLeft', n.paddingLeft],
        ] as const;

        for (const [field, paddingValue] of paddingFields) {
          if (typeof paddingValue !== 'number' || paddingValue <= 0) continue;
          const hasBoundVar = Boolean(n.boundVariables && field in n.boundVariables);
          if (hasBoundVar) {
            boundPropertiesCount++;
            continue;
          }

          const inferred = await readInferredVariable(n, field, variableMap);
          const { suggestion, alternatives } = rankTokenSuggestion({
            property: 'padding',
            currentValue: paddingValue,
            inferredVariable: inferred,
            availableTokens: getAvailableTokens(n),
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
      if ('opacity' in n && typeof n.opacity === 'number' && n.opacity >= 0 && n.opacity < 1) {
        const hasBoundVar = Boolean(n.boundVariables && 'opacity' in n.boundVariables);
        if (hasBoundVar) {
          boundPropertiesCount++;
        } else {
          const inferred = await readInferredVariable(n, 'opacity', variableMap);
          const { suggestion, alternatives } = rankTokenSuggestion({
            property: 'opacity',
            currentValue: n.opacity,
            inferredVariable: inferred,
            availableTokens: getAvailableTokens(n),
          });
          issues.push({
            id: `${n.id}:opacity`,
            nodeId: n.id,
            nodeName: n.name,
            property: 'opacity',
            bindingTarget: { field: 'opacity' },
            currentValue: n.opacity,
            isEditableHere,
            containerInstanceId: current.parentInstanceId,
            suggestion,
            alternativeSuggestions: alternatives,
          });
        }
      }

        // Recurse children
        if ('children' in n && Array.isArray(n.children)) {
          for (const child of n.children) {
            nodesToWalk.push({
              node: child,
              isInsideInstance: current.isInsideInstance || n.type === 'INSTANCE',
              parentInstanceId: current.parentInstanceId || (n.type === 'INSTANCE' ? n.id : undefined),
            });
          }
        }
      } catch {
        // Continue scanning remaining nodes even if one node fails
      }
    }

    const tokenAudit = calculateTokenAuditSummary(boundPropertiesCount, issues);

    const componentCandidates: ComponentReplacementCandidate[] = [];
    for (const [key, data] of componentCandidatesMap.entries()) {
      componentCandidates.push({
        sourceComponentKey: key,
        sourceComponentName: data.sourceComponentName,
        instancesCount: data.instanceIds.length,
        instanceIds: data.instanceIds,
      });
    }

    const scanResult: DesignHealthScanResult = {
      scanId,
      targetNode: {
        id: targetNode.id,
        name: targetNode.name,
        type: targetNode.type,
      },
      tokenAudit,
      componentCandidates,
      libraryHealth: {
        totalInstances,
        uniqueComponentsCount: componentCandidates.length,
        deprecatedInstances,
        remoteInstancesCount,
        localInstancesCount,
      },
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

  for (const req of bindings) {
    try {
      const node = await figma.getNodeByIdAsync(req.nodeId);
      const variable = await figma.variables.getVariableByIdAsync(req.variableId);

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

export async function buildCompatibilityPlanForComponents(
  requestId: string,
  sourceKey: string,
  targetKey: string,
  instancesCount: number,
): Promise<void> {
  try {
    const sourceComp = await resolveComponentDescriptor(sourceKey);
    const targetComp = await resolveComponentDescriptor(targetKey);

    if (!sourceComp || !targetComp) {
      emit<BuildCompatibilityPlanResultHandler>('BUILD_COMPATIBILITY_PLAN_RESULT', {
        ok: false,
        requestId,
        message: 'Could not resolve source or target component definitions',
      });
      return;
    }

    const plan = buildCompatibilityPlan({
      sourceComponent: sourceComp,
      targetComponent: targetComp,
      instancesCount,
    });

    emit<BuildCompatibilityPlanResultHandler>('BUILD_COMPATIBILITY_PLAN_RESULT', {
      ok: true,
      requestId,
      plan,
    });
  } catch (error) {
    emit<BuildCompatibilityPlanResultHandler>('BUILD_COMPATIBILITY_PLAN_RESULT', {
      ok: false,
      requestId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function executeComponentReplacement(
  operationId: string,
  request: ComponentReplacementExecutionRequest,
): Promise<void> {
  try {
    let targetComponentNode: ComponentNode | null = null;

    // Try finding target in local file or importing by key
    try {
      targetComponentNode = await figma.importComponentByKeyAsync(request.targetComponentKey);
    } catch {
      // Local search fallback
      const found = await figma.getNodeByIdAsync(request.targetComponentKey);
      if (found && found.type === 'COMPONENT') {
        targetComponentNode = found as ComponentNode;
      }
    }

    if (!targetComponentNode) {
      emit<ExecuteComponentReplacementResultHandler>('EXECUTE_COMPONENT_REPLACEMENT_RESULT', {
        ok: false,
        operationId,
        replacedCount: 0,
        failedCount: request.instanceIds.length,
        warningCount: 0,
        message: 'Target component could not be loaded from library or document.',
      });
      return;
    }

    let replacedCount = 0;
    let failedCount = 0;
    let warningCount = 0;

    for (const instanceId of request.instanceIds) {
      let swapped = false;
      try {
        const node = await figma.getNodeByIdAsync(instanceId);
        if (!node || node.type !== 'INSTANCE' || node.removed) {
          failedCount++;
          continue;
        }

        const instance = node as InstanceNode;
        const currentMainComponent = await instance.getMainComponentAsync();
        const currentSourceKey = currentMainComponent?.key || currentMainComponent?.id;
        if (!currentSourceKey || currentSourceKey !== request.sourceComponentKey) {
          failedCount++;
          continue;
        }

        // Extract existing properties before swap.
        const oldProps = { ...instance.componentProperties };

        // Swap using native Figma override preservation heuristics.
        instance.swapComponent(targetComponentNode);
        swapped = true;
        replacedCount++;

        // Re-apply only mappings that still exist and accept the old value.
        const targetDefs = targetComponentNode.componentPropertyDefinitions;
        const newPropertiesToSet: Record<string, string | boolean> = {};

        for (const [targetRawKey, targetDefinition] of Object.entries(targetDefs)) {
          if (targetDefinition.type === 'SLOT') continue;
          const targetNorm = normalizePropertyName(targetRawKey).toLowerCase();
          const sourceEntry = Object.entries(request.propertyMappings).find(
            ([, mappedTarget]) => normalizePropertyName(mappedTarget).toLowerCase() === targetNorm,
          );
          if (!sourceEntry) continue;

          const [sourceNorm] = sourceEntry;
          const oldEntry = Object.entries(oldProps).find(
            ([oldRawKey]) => normalizePropertyName(oldRawKey).toLowerCase() === sourceNorm.toLowerCase(),
          );
          if (!oldEntry) continue;

          const oldProperty = oldEntry[1];
          const oldValue = oldProperty.value;
          if (oldProperty.type !== targetDefinition.type) {
            warningCount++;
            continue;
          }
          if (
            targetDefinition.type === 'VARIANT'
            && typeof oldValue === 'string'
            && !targetDefinition.variantOptions?.some(
              (option) => option.trim().toLowerCase() === oldValue.trim().toLowerCase(),
            )
          ) {
            warningCount++;
            continue;
          }
          if (typeof oldValue === 'string' || typeof oldValue === 'boolean') {
            newPropertiesToSet[targetRawKey] = oldValue;
          }
        }

        if (Object.keys(newPropertiesToSet).length > 0) {
          try {
            instance.setProperties(newPropertiesToSet);
          } catch {
            warningCount++;
          }
        }
      } catch {
        if (swapped) {
          warningCount++;
        } else {
          failedCount++;
        }
      }
    }

    if (replacedCount > 0) {
      figma.commitUndo();
    }

    emit<ExecuteComponentReplacementResultHandler>('EXECUTE_COMPONENT_REPLACEMENT_RESULT', {
      ok: failedCount === 0 && warningCount === 0,
      operationId,
      replacedCount,
      failedCount,
      warningCount,
      message: failedCount === 0 && warningCount === 0
        ? `Successfully migrated ${replacedCount} component instances.`
        : `Replaced ${replacedCount} instances; ${failedCount} failed and ${warningCount} need override review.`,
    });
  } catch (error) {
    emit<ExecuteComponentReplacementResultHandler>('EXECUTE_COMPONENT_REPLACEMENT_RESULT', {
      ok: false,
      operationId,
      replacedCount: 0,
      failedCount: request.instanceIds.length,
      warningCount: 0,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function focusNodeOnCanvas(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node && 'type' in node) {
    figma.currentPage.selection = [node as SceneNode];
    figma.viewport.scrollAndZoomIntoView([node as SceneNode]);
  }
}

function collectVariableReferences(
  root: SceneNode,
  idSet: Set<string>,
  maxNodes = 400,
): void {
  const stack: SceneNode[] = [root];
  let visited = 0;

  while (stack.length > 0 && visited < maxNodes) {
    const node = stack.pop()!;
    if ('removed' in node && node.removed) continue;
    visited++;

    try {
      // 1. node.boundVariables
      if ('boundVariables' in node && node.boundVariables) {
        for (const val of Object.values(node.boundVariables)) {
          if (val && typeof val === 'object') {
            if ('id' in val && typeof (val as { id: unknown }).id === 'string') {
              idSet.add((val as { id: string }).id);
            } else if (Array.isArray(val)) {
              for (const item of val) {
                if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
                  idSet.add(item.id);
                }
              }
            }
          }
        }
      }

      // 2. fills
      if ('fills' in node && Array.isArray(node.fills)) {
        for (const p of node.fills) {
          if (p.boundVariables?.color?.id) {
            idSet.add(p.boundVariables.color.id);
          }
        }
      }

      // 3. strokes
      if ('strokes' in node && Array.isArray(node.strokes)) {
        for (const p of node.strokes) {
          if (p.boundVariables?.color?.id) {
            idSet.add(p.boundVariables.color.id);
          }
        }
      }

      // 4. inferredVariables
      if ('inferredVariables' in node && node.inferredVariables) {
        const map = node.inferredVariables as Record<string, unknown>;
        for (const val of Object.values(map)) {
          if (Array.isArray(val)) {
            for (const item of val) {
              if (Array.isArray(item)) {
                for (const sub of item) {
                  if (sub && typeof sub === 'object' && 'id' in sub && typeof sub.id === 'string') {
                    idSet.add(sub.id);
                  }
                }
              } else if (item && typeof item === 'object' && 'id' in item && typeof item.id === 'string') {
                idSet.add(item.id);
              }
            }
          } else if (val && typeof val === 'object' && 'id' in val && typeof (val as { id: unknown }).id === 'string') {
            idSet.add((val as { id: string }).id);
          }
        }
      }

      // 5. Children
      if ('children' in node && Array.isArray(node.children)) {
        for (const child of node.children) {
          stack.push(child);
        }
      }
    } catch {
      // ignore
    }
  }
}

async function readInferredVariable(
  node: SceneNode,
  prop: string,
  variableMap: Map<string, Variable>,
  paintIndex?: number,
): Promise<{ id: string; name: string; key?: string } | undefined> {
  try {
    if ('removed' in node && node.removed) {
      return undefined;
    }
    if (!('inferredVariables' in node) || !node.inferredVariables) {
      return undefined;
    }
    const map = node.inferredVariables as Record<string, unknown>;
    const inferred = map[prop];
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

async function resolveComponentDescriptor(key: string): Promise<ComponentDescriptor | null> {
  let comp: ComponentNode | null = null;
  try {
    comp = await figma.importComponentByKeyAsync(key);
  } catch {
    const found = await figma.getNodeByIdAsync(key);
    if (found && found.type === 'COMPONENT') comp = found as ComponentNode;
  }

  if (!comp) return null;

  const props: ComponentPropertyDescriptor[] = [];
  const defs = comp.componentPropertyDefinitions || {};
  for (const [name, def] of Object.entries(defs)) {
    if (def.type === 'SLOT') continue;
    props.push({
      name,
      type: def.type,
      variantOptions: def.variantOptions,
      defaultValue: def.defaultValue,
    });
  }

  return {
    key: comp.key || comp.id,
    name: comp.name,
    properties: props,
  };
}

function getBoundPaintVariable(
  node: SceneNode,
  field: 'fills' | 'strokes',
  paintIndex: number,
): VariableAlias | undefined {
  const aliases = node.boundVariables?.[field];
  return Array.isArray(aliases) ? aliases[paintIndex] : undefined;
}

function createTokenCandidatesForConsumer(
  variables: readonly Variable[],
  consumer: SceneNode,
): TokenCandidateInput[] {
  const candidates: TokenCandidateInput[] = [];
  for (const variable of variables) {
    try {
      const resolved = variable.resolveForConsumer(consumer);
      const value = normalizeResolvedTokenValue(resolved.value, resolved.resolvedType);
      if (value === undefined) continue;
      candidates.push({
        variableId: variable.id,
        variableName: variable.name,
        variableKey: variable.key,
        resolvedType: resolved.resolvedType,
        scopes: variable.scopes,
        value,
      });
    } catch {
      // A variable that cannot resolve for this consumer is not a safe suggestion.
    }
  }
  return candidates;
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
