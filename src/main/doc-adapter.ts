import { emit } from '@create-figma-plugin/utilities';
import {
  buildTokenDocDocument,
  summarizeTokenDocGroups,
  type RawCollectionData,
} from '../documentation/token-doc-model';
import {
  buildComponentDocDocument,
  summarizeComponentVariants,
} from '../documentation/component-doc-model';
import {
  emitComponentDocMarkdown,
  emitTokenDocMarkdown,
} from '../documentation/markdown-emitter';
import {
  createComponentDocFrame,
  createTokenDocFrame,
} from '../documentation/figma-canvas-writer';
import {
  readDocFrameMetadata,
  updateComponentDocFrameInPlace,
  updateTokenDocFrameInPlace,
} from '../documentation/figma-canvas-updater';
import {
  createDocumentationGenerationCancellation,
  isDocumentationGenerationCancelledError,
  type DocumentationGenerationCancellation,
} from '../documentation/generation-cancellation';
import type { DocStyleKind, TokenGroupingDepth } from '../documentation/types';
import type {
  ConnectionMetadata,
  DocGenerationProgressHandler,
  FigmaComponentSnapshot,
  GenerateComponentDocsResultHandler,
  GenerateStyleDocsResultHandler,
  GenerateTokenDocsResultHandler,
  LoadDocSourcePreviewResultHandler,
  LoadDocStyleSourcesResultHandler,
  SourceComponentSnapshot,
  UpdateDocsInPlaceResultHandler,
} from '../types';
import { loadRawCollectionData } from './token-adapter';
import {
  errorMessage,
} from './types';
import {
  createFigmaComponentSnapshot,
  readConnectionMetadata,
  resolveTargetById,
} from './connection-adapter';

let activeDocumentationGenerationId = 0;

export function beginDocumentationGeneration(): DocumentationGenerationCancellation {
  const runId = ++activeDocumentationGenerationId;
  return createDocumentationGenerationCancellation(
    () => runId !== activeDocumentationGenerationId,
  );
}

export function cancelDocumentationGeneration(): void {
  activeDocumentationGenerationId += 1;
}

export function formatStyleMeasurement(value: LineHeight | LetterSpacing): string {
  if (value.unit === 'AUTO') return 'Auto';
  return `${value.value}${value.unit === 'PIXELS' ? 'px' : '%'}`;
}

export async function resolveVariableById(
  id: string,
  variablesById: Map<string, Variable>,
): Promise<Variable | null> {
  const cached = variablesById.get(id);
  if (cached) return cached;
  try {
    const fetched = await figma.variables.getVariableByIdAsync(id);
    if (fetched) {
      variablesById.set(id, fetched);
      return fetched;
    }
  } catch (_e) {
    // Ignore error
  }
  return null;
}

export function getVariableAliasId(binding: unknown): string | undefined {
  if (!binding || typeof binding !== 'object') return undefined;
  if ('id' in binding && typeof (binding as { id: unknown }).id === 'string') {
    return (binding as { id: string }).id;
  }
  return undefined;
}

