/**
 * Schema version of the connection metadata persisted on Figma components.
 *
 * Bump this whenever {@link ConnectionMetadata} changes in a backwards-incompatible
 * way and add a migration in the read path. Stored data written by older plugin
 * builds (without this field) is treated as version 1.
 */
export const CURRENT_SCHEMA_VERSION = 4;
export const DEFAULT_CHILDREN_TEXT_PROPERTY = 'label';

export const CONNECTION_NAMESPACE = 'tashil_storybook';
export const CONNECTION_KEY = 'connection';

import type { FrameInspection } from './inspect/types';
import type { ReactLayoutResult } from './layout/types';
import type { VariantLogicResult } from './layout/variant-logic';
import type { FigmaSemanticSnapshot, SemanticConnectionRecipe } from './semantic/types';

export type PropMapping = {
  prop: string;
  value: string | number | boolean;
  raw?: boolean;
};

/** The full Figma-property → React-prop mapping table stored on a component. */
export type PropMappings = Record<string, Record<string, PropMapping>>;

export type SourcePropValue = string | number | boolean;

export type SourcePropRole =
  | 'advanced'
  | 'children'
  | 'event'
  | 'standard'
  | 'unsupported';

export type SourcePropDescriptor = {
  defaultValue?: SourcePropValue;
  name: string;
  required: boolean;
  role: SourcePropRole;
  typeName: string;
  values?: SourcePropValue[];
};

export type SourceComponentSnapshot = {
  componentName: string;
  contentHash: string;
  fileName: string;
  propsTypeName?: string;
  props: SourcePropDescriptor[];
};

export type FigmaPropertyType = 'BOOLEAN' | 'INSTANCE_SWAP' | 'TEXT' | 'VARIANT';

export type FigmaPropertyDescriptor = {
  defaultValue?: string | boolean;
  id: string;
  name: string;
  options: string[];
  rawKey: string;
  type: FigmaPropertyType;
};

export type FigmaComponentSnapshot = {
  componentId: string;
  componentName: string;
  properties: FigmaPropertyDescriptor[];
};

export type PropertyValueMapping = {
  figmaValue: string;
  sourceValue: SourcePropValue;
};

export type PropertyMappingKind = 'children' | 'instance-swap' | 'property';

export type PropertyMapping = {
  figmaPropertyId: string;
  figmaPropertyName: string;
  /** Omitted by early v4 documents; omission means a standard property mapping. */
  kind?: PropertyMappingKind;
  sourceProp: string;
  values: PropertyValueMapping[];
};

/** Authoring state used to maintain and reconcile a connection over time. */
export type MappingDocument = {
  figmaSnapshot: FigmaComponentSnapshot;
  lastValidatedAt?: string;
  /** Prop-mapping groups owned by the visual editor, including recently unmapped slots. */
  managedFigmaProperties?: string[];
  mappings: PropertyMapping[];
  revision: number;
  sourceSnapshot?: SourceComponentSnapshot;
};

export type ChildrenMode = 'icon-only' | 'none' | 'text';

export type ConnectionMetadata = {
  /** Runtime metadata is always normalized to the schema this build understands. */
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  /** Current Figma main component/set name used as the design-side reference. */
  figmaComponentName?: string;
  /** Exported source-code component used for imports and generated JSX. */
  componentName: string;
  importPath: string;
  storybookUrl?: string;
  sourcePath?: string;
  sourceUrl?: string;
  updatedAt?: string;
  /** How generated TSX renders children. Defaults to text. */
  childrenMode?: ChildrenMode;
  /** Figma string property used for text children or the icon aria-label. */
  childrenTextProperty?: string;
  /** Named component rendered as the icon child. Required in icon-only mode. */
  iconComponentName?: string;
  /** Module containing iconComponentName. Required in icon-only mode. */
  iconImportPath?: string;
  propMappings?: PropMappings;
  /** Optional authoring state; codegen continues to consume propMappings. */
  mappingDocument?: MappingDocument;
  /**
   * Optional semantic connection recipe (independently versioned). When
   * present, Dev Mode and Inspect Code resolve usage through the semantic
   * pipeline instead of `propMappings`.
   */
  semanticRecipe?: SemanticConnectionRecipe;
};

