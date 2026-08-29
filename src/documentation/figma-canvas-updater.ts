/**
 * In-place updater and reconciler for existing Figma documentation frames.
 *
 * Updates texts, swatches, rows, and mode columns in place without destroying
 * or recreating the frame node, preserving position, comments, and links.
 */

import {
  DOC_FRAME_SCHEMA_VERSION,
  DOC_METADATA_PLUGIN_KEY,
  type ComponentDocDocument,
  type ComponentDocMatrixTier,
  type DocFrameMetadata,
  type TokenDocDocument,
} from './types';
import {
  FRAME_WIDTH,
  loadRequiredFonts,
  createSectionNode,
  createValueColumn,
  createTokenItemNode,
  createValueItemNode,
  applyColumnMode,
  safeGetNodeName,
  safeFindChild,
  safeFindChildren,
  safeFindTextNodes,
  safeFindAll,
  hexToRgb,
  alignTierTopRight,
} from './figma-canvas-writer';
import type { DocumentationGenerationCancellation } from './generation-cancellation';

export function readDocFrameMetadata(node: BaseNode): DocFrameMetadata | null {
  try {
    const raw = node.getPluginData(DOC_METADATA_PLUGIN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DocFrameMetadata;
    return parsed.schemaVersion === DOC_FRAME_SCHEMA_VERSION ? parsed : null;
  } catch (_e) {
    return null;
  }
}

export async function updateTierLabels(
  tierNodes: FrameNode[],
  tiers: ComponentDocMatrixTier[] | undefined,
  cancellation?: DocumentationGenerationCancellation,
): Promise<void> {
  if (!tiers) return;
  for (let tierIndex = 0; tierIndex < tiers.length; tierIndex++) {
    await cancellation?.yieldToMain();
    const tierNode = tierNodes[tierIndex];
    if (!tierNode) continue;
    const tier = tiers[tierIndex];
    tierNode.name = `Tier ${tierIndex} — ${tier.propertyName}`;
    alignTierTopRight(tierNode);

    const labelNodes = safeFindChildren<FrameNode>(
      tierNode,
      (node) => safeGetNodeName(node).startsWith('Label —'),
    );
    for (let groupIndex = 0; groupIndex < tier.groups.length; groupIndex++) {
      const labelNode = labelNodes[groupIndex];
      if (!labelNode) continue;
      const label = tier.groups[groupIndex].label;
      labelNode.name = `Label — ${label}`;
      const textNode = safeFindTextNodes(labelNode)[0];
      if (!textNode) continue;
      if (textNode.fontName !== figma.mixed) {
        await figma.loadFontAsync(textNode.fontName);
        cancellation?.throwIfCancelled();
      }
      textNode.characters = label;
    }
  }
}

export async function updateTokenDocFrameInPlace(
  frame: FrameNode,
  doc: TokenDocDocument,
  onProgress?: (stage: string, percent: number) => void,
  cancellation?: DocumentationGenerationCancellation,
): Promise<{ ok: boolean; message: string; updatedTokensCount: number }> {
  cancellation?.throwIfCancelled();
  onProgress?.('Loading fonts for update…', 10);
  await loadRequiredFonts();
  cancellation?.throwIfCancelled();

  frame.resize(FRAME_WIDTH, frame.height);
  frame.cornerRadius = 24;
  frame.clipsContent = true;

  let updatedTokensCount = 0;

  const cleanTitle = doc.title.replace(/^\d+\.\s*/, '');
  const numMatch = doc.title.match(/^\d+/)?.[0] ?? '01';
  const paddedNum = numMatch.padStart(2, '0');

  // 1. Update Header (first child if header)
  onProgress?.('Updating header & hero…', 20);
  const header = frame.children.find(
    (c, idx) =>
      idx === 0 &&
      (safeGetNodeName(c).startsWith('.[Documentation] Header & Footer') ||
        safeGetNodeName(c).startsWith('.[Documentation] Header')),
  );
  if (header) {
    const textNodes = safeFindTextNodes(header);
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) {
        await figma.loadFontAsync(t.fontName);
      }
      const textLower = t.characters.toLowerCase();
      if (t.name === 'Category' || textLower === 'category' || t.characters === 'FOUNDATION') {
        t.characters = 'FOUNDATION';
      } else if (t.name === 'Page' || textLower === 'page' || t.characters === 'COLORS') {
        t.characters = cleanTitle.toUpperCase();
      } else if (t.name === '01' || t.characters === '01') {
        t.characters = paddedNum;
      } else if (textLower === 'swiss army') {
        t.characters = 'SWISS ARMY';
      }
    }
  }

  // 2. Update Hero
  const hero = safeFindChild(frame, (c) => safeGetNodeName(c).startsWith('.[Documentation] Hero'));
  if (hero) {
    const textNodes = safeFindTextNodes(hero);
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) {
        await figma.loadFontAsync(t.fontName);
      }
      if (t.name === 'Headline' || t.characters === 'Headline' || t.characters.includes('Colors')) {
        t.characters = cleanTitle;
      } else if (t.name === 'Description' || t.characters.startsWith('Guidelines')) {
        t.characters =
          doc.description ||
          `Guidelines to delve into the ${cleanTitle} Palette and Token System, exploring customization options for your palette, switching primary colors, utilizing variable modes, changing themes, and more.`;
      }
    }
  }

  // 3. Update Separator
  const separator = safeFindChild(frame, (c) => safeGetNodeName(c).startsWith('.[Documentation] Separator'));
  if (separator) {
    const textNodes = safeFindTextNodes(separator);
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) {
        await figma.loadFontAsync(t.fontName);
      }
      t.characters = `${cleanTitle} Tokens`;
    }
  }

  // 4. Update Footer
  const footer =
    frame.children.find(
      (c, idx) =>
        idx > 0 &&
        (safeGetNodeName(c).startsWith('.[Documentation] Header & Footer') ||
          safeGetNodeName(c).startsWith('.[Documentation] Footer')),
    ) ?? safeFindChild(frame, (n) => safeGetNodeName(n).startsWith('.[Documentation] Footer'));

  if (footer) {
    const textNodes = safeFindTextNodes(footer);
    for (const t of textNodes) {
      if (t.fontName !== figma.mixed) {
        await figma.loadFontAsync(t.fontName);
      }
      t.characters = 'Made with 🖤 by Tashil Design';
    }
  }

  // 5. Reconcile Sections in order
  const existingSectionNodes = frame.children.filter((n) =>
    safeGetNodeName(n).startsWith('.[Documentation] Section'),
  ) as (FrameNode | InstanceNode)[];

  const totalSections = doc.sections.length;
  for (let sIdx = 0; sIdx < totalSections; sIdx++) {
    await cancellation?.yieldToMain();
    const section = doc.sections[sIdx];
    const sPct = Math.round(30 + ((sIdx + 1) / totalSections) * 60);
    onProgress?.(`Updating section ${sIdx + 1} of ${totalSections} (${section.headline})…`, sPct);

    if (sIdx < existingSectionNodes.length) {
      // Reconcile existing section in place
      const sectionNode = existingSectionNodes[sIdx];

      // Update Headline and Description
      const textNodes = safeFindTextNodes(sectionNode);
      for (const t of textNodes) {
        if (t.fontName !== figma.mixed) {
          await figma.loadFontAsync(t.fontName);
        }
        if (t.name === 'Headline' || t.characters === 'Headline' || t.characters === 'Section name') {
          t.characters = section.headline;
        } else if (t.name === 'Description' || t.characters.startsWith('Allows users')) {
          t.characters = section.description;
        }
      }

      // Reconcile table inside Slot
      const slot = safeFindChild<FrameNode>(sectionNode, (n) => safeGetNodeName(n) === 'Slot');
      const table = slot
        ? safeFindChild<FrameNode>(slot, (n) => safeGetNodeName(n) === 'Table' || safeGetNodeName(n) === 'Container')
        : safeFindChild<FrameNode>(sectionNode, (n) => safeGetNodeName(n) === 'Table' || safeGetNodeName(n) === 'Container');

      if (table && 'children' in table) {
        // Reconcile Token column
        const tokenColumn = safeFindChild<FrameNode>(table, (n) => safeGetNodeName(n) === 'Token');
        if (tokenColumn && 'children' in tokenColumn) {
          const existingTokenItems = safeFindChildren<SceneNode>(
            tokenColumn,
            (c) => safeGetNodeName(c) === 'Token Item' || safeGetNodeName(c).includes('Token Item'),
          );

          for (let i = 0; i < section.tokens.length; i++) {
            if (i % 16 === 0) await cancellation?.yieldToMain();
            const token = section.tokens[i];
            if (i < existingTokenItems.length) {
              const existingItem = existingTokenItems[i];
              const itemTexts = safeFindTextNodes(existingItem);
              for (const textNode of itemTexts) {
                if (textNode.fontName !== figma.mixed) {
                  await figma.loadFontAsync(textNode.fontName);
                }
                textNode.characters = token.name;
              }
              updatedTokensCount += 1;
            } else {
              const newItem = await createTokenItemNode(token.name);
              tokenColumn.appendChild(newItem);
              updatedTokensCount += 1;
            }
          }

          // Prune extra rows
          if (existingTokenItems.length > section.tokens.length) {
            for (let extra = section.tokens.length; extra < existingTokenItems.length; extra++) {
              try {
                existingTokenItems[extra].remove();
              } catch (_e) {
                // Ignore removal error
              }
            }
          }
        }

        // Reconcile Value columns
        const existingValueColumns = safeFindChildren<FrameNode>(
          table,
          (c) => safeGetNodeName(c) === 'Value' || safeGetNodeName(c).startsWith('Value'),
        );

        for (let mIdx = 0; mIdx < doc.modes.length; mIdx++) {
          await cancellation?.yieldToMain();
          const mode = doc.modes[mIdx];
          let valueColumn =
            existingValueColumns.find((col) => {
              const colHeader = safeFindChild<FrameNode>(
                col,
                (h) => safeGetNodeName(h) === 'Header' || safeGetNodeName(h).includes('Header'),
              );
              const headerText = safeFindTextNodes(colHeader)[0];
              return headerText?.characters.toLowerCase() === mode.name.toLowerCase();
            }) ?? (mIdx < existingValueColumns.length ? existingValueColumns[mIdx] : null);

          if (!valueColumn) {
            valueColumn = await createValueColumn(
              section.tokens,
              mode,
              doc.collectionId,
              cancellation,
            );
            table.appendChild(valueColumn);
            updatedTokensCount += section.tokens.length;
            continue;
          }

          // Apply appearance mode to column
          await applyColumnMode(valueColumn, mode, doc.collectionId);

          // Update header
          const colHeader = safeFindChild<FrameNode>(
            valueColumn,
            (h) => safeGetNodeName(h) === 'Header' || safeGetNodeName(h).includes('Header'),
          );
          if (colHeader) {
            const hTexts = safeFindTextNodes(colHeader);
            for (const ht of hTexts) {
              if (ht.fontName !== figma.mixed) {
                await figma.loadFontAsync(ht.fontName);
              }
              ht.characters = mode.name;
            }
          }

          // Reconcile value items
          const existingValueItems = safeFindChildren<SceneNode>(
            valueColumn,
            (c) => safeGetNodeName(c) === 'Value Item' || safeGetNodeName(c).includes('Value Item'),
          );

          for (let i = 0; i < section.tokens.length; i++) {
            if (i % 16 === 0) await cancellation?.yieldToMain();
            const token = section.tokens[i];
            const val = token.valuesByMode[mode.modeId];
            const displayText = val?.aliasTargetName ?? val?.rawValue ?? '-';

            if (i < existingValueItems.length) {
              const existingItem = existingValueItems[i];

              // Update swatch if color
              if (val?.hexColor) {
                let solidPaint: SolidPaint = { color: hexToRgb(val.hexColor), type: 'SOLID' };
                if (token.id) {
                  try {
                    const variable = await figma.variables.getVariableByIdAsync(token.id);
                    if (variable) {
                      solidPaint = figma.variables.setBoundVariableForPaint(solidPaint, 'color', variable);
                    }
                  } catch (_e) {
                    // Fallback
                  }
                }

                const swatch =
                  safeFindChild<FrameNode>(
                    existingItem,
                    (n) => safeGetNodeName(n) === 'Color Icon' || safeGetNodeName(n) === 'Value Icon',
                  ) ??
                  safeFindAll<FrameNode>(
                    existingItem,
                    (n) => safeGetNodeName(n) === 'Color Icon' || safeGetNodeName(n) === 'Value Icon',
                  )[0] ??
                  null;

                if (swatch) {
                  if ('fills' in swatch) {
                    try {
                      swatch.fills = [solidPaint];
                    } catch (_e) {
                      // Ignore swatch fill write error
                    }
                  }
                  if ('children' in swatch && Array.isArray(swatch.children)) {
                    for (const child of swatch.children) {
                      if (child && 'fills' in child) {
                        try {
                          child.fills = [solidPaint];
                        } catch (_e) {
                          // Ignore child fill write error
                        }
                      }
                    }
                  }
                }
              }

              // Update texts
              const textNodes = safeFindTextNodes(existingItem);
              for (const textNode of textNodes) {
                if (textNode.fontName !== figma.mixed) {
                  await figma.loadFontAsync(textNode.fontName);
                }
                textNode.characters = String(displayText);
              }
              updatedTokensCount += 1;
            } else {
              const newItem = await createValueItemNode(val, token.id);
              valueColumn.appendChild(newItem);
              updatedTokensCount += 1;
            }
          }

          // Prune extra value items
          if (existingValueItems.length > section.tokens.length) {
            for (let extra = section.tokens.length; extra < existingValueItems.length; extra++) {
              try {
                existingValueItems[extra].remove();
              } catch (_e) {
                // Ignore removal error
              }
            }
          }
        }

        // Prune extra value columns if modes were removed
        if (existingValueColumns.length > doc.modes.length) {
          for (let extra = doc.modes.length; extra < existingValueColumns.length; extra++) {
            try {
              existingValueColumns[extra].remove();
            } catch (_e) {
              // Ignore removal error
            }
          }
        }
      }
    } else {
      // Create new section node and append before footer
      const newSectionNode = await createSectionNode(
        section,
        doc.modes,
        doc.collectionId,
        cancellation,
      );
      if (footer) {
        frame.insertChild(frame.children.indexOf(footer), newSectionNode);
      } else {
        frame.appendChild(newSectionNode);
      }
      updatedTokensCount += section.tokens.length * (doc.modes.length + 1);
    }
  }

  // Prune extra sections if sections were removed
  if (existingSectionNodes.length > doc.sections.length) {
    for (let extra = doc.sections.length; extra < existingSectionNodes.length; extra++) {
      existingSectionNodes[extra].remove();
    }
  }

  // Update stamped metadata
  cancellation?.throwIfCancelled();
  onProgress?.('Updating document metadata…', 95);
  const updatedMetadata: DocFrameMetadata = {
    contentHash: doc.contentHash,
    docType: 'tokens',
    generatedAt: new Date().toISOString(),
    modeIds: doc.modes.map((m) => m.modeId),
    schemaVersion: DOC_FRAME_SCHEMA_VERSION,
    targetId: doc.collectionId,
    targetName: doc.collectionName,
    tokenGroupingDepth: doc.groupingDepth,
  };
  frame.setPluginData(DOC_METADATA_PLUGIN_KEY, JSON.stringify(updatedMetadata));

  onProgress?.('Update complete!', 100);
  return {
    message: `Updated ${updatedTokensCount} token cells in place.`,
    ok: true,
    updatedTokensCount,
  };
}