export async function formatTextStyleValue(
  style: TextStyle,
  variablesById: Map<string, Variable>,
): Promise<string> {
  const bound = (style as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};

  const fontFamilyId = getVariableAliasId(bound.fontFamily);
  const fontFamilyVar = fontFamilyId ? await resolveVariableById(fontFamilyId, variablesById) : null;
  const fontFamilyStr = fontFamilyVar?.name ?? style.fontName.family;

  const fontStyleId = getVariableAliasId(bound.fontStyle) ?? getVariableAliasId(bound.fontWeight);
  const fontStyleVar = fontStyleId ? await resolveVariableById(fontStyleId, variablesById) : null;
  const fontStyleStr = fontStyleVar?.name ?? style.fontName.style;

  const fontParts = (fontFamilyVar || fontStyleVar)
    ? [fontFamilyStr, fontStyleStr].filter(Boolean)
    : [`${style.fontName.family} ${style.fontName.style}`.trim()];

  const fontSizeId = getVariableAliasId(bound.fontSize);
  const fontSizeVar = fontSizeId ? await resolveVariableById(fontSizeId, variablesById) : null;
  const fontSizeStr = fontSizeVar ? fontSizeVar.name : `${style.fontSize}px`;

  const lineHeightId = getVariableAliasId(bound.lineHeight);
  const lineHeightVar = lineHeightId ? await resolveVariableById(lineHeightId, variablesById) : null;
  let lineHeightStr: string;
  if (lineHeightVar) {
    const nameLower = lineHeightVar.name.toLowerCase().replace(/[-_/]/g, '');
    if (nameLower.startsWith('lineheight') || nameLower.startsWith('leading')) {
      lineHeightStr = lineHeightVar.name;
    } else {
      lineHeightStr = `line-height ${lineHeightVar.name}`;
    }
  } else {
    lineHeightStr = `line-height ${formatStyleMeasurement(style.lineHeight)}`;
  }

  const letterSpacingId = getVariableAliasId(bound.letterSpacing);
  const letterSpacingVar = letterSpacingId ? await resolveVariableById(letterSpacingId, variablesById) : null;
  let letterSpacingStr: string;
  if (letterSpacingVar) {
    const nameLower = letterSpacingVar.name.toLowerCase().replace(/[-_/]/g, '');
    if (nameLower.startsWith('letterspacing') || nameLower.startsWith('tracking')) {
      letterSpacingStr = letterSpacingVar.name;
    } else {
      letterSpacingStr = `letter-spacing ${letterSpacingVar.name}`;
    }
  } else {
    letterSpacingStr = `letter-spacing ${formatStyleMeasurement(style.letterSpacing)}`;
  }

  return [...fontParts, fontSizeStr, lineHeightStr, letterSpacingStr].filter(Boolean).join(' · ');
}

export function formatDimension(value: number): string {
  return value === 0 ? '0' : `${value}px`;
}

export function formatEffectColor(color: RGBA): string {
  const channel = (value: number) => Math.round(value * 255);
  return `rgba(${channel(color.r)}, ${channel(color.g)}, ${channel(color.b)}, ${Number(color.a.toFixed(2))})`;
}

export async function formatEffectStyleValue(
  style: EffectStyle,
  variablesById: Map<string, Variable>,
): Promise<string> {
  const visibleEffects = style.effects.filter((effect) => effect.visible);
  if (visibleEffects.length === 0) {
    return 'none';
  }

  const cssDeclarations: string[] = [];
  const shadowParts: string[] = [];

  for (const effect of visibleEffects) {
    const bound = (effect as { boundVariables?: Record<string, unknown> }).boundVariables ?? {};

    if (effect.type === 'DROP_SHADOW' || effect.type === 'INNER_SHADOW') {
      const colorId = getVariableAliasId(bound.color);
      const colorVar = colorId ? await resolveVariableById(colorId, variablesById) : null;
      const colorStr = colorVar ? colorVar.name : formatEffectColor(effect.color);

      const radiusId = getVariableAliasId(bound.radius);
      const radiusVar = radiusId ? await resolveVariableById(radiusId, variablesById) : null;
      const radiusStr = radiusVar ? radiusVar.name : formatDimension(effect.radius);

      const spreadId = getVariableAliasId(bound.spread);
      const spreadVar = spreadId ? await resolveVariableById(spreadId, variablesById) : null;
      const spreadStr = spreadVar ? spreadVar.name : formatDimension(effect.spread ?? 0);

      const offsetXId = getVariableAliasId(bound.offsetX);
      const offsetXVar = offsetXId ? await resolveVariableById(offsetXId, variablesById) : null;
      const offsetXStr = offsetXVar ? offsetXVar.name : formatDimension(effect.offset.x);

      const offsetYId = getVariableAliasId(bound.offsetY);
      const offsetYVar = offsetYId ? await resolveVariableById(offsetYId, variablesById) : null;
      const offsetYStr = offsetYVar ? offsetYVar.name : formatDimension(effect.offset.y);

      const prefix = effect.type === 'INNER_SHADOW' ? 'inset ' : '';
      shadowParts.push(`${prefix}${offsetXStr} ${offsetYStr} ${radiusStr} ${spreadStr} ${colorStr}`.trim());
    } else if (effect.type === 'LAYER_BLUR') {
      const radiusId = getVariableAliasId(bound.radius);
      const radiusVar = radiusId ? await resolveVariableById(radiusId, variablesById) : null;
      const radiusStr = radiusVar ? radiusVar.name : `${effect.radius}px`;
      cssDeclarations.push(`filter: blur(${radiusStr});`);
    } else if (effect.type === 'BACKGROUND_BLUR') {
      const radiusId = getVariableAliasId(bound.radius);
      const radiusVar = radiusId ? await resolveVariableById(radiusId, variablesById) : null;
      const radiusStr = radiusVar ? radiusVar.name : `${effect.radius}px`;
      cssDeclarations.push(`backdrop-filter: blur(${radiusStr});`);
    } else if (effect.type === 'NOISE') {
      cssDeclarations.push(`/* noise: ${effect.noiseType.toLowerCase()} ${effect.density}% */`);
    } else if (effect.type === 'TEXTURE') {
      const radiusId = getVariableAliasId(bound.radius);
      const radiusVar = radiusId ? await resolveVariableById(radiusId, variablesById) : null;
      const radiusStr = radiusVar ? radiusVar.name : `${effect.radius}px`;
      cssDeclarations.push(`/* texture: size ${effect.noiseSize}px radius ${radiusStr} */`);
    } else if (effect.type === 'GLASS') {
      const radiusId = getVariableAliasId(bound.radius);
      const radiusVar = radiusId ? await resolveVariableById(radiusId, variablesById) : null;
      const radiusStr = radiusVar ? radiusVar.name : `${effect.radius}px`;
      cssDeclarations.push(`backdrop-filter: blur(${radiusStr}); /* glass depth ${effect.depth} */`);
    }
  }

  if (shadowParts.length > 0) {
    cssDeclarations.unshift(`box-shadow: ${shadowParts.join(', ')};`);
  }

  return cssDeclarations.join(' ') || 'none';
}

