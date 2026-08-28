/**
 * Pure diffing and drift detection engine for documentation updates.
 *
 * Compares current document models against previous snapshots/metadata to report
 * exact additions, modifications, and removals.
 */

import type {
  DocDriftItem,
  DocDriftReport,
  DocFrameMetadata,
  TokenDocDocument,
} from './types';

export function diffTokenDocument(
  metadata: DocFrameMetadata,
  current: TokenDocDocument,
): DocDriftReport {
  const changes: DocDriftItem[] = [];

  // Check modes
  const previousModeIds = new Set(metadata.modeIds);
  const currentModeIds = new Set(current.modes.map((m) => m.modeId));

  for (const mode of current.modes) {
    if (!previousModeIds.has(mode.modeId)) {
      changes.push({
        kind: 'mode-added',
        modeId: mode.modeId,
        targetName: mode.name,
        message: `Mode "${mode.name}" was added to collection.`,
      });
    }
  }

  for (const modeId of metadata.modeIds) {
    if (!currentModeIds.has(modeId)) {
      changes.push({
        kind: 'mode-removed',
        modeId,
        targetName: modeId,
        message: `Mode with ID "${modeId}" was removed from collection.`,
      });
    }
  }

  // If content hash matches, no token drift
  if (metadata.contentHash === current.contentHash && changes.length === 0) {
    return {
      changes: [],
      hasDrift: false,
      targetId: current.collectionId,
      targetName: current.collectionName,
    };
  }

  // If content hash differs, mark drift
  if (metadata.contentHash !== current.contentHash && changes.length === 0) {
    changes.push({
      kind: 'token-value-changed',
      targetName: current.collectionName,
      message: `Token values or bindings in "${current.collectionName}" have changed.`,
    });
  }

  return {
    changes,
    hasDrift: changes.length > 0 || metadata.contentHash !== current.contentHash,
    targetId: current.collectionId,
    targetName: current.collectionName,
  };
}

export function diffTokenDocuments(
  previous: TokenDocDocument,
  current: TokenDocDocument,
): DocDriftReport {
  const changes: DocDriftItem[] = [];

  const prevTokens = new Map<string, typeof current.sections[0]['tokens'][0]>();
  for (const s of previous.sections) {
    for (const t of s.tokens) {
      prevTokens.set(t.name, t);
    }
  }

  const currTokens = new Map<string, typeof current.sections[0]['tokens'][0]>();
  for (const s of current.sections) {
    for (const t of s.tokens) {
      currTokens.set(t.name, t);
    }
  }

  // Added tokens
  for (const [name, token] of currTokens) {
    if (!prevTokens.has(name)) {
      changes.push({
        kind: 'token-added',
        targetName: name,
        message: `Token "${name}" was added.`,
      });
    } else {
      const prev = prevTokens.get(name)!;
      for (const mode of current.modes) {
        const prevVal = prev.valuesByMode[mode.modeId];
        const currVal = token.valuesByMode[mode.modeId];
        if (!prevVal && currVal) {
          changes.push({
            kind: 'token-value-changed',
            modeId: mode.modeId,
            targetName: name,
            message: `Token "${name}" gained value for mode "${mode.name}".`,
          });
        } else if (prevVal && currVal) {
          if (
            prevVal.rawValue !== currVal.rawValue
            || prevVal.aliasTargetName !== currVal.aliasTargetName
            || prevVal.hexColor !== currVal.hexColor
          ) {
            changes.push({
              kind: 'token-value-changed',
              modeId: mode.modeId,
              targetName: name,
              message: `Token "${name}" changed in mode "${mode.name}".`,
              details: `${prevVal.aliasTargetName ?? prevVal.rawValue} → ${currVal.aliasTargetName ?? currVal.rawValue}`,
            });
          }
        }
      }
    }
  }

  // Removed tokens
  for (const [name] of prevTokens) {
    if (!currTokens.has(name)) {
      changes.push({
        kind: 'token-removed',
        targetName: name,
        message: `Token "${name}" was removed.`,
      });
    }
  }

  return {
    changes,
    hasDrift: changes.length > 0,
    targetId: current.collectionId,
    targetName: current.collectionName,
  };
}

export function diffComponentDocument(
  metadata: DocFrameMetadata,
  current: import('./types').ComponentDocDocument,
): DocDriftReport {
  const changes: DocDriftItem[] = [];

  if (metadata.contentHash !== current.contentHash) {
    changes.push({
      kind: 'component-prop-changed',
      message: `Specification or variants for <${current.componentName}> have changed.`,
      targetName: current.componentName,
    });
  }

  return {
    changes,
    hasDrift: changes.length > 0 || metadata.contentHash !== current.contentHash,
    targetId: current.componentName,
    targetName: current.componentName,
  };
}

export function diffComponentDocuments(
  previous: import('./types').ComponentDocDocument,
  current: import('./types').ComponentDocDocument,
): DocDriftReport {
  const changes: DocDriftItem[] = [];

  const prevProps = new Map(previous.props.map((p) => [p.name, p]));
  const currProps = new Map(current.props.map((p) => [p.name, p]));

  for (const [name, prop] of currProps) {
    if (!prevProps.has(name)) {
      changes.push({
        kind: 'component-prop-changed',
        message: `Prop "${name}" (${prop.typeName}) was added.`,
        targetName: name,
      });
    } else {
      const prev = prevProps.get(name)!;
      if (prev.typeName !== prop.typeName || prev.required !== prop.required || prev.defaultValue !== prop.defaultValue) {
        changes.push({
          details: `${prev.typeName}${prev.required ? ' (req)' : ''} → ${prop.typeName}${prop.required ? ' (req)' : ''}`,
          kind: 'component-prop-changed',
          message: `Prop "${name}" definition changed.`,
          targetName: name,
        });
      }
    }
  }

  for (const [name] of prevProps) {
    if (!currProps.has(name)) {
      changes.push({
        kind: 'component-prop-changed',
        message: `Prop "${name}" was removed.`,
        targetName: name,
      });
    }
  }

  if (previous.variants.length !== current.variants.length) {
    changes.push({
      details: `${previous.variants.length} → ${current.variants.length}`,
      kind: 'variant-changed',
      message: `Variant count changed for <${current.componentName}>.`,
      targetName: current.componentName,
    });
  }

  return {
    changes,
    hasDrift: changes.length > 0,
    targetId: current.componentName,
    targetName: current.componentName,
  };
}

