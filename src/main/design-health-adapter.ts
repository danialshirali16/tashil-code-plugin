import { emit } from '@create-figma-plugin/utilities';
import {
  calculateTokenAuditSummary,
  isValueEqual,
  rankTokenSuggestion,
  type TokenCandidateInput,
} from '../design-health/token-audit';
import type {
  DeprecatedInstanceNotice,
  DesignHealthScanResult,
  TokenBindingRequest,
  TokenPropertyIssue,
  TokenPropertyKind,
  TokenSuggestion,
} from '../design-health/types';
import type {
  ApplyTokenBindingsResultHandler,
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

    // Fast-scan bound and inferred variables in target subtree to discover referenced collections
    const referencedVarIds = new Set<string>();
    collectVariableReferences(targetNode, referencedVarIds, 400);

    // Fetch referenced variables that are not local, then expand their full
    // collections so the complete library token set is available in memory.
    // Fetches run in parallel chunks — sequential per-variable awaits are the
    // dominant scan cost once a library holds hundreds of tokens.
    const referencedMissing = Array.from(referencedVarIds).filter((id) => !variableMap.has(id));
    await fetchVariablesChunked(referencedMissing, variableMap);
    if (scanId !== latestScanId) {
      return;
    }

    const collectionIdsToExpand = new Set<string>();
    for (const varId of referencedVarIds) {
      const v = variableMap.get(varId);
      if (v?.variableCollectionId) {
        collectionIdsToExpand.add(v.variableCollectionId);
      }
    }

    const sisterVarIds: string[] = [];
    for (const colId of collectionIdsToExpand) {
      try {
        const col = await figma.variables.getVariableCollectionByIdAsync(colId);
        if (col && Array.isArray(col.variableIds)) {
          for (const varId of col.variableIds) {
            if (!variableMap.has(varId)) {
              sisterVarIds.push(varId);
            }
          }
        }
      } catch {
        // ignore
      }
    }
    await fetchVariablesChunked(sisterVarIds, variableMap);
    if (scanId !== latestScanId) {
      return;
    }

    // Resolve candidate values once for the audit root's variable-mode context.
    // Resolving every variable for every node would cost nodes × variables
    // bridge calls; per-node mode divergence inside the selection is instead
    // handled by verifying each exact-match suggestion against its consuming
    // node (see rankAndVerifySuggestions).
    const variableList = Array.from(variableMap.values());
    const tokenCandidates = createTokenCandidatesForConsumer(variableList, targetNode);

    // Traverse the subtree
    const issues: TokenPropertyIssue[] = [];
    let boundPropertiesCount = 0;
    const uniqueComponentKeys = new Set<string>();
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

        // One bridge read per property group; the loops below reuse these
        // snapshots instead of re-reading node fields per paint/edge.
        const fills = 'fills' in n && Array.isArray(n.fills) ? n.fills : undefined;
        const strokes = 'strokes' in n && Array.isArray(n.strokes) ? n.strokes : undefined;
        const boundVariables = 'boundVariables' in n
          ? (n.boundVariables as Record<string, VariableAlias | VariableAlias[]> | undefined)
          : undefined;
        const inferredVariables = 'inferredVariables' in n && n.inferredVariables
          ? (n.inferredVariables as Record<string, unknown>)
          : undefined;
        const hasBoundVariable = (field: string): boolean => Boolean(
          boundVariables && field in boundVariables,
        );

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
                availableTokens: tokenCandidates,
                nodeName: n.name,
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
                availableTokens: tokenCandidates,
                nodeName: n.name,
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
            availableTokens: tokenCandidates,
            nodeName: n.name,
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
              availableTokens: tokenCandidates,
              nodeName: n.name,
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
            availableTokens: tokenCandidates,
            nodeName: n.name,
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
            availableTokens: tokenCandidates,
            nodeName: n.name,
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

        // Recurse children. Component instances stay atomic: their internals
        // belong to the main component, auditing them would only surface
        // read-only rows, and skipping them keeps large frames inside the
        // node budget. The audit root itself may be an instance — selecting
        // one is an explicit request to audit that component's own layers.
        if ('children' in n && Array.isArray(n.children)) {
          if (n.type !== 'INSTANCE' || n.id === targetNode.id) {
            for (const child of n.children) {
              nodesToWalk.push({
                node: child,
                isInsideInstance: current.isInsideInstance || n.type === 'INSTANCE',
                parentInstanceId: current.parentInstanceId || (n.type === 'INSTANCE' ? n.id : undefined),
              });
            }
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
        remoteInstancesCount,
        localInstancesCount,
      },
      nodesVisited: visitedCount,
      capReached: nodesToWalk.length > 0,
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

export async function focusNodeOnCanvas(nodeId: string): Promise<void> {
  const node = await figma.getNodeByIdAsync(nodeId);
  if (node && 'type' in node) {
    // Deliberately does NOT change figma.currentPage.selection: the audit is
    // anchored to the current selection, and re-pointing it here would discard
    // the whole scan the user is reading.
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

      // 5. Children — same atomicity rule as the audit walk: never descend
      // into a non-root instance's internals.
      if ('children' in node && Array.isArray(node.children)) {
        if (node.type !== 'INSTANCE' || node.id === root.id) {
          for (const child of node.children) {
            stack.push(child);
          }
        }
      }
    } catch {
      // ignore
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
 * context; the per-issue `resolveForConsumer` check keeps a mode switch inside
 * the selection from ever offering a token whose value on this node differs
 * from the layer's raw value.
 */
async function rankAndVerifySuggestions(params: {
  node: SceneNode;
  property: TokenPropertyKind;
  currentValue: string | number;
  inferredVariable?: { id: string; name: string; key?: string };
  availableTokens: TokenCandidateInput[];
  nodeName?: string;
  variableMap: Map<string, Variable>;
}): Promise<{ suggestion?: TokenSuggestion; alternatives?: TokenSuggestion[] }> {
  const { node, property, currentValue, inferredVariable, availableTokens, nodeName, variableMap } = params;
  const ranked = rankTokenSuggestion({
    property,
    currentValue,
    inferredVariable,
    availableTokens,
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
    try {
      const resolved = variable.resolveForConsumer(node);
      const value = normalizeResolvedTokenValue(resolved.value, resolved.resolvedType);
      if (value !== undefined && isValueEqual(value, currentValue)) {
        verified = candidate;
        break;
      }
    } catch {
      // A variable that cannot resolve for this consumer is not a safe suggestion.
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
): Promise<void> {
  const CHUNK_SIZE = 25;
  for (let start = 0; start < variableIds.length; start += CHUNK_SIZE) {
    const slice = variableIds.slice(start, start + CHUNK_SIZE);
    const variables = await Promise.all(slice.map(async (id) => {
      try {
        return await figma.variables.getVariableByIdAsync(id);
      } catch {
        return null;
      }
    }));
    for (const v of variables) {
      if (v) {
        variableMap.set(v.id, v);
      }
    }
  }
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