export async function loadRawStyleCollection(styleKind: DocStyleKind): Promise<RawCollectionData> {
  const modeId = 'style-specification';
  const localVariables = await figma.variables.getLocalVariablesAsync().catch(() => []);
  const variablesById = new Map(localVariables.map((v) => [v.id, v]));

  if (styleKind === 'typography') {
    const styles = await figma.getLocalTextStylesAsync();
    const tokens = await Promise.all(
      styles.map(async (style) => ({
        description: style.description,
        id: style.id,
        name: style.name,
        valuesByMode: {
          [modeId]: { value: await formatTextStyleValue(style, variablesById) },
        },
      })),
    );
    return {
      collectionId: styleKind,
      collectionName: 'Typography',
      modes: [{ modeId, name: 'Specification' }],
      tokens,
    };
  }

  const styles = await figma.getLocalEffectStylesAsync();
  const tokens = await Promise.all(
    styles.map(async (style) => ({
      description: style.description,
      id: style.id,
      name: style.name,
      valuesByMode: {
        [modeId]: {
          value: await formatEffectStyleValue(style, variablesById),
        },
      },
    })),
  );
  return {
    collectionId: styleKind,
    collectionName: 'Effects',
    modes: [{ modeId, name: 'Specification' }],
    tokens,
  };
}

export async function loadDocStyleSources(): Promise<void> {
  try {
    const [textStyles, effectStyles] = await Promise.all([
      figma.getLocalTextStylesAsync(),
      figma.getLocalEffectStylesAsync(),
    ]);
    emit<LoadDocStyleSourcesResultHandler>('LOAD_DOC_STYLE_SOURCES_RESULT', {
      ok: true,
      sources: [
        { id: 'typography', name: 'Typography', styleCount: textStyles.length },
        { id: 'effects', name: 'Effects', styleCount: effectStyles.length },
      ],
    });
  } catch (error) {
    emit<LoadDocStyleSourcesResultHandler>('LOAD_DOC_STYLE_SOURCES_RESULT', {
      message: errorMessage(error, 'load local styles'),
      ok: false,
    });
  }
}