export type ConnectionIssueReason =
  | 'future-schema-version'
  | 'invalid-metadata'
  | 'invalid-root'
  | 'invalid-schema-version'
  | 'malformed-json'
  | 'unsupported-schema-version';

export type ConnectionIssue = {
  message: string;
  reason: ConnectionIssueReason;
};

export type ConnectionReferences = {
  storybookUrl?: string;
  sourcePath?: string;
  sourceUrl?: string;
  updatedAt?: string;
};

export type ComponentConnectionStatus =
  | 'connected'
  | 'needs-attention'
  | 'not-connected';

export type ComponentInventoryItem = {
  componentName: string;
  nodeType: 'COMPONENT' | 'COMPONENT_SET';
  pageName: string;
  status: ComponentConnectionStatus;
  targetToken: string;
};

export type ComponentInventoryState =
  | {
      scannedPages: number;
      status: 'scanning';
      totalPages: number;
    }
  | {
      items: ComponentInventoryItem[];
      scannedPages: number;
      status: 'ready';
      totalPages: number;
    }
  | {
      items: ComponentInventoryItem[];
      message: string;
      scannedPages: number;
      skippedPageNames: string[];
      status: 'partial';
      totalPages: number;
    }
  | {
      message: string;
      status: 'error';
    };

export type UiTargetState =
  | {
      status: 'ready';
      targetToken: string;
      componentName: string;
      figmaSnapshot?: FigmaComponentSnapshot;
      /** Nested design values eligible for semantic connect authoring. */
      semanticSnapshot?: FigmaSemanticSnapshot;
      existingConnection?: ConnectionMetadata;
      connectionIssue?: ConnectionIssue;
      message: string;
    }
  | {
      status: 'empty';
      targetToken?: never;
      componentName?: never;
      existingConnection?: never;
      connectionIssue?: never;
      message: string;
    };

export type InspectCodeComponentOutput = {
  code: string;
  diagnostics?: string;
  references?: ConnectionReferences;
  /** Semantic connections: which design values produced each code prop. */
  explanation?: string;
  /** Semantic connections: props supplied by application code, one per line. */
  runtimeRequirements?: string;
  /** Semantic connections: advisory deprecation notice; code stays available. */
  deprecation?: string;
};

export type InspectCodeState =
  | { status: 'invalid-selection'; message?: string }
  | { status: 'not-connected' }
  | { status: 'connection-issue'; message: string; connectionIssue: ConnectionIssue }
  | { status: 'connected'; output: InspectCodeComponentOutput }
  | {
      status: 'layout';
      layout: ReactLayoutResult;
      inspection?: FrameInspection;
      showUnconnectedComponents?: boolean;
      variantLogic?: VariantLogicResult;
    }
  | { status: 'inspection'; inspection: FrameInspection };

export type OpenExternalHandler = {
  name: 'OPEN_EXTERNAL';
  handler: (payload: {
    target: 'source' | 'storybook';
    url: string;
  }) => void;
};

export type CodegenBlock = {
  title: string;
  language: 'CSS' | 'PLAINTEXT' | 'TYPESCRIPT';
  code: string;
};

export type CanvasTargetStateHandler = {
  name: 'CANVAS_TARGET_STATE';
  handler: (payload: {
    source: 'initial' | 'refresh' | 'selectionchange';
    state: UiTargetState;
  }) => void;
};

export type ComponentInventoryStateHandler = {
  name: 'COMPONENT_INVENTORY_STATE';
  handler: (payload: {
    scanId: string;
    state: ComponentInventoryState;
  }) => void;
};

export type ComponentTargetStateHandler = {
  name: 'COMPONENT_TARGET_STATE';
  handler: (payload: {
    requestId: string;
    state: UiTargetState;
  }) => void;
};

