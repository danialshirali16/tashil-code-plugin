/**
 * Pure domain model for automated documentation generation and in-place updating.
 *
 * 100% Figma-free and serializable so models, builders, and diff engines can be
 * thoroughly unit-tested without the Figma runtime.
 */

export const DOC_FRAME_SCHEMA_VERSION = 1;
export const DOC_METADATA_PLUGIN_KEY = 'tashil_doc_meta';

export type DocType = 'component' | 'foundations' | 'tokens';

export type DocFrameMetadata = {
  contentHash: string;
  docType: DocType;
  generatedAt: string;
  modeIds: string[];
  schemaVersion: typeof DOC_FRAME_SCHEMA_VERSION;
  targetId: string;
  targetName: string;
};

export type TokenDocValue = {
  aliasTargetName?: string;
  hexColor?: string;
  modeId: string;
  modeName: string;
  rawValue: string | number | boolean;
  resolvedType: 'BOOLEAN' | 'COLOR' | 'FLOAT' | 'STRING';
  unit?: string;
};

export type TokenDocItem = {
  description?: string;
  id: string;
  name: string;
  pathSegments: string[];
  scopes: string[];
  valuesByMode: Record<string, TokenDocValue>;
};

export type TokenDocSection = {
  description: string;
  headline: string;
  id: string;
  tokens: TokenDocItem[];
};

export type TokenDocMode = {
  modeId: string;
  name: string;
};

export type TokenDocDocument = {
  collectionId: string;
  collectionName: string;
  contentHash: string;
  description: string;
  heroBadgeGradient?: { from: string; to: string; via?: string };
  modes: TokenDocMode[];
  sections: TokenDocSection[];
  title: string;
  totalTokens: number;
};

export type ComponentDocProp = {
  defaultValue?: string | number | boolean;
  description?: string;
  mappedFigmaProperty?: string;
  name: string;
  required: boolean;
  role: string;
  typeName: string;
  values?: Array<string | number | boolean>;
};

export type ComponentDocVariant = {
  combination: Record<string, string | boolean>;
  nodeId?: string;
  title: string;
};

export type ComponentDocMatrixAxis = {
  propertyName: string;
  values: string[];
};

export type ComponentDocMatrixCell = {
  combination: Record<string, string>;
  title: string;
};

export type ComponentDocMatrixRow = {
  cells: ComponentDocMatrixCell[];
  rowHeader: { propertyName: string; value: string };
};

export type ComponentDocMatrixTierGroup = {
  colStart?: number;
  label: string;
  propertyName: string;
  rowStart?: number;
  span: number;
  value: string;
};

export type ComponentDocMatrixTier = {
  groups: ComponentDocMatrixTierGroup[];
  propertyName: string;
};

export type ComponentDocMatrix = {
  columnHeaders: Array<{ propertyName: string; value: string }>;
  primaryXAxis: ComponentDocMatrixAxis;
  primaryYAxis: ComponentDocMatrixAxis;
  rows: ComponentDocMatrixRow[];
  secondaryXAxes?: ComponentDocMatrixAxis[];
  xTiers?: ComponentDocMatrixTier[];
  yTiers?: ComponentDocMatrixTier[];
};

export type ComponentDocDocument = {
  componentName: string;
  contentHash: string;
  description: string;
  figmaComponentName: string;
  importPath: string;
  lifecycle?: string;
  matrix?: ComponentDocMatrix;
  props: ComponentDocProp[];
  runtimeRequirements: string[];
  sampleUsageCode: string;
  storybookUrl?: string;
  variants: ComponentDocVariant[];
};

export type DocDriftKind =
  | 'component-prop-changed'
  | 'mode-added'
  | 'mode-removed'
  | 'token-added'
  | 'token-removed'
  | 'token-renamed'
  | 'token-value-changed'
  | 'variant-changed';

export type DocDriftItem = {
  details?: string;
  kind: DocDriftKind;
  message: string;
  modeId?: string;
  targetName: string;
};

export type DocDriftReport = {
  changes: DocDriftItem[];
  hasDrift: boolean;
  targetId: string;
  targetName: string;
};