export async function loadDocSourcePreview(payload: {
  requestId: string;
  scope: 'components' | 'styles' | 'tokens';
  targetId: string;
  tokenGroupingDepth?: TokenGroupingDepth;
}): Promise<void> {
  try {
    if (payload.scope === 'tokens') {
      const collections = await figma.variables.getLocalVariableCollectionsAsync();
      const collection = collections.find((candidate) => candidate.id === payload.targetId);
      if (!collection) {
        throw new Error('Token collection is no longer available.');
      }

      const variables = await figma.variables.getLocalVariablesAsync();
      const variablesById = new Map(variables.map((variable) => [variable.id, variable]));
      const tokenNames = collection.variableIds
        .map((variableId) => variablesById.get(variableId)?.name)
        .filter((name): name is string => name !== undefined);
      const groupingDepth = payload.tokenGroupingDepth ?? 'all';
      const summary = summarizeTokenDocGroups(tokenNames, collection.name, groupingDepth);

      emit<LoadDocSourcePreviewResultHandler>('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
        ok: true,
        preview: {
          ...summary,
          groupingDepth,
          groupNames: summary.groupNames.slice(0, 3),
          modeCount: collection.modes.length,
          scope: 'tokens',
          sourceName: collection.name,
          targetId: collection.id,
          tokenCount: collection.variableIds.length,
        },
        requestId: payload.requestId,
      });
      return;
    }

    if (payload.scope === 'styles') {
      const styleKind = payload.targetId as DocStyleKind;
      const rawCollection = await loadRawStyleCollection(styleKind);
      const groupingDepth = payload.tokenGroupingDepth ?? 'all';
      const summary = summarizeTokenDocGroups(
        rawCollection.tokens.map((style) => style.name),
        rawCollection.collectionName,
        groupingDepth,
      );
      emit<LoadDocSourcePreviewResultHandler>('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
        ok: true,
        preview: {
          ...summary,
          groupingDepth,
          groupNames: summary.groupNames.slice(0, 3),
          scope: 'styles',
          sourceName: rawCollection.collectionName,
          styleCount: rawCollection.tokens.length,
          styleKind,
          targetId: styleKind,
        },
        requestId: payload.requestId,
      });
      return;
    }

    const targetResult = await resolveTargetById(payload.targetId);
    if (!targetResult.ok) {
      throw new Error(targetResult.message);
    }
    const mainComponent = targetResult.selection.mainComponent;
    const snapshot = createFigmaComponentSnapshot(mainComponent);
    const summary = summarizeComponentVariants(snapshot.properties);

    emit<LoadDocSourcePreviewResultHandler>('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
      ok: true,
      preview: {
        ...summary,
        scope: 'components',
        sourceName: mainComponent.name,
        targetId: payload.targetId,
      },
      requestId: payload.requestId,
    });
  } catch (error) {
    emit<LoadDocSourcePreviewResultHandler>('LOAD_DOC_SOURCE_PREVIEW_RESULT', {
      message: errorMessage(error, 'load documentation preview'),
      ok: false,
      requestId: payload.requestId,
    });
  }
}

export async function generateTokenDocs(
  collectionId: string,
  targetFormat: 'canvas' | 'markdown' = 'canvas',
  tokenGroupingDepth: TokenGroupingDepth = 'all',
): Promise<void> {
  const cancellation = beginDocumentationGeneration();
  const reportProgress = (message: string, percent: number) => {
    cancellation.throwIfCancelled();
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Reading token collection…', 5);
    const rawCollection = await loadRawCollectionData(collectionId);
    cancellation.throwIfCancelled();
    if (!rawCollection) {
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: false,
        message: 'Could not load token collection data.',
      });
      return;
    }

    reportProgress('Building token models…', 10);
    const doc = buildTokenDocDocument(rawCollection, tokenGroupingDepth);
    if (targetFormat === 'markdown') {
      reportProgress('Formatting Markdown documentation…', 70);
      const markdown = emitTokenDocMarkdown(doc);
      cancellation.throwIfCancelled();
      reportProgress('Done!', 100);
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: true,
        message: 'Markdown documentation generated.',
        markdown,
      });
    } else {
      const frame = await createTokenDocFrame(
        doc,
        { cancellation },
        reportProgress,
      );
      cancellation.throwIfCancelled();
      figma.notify(`Created documentation frame for "${doc.title}".`);
      emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
        ok: true,
        message: `Created documentation frame for "${doc.title}".`,
        frameNodeId: frame.id,
      });
    }
  } catch (error) {
    if (isDocumentationGenerationCancelledError(error)) {
      return;
    }
    console.error('[Tashil Doc Generation Error]', error);
    emit<GenerateTokenDocsResultHandler>('GENERATE_TOKEN_DOCS_RESULT', {
      ok: false,
      message: errorMessage(error, 'generate token documentation'),
    });
  }
}