export type InspectCodeStateHandler = {
  name: 'INSPECT_CODE_STATE';
  handler: (state: InspectCodeState) => void;
};

export type SaveConnectionHandler = {
  name: 'SAVE_CONNECTION';
  handler: (payload: {
    operationId: string;
    targetToken: string;
    metadata: ConnectionMetadata;
  }) => void;
};

export type ClearConnectionHandler = {
  name: 'CLEAR_CONNECTION';
  handler: (payload: {
    operationId: string;
    targetToken: string;
  }) => void;
};

export type RefreshSelectionHandler = {
  name: 'REFRESH_SELECTION';
  handler: () => void;
};

export type ScanComponentsHandler = {
  name: 'SCAN_COMPONENTS';
  handler: (payload: { scanId: string }) => void;
};

export type OpenComponentTargetHandler = {
  name: 'OPEN_COMPONENT_TARGET';
  handler: (payload: { requestId: string; targetToken: string }) => void;
};

export type ResizeWindowHandler = {
  name: 'RESIZE_WINDOW';
  handler: (size: { width: number; height: number }) => void;
};

export type CloseHandler = {
  name: 'CLOSE';
  handler: () => void;
};

export type SaveResultHandler = {
  name: 'SAVE_RESULT';
  handler: (result: {
    message: string;
    ok: boolean;
    operationId: string;
    operation: 'clear' | 'save';
    targetState?: UiTargetState;
    targetToken: string;
  }) => void;
};

/** UI -> main: request a prop-mapping scaffold for the current selection. */
export type ScaffoldPropMappingsHandler = {
  name: 'SCAFFOLD_PROP_MAPPINGS';
  handler: (payload: {
    operationId: string;
    targetToken: string;
  }) => void;
};

/** main -> UI: the scaffolded mappings (or a failure reason). */
export type ScaffoldResultHandler = {
  name: 'SCAFFOLD_RESULT';
  handler: (result: {
    mappings?: PropMappings;
    message?: string;
    ok: boolean;
    operationId: string;
    targetToken: string;
  }) => void;
};

/** UI -> main: request the list of local Variable collections for Sync Tokens. */
export type LoadTokenCollectionsHandler = {
  name: 'LOAD_TOKEN_COLLECTIONS';
  handler: () => void;
};

/** main -> UI: the available Variable collections (id, name, modes). */
export type LoadTokenCollectionsResultHandler = {
  name: 'LOAD_TOKEN_COLLECTIONS_RESULT';
  handler: (result: {
    ok: boolean;
    collections?: ReadonlyArray<import('./sync-tokens/types').TokenCollectionSummary>;
    message?: string;
  }) => void;
};

/** UI -> main: export the selected collections as CSS. */
export type ExportTokensHandler = {
  name: 'EXPORT_TOKENS';
  handler: (payload: {
    operationId: string;
    collectionIds: readonly string[];
    options: import('./sync-tokens/types').ExportOptions;
  }) => void;
};

/** UI -> main: generate selected CSS files for preview without downloading. */
export type PreviewTokensHandler = {
  name: 'PREVIEW_TOKENS';
  handler: (payload: {
    operationId: string;
    collectionIds: readonly string[];
    options: import('./sync-tokens/types').ExportOptions;
  }) => void;
};

/** main -> UI: generated files and preflight data for the latest preview. */
export type PreviewTokensResultHandler = {
  name: 'PREVIEW_TOKENS_RESULT';
  handler: (result: {
    ok: boolean;
    operationId: string;
    files?: ReadonlyArray<import('./sync-tokens/types').ExportFile>;
    message?: string;
  }) => void;
};

/** main -> UI: the generated CSS files (one per collection), or a failure. */
export type ExportTokensResultHandler = {
  name: 'EXPORT_TOKENS_RESULT';
  handler: (result: {
    ok: boolean;
    operationId: string;
    files?: ReadonlyArray<import('./sync-tokens/types').ExportFile>;
    message?: string;
  }) => void;
};
