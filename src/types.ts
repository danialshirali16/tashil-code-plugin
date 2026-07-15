/**
 * Schema version of the connection metadata persisted on Figma components.
 *
 * Bump this whenever {@link ConnectionMetadata} changes in a backwards-incompatible
 * way and add a migration in the read path. Stored data written by older plugin
 * builds (without this field) is treated as version 1.
 */
export const CURRENT_SCHEMA_VERSION = 2;

export const CONNECTION_NAMESPACE = 'tashil_storybook';
export const CONNECTION_KEY = 'connection';

export type PropMapping = {
  prop: string;
  value: string | number | boolean;
  raw?: boolean;
};

/** The full Figma-property → React-prop mapping table stored on a component. */
export type PropMappings = Record<string, Record<string, PropMapping>>;

export type ConnectionMetadata = {
  schemaVersion?: number;
  componentName: string;
  importPath: string;
  storybookUrl?: string;
  sourcePath?: string;
  updatedAt?: string;
  defaultProps?: Record<string, string | number | boolean>;
  propMappings?: Record<string, Record<string, PropMapping>>;
};

export type UiSelectionState =
  | {
      status: 'ready';
      selectionToken: string;
      componentName: string;
      existingConnection?: ConnectionMetadata;
      message: string;
    }
  | {
      status: 'empty';
      selectionToken?: never;
      componentName?: never;
      existingConnection?: never;
      message: string;
    };

export type InspectCodeState = {
  status: 'connected' | 'not-connected' | 'invalid-selection';
  code?: string;
  references?: string;
  message?: string;
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
    selectionToken: string;
    metadata: ConnectionMetadata;
  }) => void;
};

export type ClearConnectionHandler = {
  name: 'CLEAR_CONNECTION';
  handler: (payload: { selectionToken: string }) => void;
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
    operation: 'clear' | 'save';
    selectionToken: string;
  }) => void;
};

/** UI -> main: request a prop-mapping scaffold for the current selection. */
export type ScaffoldPropMappingsHandler = {
  name: 'SCAFFOLD_PROP_MAPPINGS';
  handler: (payload: { selectionToken: string }) => void;
};

/** main -> UI: the scaffolded mappings (or a failure reason). */
export type ScaffoldResultHandler = {
  name: 'SCAFFOLD_RESULT';
  handler: (result: {
    mappings?: PropMappings;
    message?: string;
    ok: boolean;
    selectionToken: string;
  }) => void;
};