export async function generateStyleDocs(
  styleKind: DocStyleKind,
  tokenGroupingDepth: TokenGroupingDepth = 'all',
): Promise<void> {
  const cancellation = beginDocumentationGeneration();
  const reportProgress = (message: string, percent: number) => {
    cancellation.throwIfCancelled();
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Reading local styles…', 5);
    const rawCollection = await loadRawStyleCollection(styleKind);
    cancellation.throwIfCancelled();
    if (rawCollection.tokens.length === 0) {
      emit<GenerateStyleDocsResultHandler>('GENERATE_STYLE_DOCS_RESULT', {
        message: `No local ${styleKind === 'typography' ? 'text' : 'effect'} styles were found.`,
        ok: false,
      });
      return;
    }

    reportProgress('Building style documentation…', 15);
    const baseDoc = buildTokenDocDocument(rawCollection, tokenGroupingDepth);
    const doc = {
      ...baseDoc,
      description: styleKind === 'typography'
        ? `Typography specifications for ${baseDoc.totalTokens} local text styles, including font, size, line height, and letter spacing.`
        : `Effect specifications for ${baseDoc.totalTokens} local effect styles, including shadows, blurs, textures, and glass effects.`,
    };
    const frame = await createTokenDocFrame(
      doc,
      { cancellation, docType: 'styles', itemLabel: 'STYLE' },
      reportProgress,
    );
    cancellation.throwIfCancelled();
    figma.notify(`Created documentation frame for "${doc.title}".`);
    emit<GenerateStyleDocsResultHandler>('GENERATE_STYLE_DOCS_RESULT', {
      frameNodeId: frame.id,
      message: `Created ${doc.title} documentation with ${doc.totalTokens} styles.`,
      ok: true,
    });
  } catch (error) {
    if (isDocumentationGenerationCancelledError(error)) return;
    emit<GenerateStyleDocsResultHandler>('GENERATE_STYLE_DOCS_RESULT', {
      message: errorMessage(error, 'generate style documentation'),
      ok: false,
    });
  }
}

export async function updateDocsInPlace(
  frameNodeId: string,
  tokenGroupingDepth?: TokenGroupingDepth,
): Promise<void> {
  const cancellation = beginDocumentationGeneration();
  const reportProgress = (message: string, percent: number) => {
    cancellation.throwIfCancelled();
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Locating selected documentation frame…', 5);
    const node = await figma.getNodeByIdAsync(frameNodeId);
    cancellation.throwIfCancelled();
    if (!node || node.type !== 'FRAME') {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: 'Selected documentation frame could not be found.',
      });
      return;
    }

    reportProgress('Validating documentation frame metadata…', 10);
    const metadata = readDocFrameMetadata(node);
    if (!metadata) {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: 'This frame is not recognized as a Tashil documentation frame.',
      });
      return;
    }

    if (metadata.docType === 'tokens') {
      reportProgress('Loading updated variable collection…', 15);
      const rawCollection = await loadRawCollectionData(metadata.targetId);
      if (!rawCollection) {
        emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
          ok: false,
          message: `Variable collection "${metadata.targetName}" could not be found.`,
        });
        return;
      }

      const doc = buildTokenDocDocument(
        rawCollection,
        tokenGroupingDepth ?? metadata.tokenGroupingDepth ?? 'all',
      );
      const result = await updateTokenDocFrameInPlace(
        node,
        doc,
        reportProgress,
        cancellation,
      );
      cancellation.throwIfCancelled();
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: result.ok,
        message: result.message,
        updatedTokensCount: result.updatedTokensCount,
      });
    } else if (metadata.docType === 'styles') {
      reportProgress('Loading updated local styles…', 15);
      const rawStyles = await loadRawStyleCollection(metadata.targetId as DocStyleKind);
      const doc = buildTokenDocDocument(
        rawStyles,
        tokenGroupingDepth ?? metadata.tokenGroupingDepth ?? 'all',
      );
      const result = await updateTokenDocFrameInPlace(
        node,
        doc,
        reportProgress,
        cancellation,
        { docType: 'styles', itemLabel: 'STYLE' },
      );
      cancellation.throwIfCancelled();
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: result.ok,
        message: result.message,
        updatedTokensCount: result.updatedTokensCount,
      });
    } else if (metadata.docType === 'component') {
      reportProgress('Locating master component node…', 15);
      let componentNode: ComponentNode | ComponentSetNode | undefined;
      const allNodes = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
      const matched = allNodes.find(
        (n) => n.name === metadata.targetId || n.name === metadata.targetName || n.id === metadata.targetId,
      );
      if (matched) {
        componentNode = matched as ComponentNode | ComponentSetNode;
      }

      let connectionMeta: ConnectionMetadata = {
        componentName: metadata.targetName,
        importPath: `@tashilcar/swiss-army-knife`,
        schemaVersion: 5,
      };
      let figmaSnapshot: FigmaComponentSnapshot | undefined;
      let sourceSnapshot: SourceComponentSnapshot | undefined;

      if (componentNode) {
        figmaSnapshot = createFigmaComponentSnapshot(componentNode);
        const connection = readConnectionMetadata(componentNode);
        if (connection.ok) {
          connectionMeta = connection.metadata;
          sourceSnapshot = connection.metadata.mappingDocument?.sourceSnapshot;
        }
      }

      const doc = buildComponentDocDocument(connectionMeta, sourceSnapshot, figmaSnapshot);
      const result = await updateComponentDocFrameInPlace(
        node,
        doc,
        componentNode,
        reportProgress,
        cancellation,
      );
      cancellation.throwIfCancelled();
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: result.ok,
        message: result.message,
        updatedTokensCount: result.updatedPropsCount,
      });
    } else {
      emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
        ok: false,
        message: `In-place update for ${metadata.docType} is not supported.`,
      });
    }
  } catch (error) {
    if (isDocumentationGenerationCancelledError(error)) {
      return;
    }
    console.error('[Tashil Doc Update Error]', error);
    emit<UpdateDocsInPlaceResultHandler>('UPDATE_DOCS_IN_PLACE_RESULT', {
      ok: false,
      message: errorMessage(error, 'update documentation frame'),
    });
  }
}

