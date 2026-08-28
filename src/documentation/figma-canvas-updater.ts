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
  createVariantMatrixSection,
  applyColumnMode,
  safeGetNodeName,
  safeFindChild,
  safeFindChildren,
  safeFindTextNodes,
  safeFindAll,
  hexToRgb,
} from './figma-canvas-writer';

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

export async function updateTokenDocFrameInPlace(
  frame: FrameNode,
  doc: TokenDocDocument,
  onProgress?: (stage: string, percent: number) => void,
): Promise<{ ok: boolean; message: string; updatedTokensCount: number }> {
  onProgress?.('Loading fonts for update…', 10);
  await loadRequiredFonts();

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
            valueColumn = await createValueColumn(section.tokens, mode, doc.collectionId);
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
      const newSectionNode = await createSectionNode(section, doc.modes, doc.collectionId);
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
  onProgress?.('Updating document metadata…', 95);
  const updatedMetadata: DocFrameMetadata = {
    contentHash: doc.contentHash,
    docType: 'tokens',
    generatedAt: new Date().toISOString(),
    modeIds: doc.modes.map((m) => m.modeId),
    schemaVersion: DOC_FRAME_SCHEMA_VERSION,
    targetId: doc.collectionId,
    targetName: doc.collectionName,
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
  componentNode?: ComponentNode | ComponentSetNode,
  onProgress?: (stage: string, percent: number) => void,
): Promise<{ ok: boolean; message: string; updatedPropsCount: number }> {
  onProgress?.('Loading fonts for update…', 10);
  await loadRequiredFonts();

  frame.resize(FRAME_WIDTH, frame.height);

  let updatedPropsCount = 0;

  // 1. Update Header
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
      if (t.name === 'Category' || textLower === 'category') {
        t.characters = 'COMPONENT SPEC';
      } else if (t.name === 'Page' || textLower === 'page') {
        t.characters = doc.componentName.toUpperCase();
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
      if (t.characters.startsWith('<') && t.characters.endsWith('/>')) {
        t.characters = `<${doc.componentName} />`;
      } else if (t.characters.includes('Props')) {
        t.characters = `${doc.props.length} Props`;
      } else if (t.characters.includes('Variants')) {
        t.characters = `${doc.variants.length} Variants`;
      } else if (t.characters.length > 20 && !t.characters.startsWith('import')) {
        t.characters = doc.description;
      }
    }
  }

  // 3. Update or Insert Variant Matrix Section
  if (doc.matrix && doc.matrix.rows.length > 0) {
    onProgress?.('Reconciling 2D variant matrix…', 50);
    const existingMatrixSection = safeFindChild(frame, (c) =>
      safeGetNodeName(c).includes('Variant Matrix'),
    );
    if (existingMatrixSection) {
      const instancesContainer = safeFindChild(existingMatrixSection, (c) =>
        safeGetNodeName(c) === 'Instances',
      );
      if (instancesContainer && 'children' in instancesContainer) {
        const rowNodes = (instancesContainer as FrameNode).children.filter(
          (c) => safeGetNodeName(c) === 'Row',
        ) as FrameNode[];

        for (let r = 0; r < doc.matrix.rows.length; r++) {
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
                if (instanceNode && 'setProperties' in instanceNode) {
                  try {
                    (instanceNode as InstanceNode).setProperties(cellData.combination);
                  } catch (_e) {
                    // Ignore variant property set error
                  }
                }
              }
            }
          }
        }
      }
    } else {
      const newMatrixSection = createVariantMatrixSection(doc, componentNode);
      const propsSection = safeFindChild(frame, (c) =>
        safeGetNodeName(c).includes('Props'),
      );
      if (propsSection) {
        frame.insertChild(frame.children.indexOf(propsSection), newMatrixSection);
      } else {
        frame.appendChild(newMatrixSection);
      }
    }
  }

  // 4. Update Props Table Section
  onProgress?.('Reconciling props table…', 75);
  const propsSection = safeFindChild(frame, (c) => safeGetNodeName(c).includes('Props'));
  if (propsSection) {
    const table = safeFindChild(propsSection, (c) => safeGetNodeName(c) === 'Props Table');
    if (table && 'children' in table) {
      const tableFrame = table as FrameNode;
      const existingRows = tableFrame.children.filter((c) =>
        safeGetNodeName(c).startsWith('Prop Row'),
      ) as FrameNode[];

      for (let i = 0; i < doc.props.length; i++) {
        const prop = doc.props[i];
        if (i < existingRows.length) {
          const row = existingRows[i];
          row.name = `Prop Row — ${prop.name}`;
          const textNodes = safeFindTextNodes(row);
          if (textNodes.length >= 6) {
            for (const t of textNodes) {
              if (t.fontName !== figma.mixed) {
                await figma.loadFontAsync(t.fontName);
              }
            }
            textNodes[0].characters = prop.name;
            textNodes[1].characters = prop.typeName;
            textNodes[2].characters = prop.required ? 'Required' : 'Optional';
            textNodes[3].characters = prop.defaultValue !== undefined ? String(prop.defaultValue) : '-';
            textNodes[4].characters = prop.mappedFigmaProperty ?? '-';
            textNodes[5].characters = prop.description ?? '-';
          }
          updatedPropsCount += 1;
        }
      }

      if (existingRows.length > doc.props.length) {
        for (let extra = doc.props.length; extra < existingRows.length; extra++) {
          try {
            existingRows[extra].remove();
          } catch (_e) {
            // Ignore removal error
          }
        }
      }
    }
  }

  // 5. Update stamped metadata
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
    message: `Updated component specification for <${doc.componentName}> in place.`,
    ok: true,
    updatedPropsCount,
  };
}
