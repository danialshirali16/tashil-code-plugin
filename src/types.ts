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

export type UiSelectionState =
  | {
      status: 'ready';
      selectionToken: string;
      componentName: string;
      figmaSnapshot?: FigmaComponentSnapshot;
      existingConnection?: ConnectionMetadata;
      connectionIssue?: ConnectionIssue;
      message: string;
    }
  | {
      status: 'empty';
      selectionToken?: never;
      componentName?: never;
      existingConnection?: never;
      connectionIssue?: never;
      message: string;
    };

export type InspectCodeState = {
  status: 'connected' | 'connection-issue' | 'not-connected' | 'invalid-selection';
  code?: string;
  connectionIssue?: ConnectionIssue;
  diagnostics?: string;
  references?: ConnectionReferences;
  message?: string;
};

export type OpenExternalHandler = {
  name: 'OPEN_EXTERNAL';
  handler: (payload: {
    target: 'source' | 'storybook';
    url: string;
  }) => void;
};

export type CodegenBlock = {
  title: string;
  language: 'PLAINTEXT' | 'TYPESCRIPT';
  code: string;
};

export type SelectionStateHandler = {
  name: 'SELECTION_STATE';
  handler: (state: UiSelectionState) => void;
};

export type InspectCodeStateHandler = {
  name: 'INSPECT_CODE_STATE';
  handler: (state: InspectCodeState) => void;
};

export type SaveConnectionHandler = {
  name: 'SAVE_CONNECTION';
  handler: (payload: {
    operationId: string;
    selectionToken: string;
    metadata: ConnectionMetadata;
  }) => void;
};

export type ClearConnectionHandler = {
  name: 'CLEAR_CONNECTION';
  handler: (payload: { operationId: string; selectionToken: string }) => void;
};

export type RefreshSelectionHandler = {
  name: 'REFRESH_SELECTION';
  handler: () => void;
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
    selectionToken: string;
  }) => void;
};

/** UI -> main: request a prop-mapping scaffold for the current selection. */
export type ScaffoldPropMappingsHandler = {
  name: 'SCAFFOLD_PROP_MAPPINGS';
  handler: (payload: { operationId: string; selectionToken: string }) => void;
};

/** main -> UI: the scaffolded mappings (or a failure reason). */
export type ScaffoldResultHandler = {
  name: 'SCAFFOLD_RESULT';
  handler: (result: {
    mappings?: PropMappings;
    message?: string;
    ok: boolean;
    operationId: string;
    selectionToken: string;
  }) => void;
};
