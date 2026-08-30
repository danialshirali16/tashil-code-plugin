import { emit } from '@create-figma-plugin/utilities';
import { formatGeneratedCode, type OutputPreferences } from '../output-preferences';
import { GenerationContext } from '../layout/generation-context';
import type { LayoutSourceNode } from '../layout/figma-layout-extractor';
import {
  generateReactLayout,
  supportsReactLayout,
} from '../layout/react-layout';
import {
  buildTokenDocDocument,
} from '../documentation/token-doc-model';
import { diffComponentDocument, diffTokenDocument } from '../documentation/doc-diff';
import {
  buildComponentDocDocument,
} from '../documentation/component-doc-model';
import {
  readDocFrameMetadata,
} from '../documentation/figma-canvas-updater';
import type { DocStyleKind } from '../documentation/types';
import type {
  CanvasTargetStateHandler,
  ConnectionMetadata,
  DocFrameSelectedHandler,
  FigmaComponentSnapshot,
  InspectCodeState,
  InspectCodeStateHandler,
  SourceComponentSnapshot,
  UiTargetState,
} from '../types';
import {
  type ConnectionReadResult,
  type ResolvedSelection,
} from './types';
import { loadOutputPreferences } from './preferences';
import {
  createConnectedOutput,
  inspectSceneNode,
} from './codegen-adapter';
import {
  createConnectionReferences,
  createFigmaComponentSnapshot,
  createSelectionLayoutName,
  createSelectionVariantLogic,
  createTargetState,
  readConnectionMetadata,
  resolveSelection,
} from './connection-adapter';
import { loadRawCollectionData } from './token-adapter';
import { loadRawStyleCollection } from './doc-adapter';

export let latestSelectionRefreshRequestId = 0;

export async function sendSelectionState(
  source: 'initial' | 'refresh' | 'selectionchange',
): Promise<void> {
  const requestId = ++latestSelectionRefreshRequestId;
  const selectedNodes = [...figma.currentPage.selection];

  try {
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const selection = selectedNode ? await resolveSelection(selectedNode) : null;

    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const connection = selection
      ? readConnectionMetadata(selection.mainComponent)
      : null;
    const state = await createCanvasTargetState(selectedNodes, selection, connection);
    const inspectState = formatInspectCodeState(await createInspectCodeState(
      selectedNodes,
      selectedNode,
      selection,
      connection,
    ), await loadOutputPreferences());

    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    emitCanvasTargetState(source, state);
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', inspectState);

    if (selectedNodes.length === 1) {
      const docMetadata = readDocFrameMetadata(selectedNodes[0]);
      if (docMetadata) {
        let drift;
        if (docMetadata.docType === 'tokens') {
          const rawCol = await loadRawCollectionData(docMetadata.targetId);
          if (rawCol) {
            const currentDoc = buildTokenDocDocument(
              rawCol,
              docMetadata.tokenGroupingDepth ?? 'all',
            );
            drift = diffTokenDocument(docMetadata, currentDoc);
          }
        } else if (docMetadata.docType === 'styles') {
          const rawStyles = await loadRawStyleCollection(docMetadata.targetId as DocStyleKind);
          const currentDoc = buildTokenDocDocument(
            rawStyles,
            docMetadata.tokenGroupingDepth ?? 'all',
          );
          drift = diffTokenDocument(docMetadata, currentDoc);
        } else if (docMetadata.docType === 'component') {
          const allNodes = figma.currentPage.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] });
          const matched = allNodes.find(
            (n) => n.name === docMetadata.targetId || n.name === docMetadata.targetName || n.id === docMetadata.targetId,
          );
          let connectionMeta: ConnectionMetadata = {
            componentName: docMetadata.targetName,
            importPath: `@tashilcar/swiss-army-knife`,
            schemaVersion: 5,
          };
          let figmaSnapshot: FigmaComponentSnapshot | undefined;
          let sourceSnapshot: SourceComponentSnapshot | undefined;
          if (matched) {
            figmaSnapshot = createFigmaComponentSnapshot(matched);
            const connection = readConnectionMetadata(matched);
            if (connection.ok) {
              connectionMeta = connection.metadata;
              sourceSnapshot = connection.metadata.mappingDocument?.sourceSnapshot;
            }
          }
          const currentDoc = buildComponentDocDocument(connectionMeta, sourceSnapshot, figmaSnapshot);
          drift = diffComponentDocument(docMetadata, currentDoc);
        }
        emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {
          frameNodeId: selectedNodes[0].id,
          metadata: docMetadata,
          drift,
        });
      } else {
        emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
      }
    } else {
      emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
    }
  } catch (error) {
    if (!isCurrentSelectionRefresh(requestId, selectedNodes)) {
      return;
    }

    const message = createSelectionRefreshFailureMessage(error);
    emitCanvasTargetState(source, {
      status: 'empty',
      message,
    });
    emit<InspectCodeStateHandler>('INSPECT_CODE_STATE', {
      status: 'invalid-selection',
      message,
    });
    emit<DocFrameSelectedHandler>('DOC_FRAME_SELECTED', {});
  }
}