export async function generateComponentDocs(
  targetToken: string,
  targetFormat: 'canvas' | 'markdown' = 'canvas',
): Promise<void> {
  const cancellation = beginDocumentationGeneration();
  const reportProgress = (message: string, percent: number) => {
    cancellation.throwIfCancelled();
    emit<DocGenerationProgressHandler>('DOC_GENERATION_PROGRESS', { message, percent });
  };

  try {
    reportProgress('Resolving target component…', 5);
    const targetResult = await resolveTargetById(targetToken);
    cancellation.throwIfCancelled();
    if (!targetResult.ok) {
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: false,
        message: targetResult.message,
      });
      return;
    }

    reportProgress('Extracting component properties & variants…', 15);
    const figmaSnapshot = createFigmaComponentSnapshot(targetResult.selection.mainComponent);
    const connection = readConnectionMetadata(targetResult.selection.mainComponent);
    const connectionMeta: ConnectionMetadata = connection.ok
      ? connection.metadata
      : {
          componentName: targetResult.selection.mainComponent.name,
          importPath: `@tashilcar/swiss-army-knife`,
          schemaVersion: 5,
        };
    const sourceSnapshot = connection.ok
      ? connection.metadata.mappingDocument?.sourceSnapshot
      : undefined;

    const doc = buildComponentDocDocument(connectionMeta, sourceSnapshot, figmaSnapshot);

    if (targetFormat === 'markdown') {
      reportProgress('Formatting Markdown specification…', 70);
      const markdown = emitComponentDocMarkdown(doc);
      cancellation.throwIfCancelled();
      reportProgress('Done!', 100);
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: true,
        message: 'Component markdown documentation generated.',
        markdown,
      });
    } else {
      const frame = await createComponentDocFrame(
        doc,
        {
          cancellation,
          componentNode: targetResult.selection.mainComponent,
        },
        reportProgress,
      );
      cancellation.throwIfCancelled();
      figma.notify(`Generated variant matrix for <${doc.componentName} />.`);
      emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
        ok: true,
        message: `Generated variant matrix for <${doc.componentName} />.`,
        frameNodeId: frame.id,
      });
    }
  } catch (error) {
    if (isDocumentationGenerationCancelledError(error)) {
      return;
    }
    emit<GenerateComponentDocsResultHandler>('GENERATE_COMPONENT_DOCS_RESULT', {
      ok: false,
      message: errorMessage(error, 'generate component documentation'),
    });
  }
}