export async function updateComponentDocFrameInPlace(
  frame: FrameNode,
  doc: ComponentDocDocument,
  _componentNode?: ComponentNode | ComponentSetNode,
  onProgress?: (stage: string, percent: number) => void,
  cancellation?: DocumentationGenerationCancellation,
): Promise<{ ok: boolean; message: string; updatedPropsCount: number }> {
  cancellation?.throwIfCancelled();
  onProgress?.('Loading fonts for update…', 10);
  await loadRequiredFonts();
  cancellation?.throwIfCancelled();

  let updatedPropsCount = 0;

  const yAxisArea = safeFindChild<FrameNode>(frame, (node) => safeGetNodeName(node) === 'Y-Axis Area');
  const yTiersRow = safeFindChild<FrameNode>(yAxisArea, (node) => safeGetNodeName(node) === 'Y-Tiers Row');
  const yTierNodes = safeFindChildren<FrameNode>(
    yTiersRow,
    (node) => safeGetNodeName(node).startsWith('Tier '),
  );
  const gridArea = safeFindChild<FrameNode>(frame, (node) => safeGetNodeName(node) === 'Grid Area');
  const xHeadersArea = safeFindChild<FrameNode>(gridArea, (node) => safeGetNodeName(node) === 'X-Axis Headers');
  const xTierNodes = safeFindChildren<FrameNode>(
    xHeadersArea,
    (node) => safeGetNodeName(node).startsWith('Tier '),
  );

  if (doc.matrix) {
    await updateTierLabels(yTierNodes, doc.matrix.yTiers, cancellation);
    await updateTierLabels(xTierNodes, doc.matrix.xTiers, cancellation);
  }

  const allTierNodes = safeFindAll<FrameNode>(
    frame,
    (node) => node.type === 'FRAME' && safeGetNodeName(node).startsWith('Tier '),
  );
  for (const tierNode of allTierNodes) {
    cancellation?.throwIfCancelled();
    alignTierTopRight(tierNode);
  }

  // Reconcile Y-Axis Labels
  const yAxisCol = safeFindChild(yTiersRow, (c) => safeGetNodeName(c) === 'Y-Axis Labels');
  if (yAxisCol && 'children' in yAxisCol && doc.matrix) {
    const yLabels = (yAxisCol as FrameNode).children.filter((c) => safeGetNodeName(c) === 'Label');
    for (let r = 0; r < doc.matrix.rows.length; r++) {
      await cancellation?.yieldToMain();
      const row = doc.matrix.rows[r];
      if (r < yLabels.length) {
        const textNodes = safeFindTextNodes(yLabels[r]);
        if (textNodes.length > 0) {
          if (textNodes[0].fontName !== figma.mixed) {
            await figma.loadFontAsync(textNodes[0].fontName);
          }
          textNodes[0].characters = row.rowHeader.value;
        }
      }
    }
  }

  // Reconcile X-Axis Headers
  if (gridArea && 'children' in gridArea && doc.matrix) {
    const xHeadersRow = safeFindChild<FrameNode>(
      xHeadersArea,
      (c) => safeGetNodeName(c) === 'X-Axis Headers',
    ) ?? xHeadersArea;
    if (xHeadersRow && 'children' in xHeadersRow) {
      const xLabels = (xHeadersRow as FrameNode).children.filter((c) => safeGetNodeName(c) === 'Label');
      for (let c = 0; c < doc.matrix.columnHeaders.length; c++) {
        cancellation?.throwIfCancelled();
        const colHeader = doc.matrix.columnHeaders[c];
        if (c < xLabels.length) {
          const textNodes = safeFindTextNodes(xLabels[c]);
          if (textNodes.length > 0) {
            if (textNodes[0].fontName !== figma.mixed) {
              await figma.loadFontAsync(textNodes[0].fontName);
            }
            textNodes[0].characters = colHeader.value;
          }
        }
      }
    }

    // Reconcile Instances Grid
    const instancesContainer = safeFindChild(gridArea, (c) => safeGetNodeName(c) === 'Instances');
    if (instancesContainer && 'children' in instancesContainer) {
      const rowNodes = (instancesContainer as FrameNode).children.filter(
        (c) => safeGetNodeName(c) === 'Row',
      ) as FrameNode[];

      for (let r = 0; r < doc.matrix.rows.length; r++) {
        await cancellation?.yieldToMain();
        const rowData = doc.matrix.rows[r];
        if (r < rowNodes.length) {
          const rowNode = rowNodes[r];
          const cellNodes = rowNode.children.filter((c) =>
            safeGetNodeName(c).startsWith('Instance'),
          ) as FrameNode[];

          for (let c = 0; c < rowData.cells.length; c++) {
            const cellData = rowData.cells[c];
            if (c < cellNodes.length) {
              const cellNode = cellNodes[c];
              const instanceNode = safeFindChild(cellNode, (n) => n.type === 'INSTANCE');
              const isUnsupportedCell = !instanceNode && safeFindTextNodes(cellNode).some(
                (textNode) => textNode.characters === 'None',
              );
              if (isUnsupportedCell) {
                cellNode.fills = [];
              }
              if (instanceNode && 'setProperties' in instanceNode) {
                try {
                  (instanceNode as InstanceNode).setProperties(cellData.combination);
                  updatedPropsCount += 1;
                } catch (_e) {
                  // Ignore variant property set error
                }
              }
            }
          }
        }
      }
    }
  }

  // Update stamped metadata
  cancellation?.throwIfCancelled();
  onProgress?.('Updating document metadata…', 95);
  const updatedMetadata: DocFrameMetadata = {
    contentHash: doc.contentHash,
    docType: 'component',
    generatedAt: new Date().toISOString(),
    modeIds: [],
    schemaVersion: DOC_FRAME_SCHEMA_VERSION,
    targetId: doc.componentName,
    targetName: doc.componentName,
  };
  frame.setPluginData(DOC_METADATA_PLUGIN_KEY, JSON.stringify(updatedMetadata));

  onProgress?.('Update complete!', 100);
  return {
    message: `Updated component variants for <${doc.componentName}> in place.`,
    ok: true,
    updatedPropsCount,
  };
}