export function formatInspectCodeState(state: InspectCodeState, preferences: OutputPreferences): InspectCodeState {
  if (state.status === 'connected') {
    return { ...state, output: { ...state.output, code: formatGeneratedCode(state.output.code, preferences) } };
  }
  if (state.status === 'layout') {
    return {
      ...state,
      layout: { ...state.layout, tsx: formatGeneratedCode(state.layout.tsx, preferences) },
      ...(state.variantLogic ? { variantLogic: { ...state.variantLogic, code: formatGeneratedCode(state.variantLogic.code, preferences) } } : {}),
    };
  }
  return state;
}

export function emitCanvasTargetState(
  source: 'initial' | 'refresh' | 'selectionchange',
  state: UiTargetState,
): void {
  emit<CanvasTargetStateHandler>('CANVAS_TARGET_STATE', { source, state });
}

export function isCurrentSelectionRefresh(
  requestId: number,
  selectedNodes: ReadonlyArray<SceneNode>,
): boolean {
  return requestId === latestSelectionRefreshRequestId
    && matchesCurrentSelection(selectedNodes);
}

export function createSelectionRefreshFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const summary = detail === ''
    ? 'Could not refresh the current selection.'
    : `Could not refresh the current selection: ${detail}`;

  return [
    summary,
    'Try changing the selection or reopening the plugin.',
  ].join('\n');
}

export function matchesCurrentSelection(selectedNodes: ReadonlyArray<SceneNode>): boolean {
  const currentSelection = figma.currentPage.selection;

  return currentSelection.length === selectedNodes.length
    && currentSelection.every((node, index) => node.id === selectedNodes[index].id);
}

export async function createInspectCodeState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selectedNode: SceneNode | null,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): Promise<InspectCodeState> {
  if (selectedNodes.length === 0) {
    return { status: 'invalid-selection' };
  }

  if (selectedNodes.length > 1) {
    return {
      status: 'invalid-selection',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single layer to generate its React layout.',
      ].join('\n'),
    };
  }

  if (selection) {
    if (!connection || !connection.ok) {
      if (connection?.issue) {
        return {
          status: 'connection-issue',
          connectionIssue: connection.issue,
          message: connection.message,
        };
      }
      if (selectedNode && supportsReactLayout(selectedNode)) {
        const context = new GenerationContext();
        const [layout, inspection] = await Promise.all([
          generateReactLayout(
            selectedNode as unknown as LayoutSourceNode,
            {
              context,
              rootName: createSelectionLayoutName(selection),
            },
          ),
          inspectSceneNode(selectedNode, context),
        ]);
        return {
          status: 'layout',
          ...(isOutsideMainComponent(selectedNode)
            ? { showUnconnectedComponents: true }
            : {}),
          layout,
          inspection,
          variantLogic: createSelectionVariantLogic(selection),
        };
      }
      return { status: 'not-connected' };
    }

    const output = await createConnectedOutput(
      connection.metadata,
      selection,
      selectedNode ?? selection.mainComponent,
    );
    return {
      status: 'connected',
      output: {
        code: output.code,
        deprecation: output.deprecation,
        diagnostics: output.diagnostics,
        explanation: output.explanation,
        references: createConnectionReferences(connection.metadata),
        runtimeRequirements: output.runtimeRequirements,
      },
    };
  }

  if (selectedNode) {
    if (supportsReactLayout(selectedNode)) {
      return {
        status: 'layout',
        ...(isOutsideMainComponent(selectedNode)
          ? { showUnconnectedComponents: true }
          : {}),
        layout: await generateReactLayout(
          selectedNode as unknown as LayoutSourceNode,
        ),
      };
    }

    return {
      status: 'inspection',
      inspection: await inspectSceneNode(selectedNode),
    };
  }

  return { status: 'invalid-selection' };
}

export function isOutsideMainComponent(node: SceneNode): boolean {
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return false;
  }

  let parent: BaseNode | null = node.parent;
  while (parent && parent.type !== 'PAGE' && parent.type !== 'DOCUMENT') {
    if (parent.type === 'COMPONENT' || parent.type === 'COMPONENT_SET') {
      return false;
    }
    parent = parent.parent;
  }

  return true;
}

export async function createCanvasTargetState(
  selectedNodes: ReadonlyArray<SceneNode>,
  selection: ResolvedSelection | null,
  connection: ConnectionReadResult | null,
): Promise<UiTargetState> {
  if (selectedNodes.length === 0) {
    return {
      status: 'empty',
      message: 'Select a component instance, main component, or component set to connect it.',
    };
  }

  if (selectedNodes.length > 1) {
    return {
      status: 'empty',
      message: [
        `${selectedNodes.length} layers selected.`,
        'Select a single component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  if (!selection) {
    const node = selectedNodes[0];
    return {
      status: 'empty',
      message: [
        `"${node.name}" (${node.type}) is not connectable.`,
        'Select a component instance, main component, or component set.',
      ].join('\n'),
    };
  }

  return createTargetState(
    selection,
    connection ?? readConnectionMetadata(selection.mainComponent),
  );
}
