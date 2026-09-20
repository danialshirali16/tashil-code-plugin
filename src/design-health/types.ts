export type TokenConfidence = 'high' | 'medium' | 'low';

export type TokenPropertyKind =
  | 'fill'
  | 'stroke'
  | 'gap'
  | 'padding'
  | 'cornerRadius'
  | 'opacity';

export type TokenBindingField =
  | 'fills'
  | 'strokes'
  | 'cornerRadius'
  | 'itemSpacing'
  | 'paddingTop'
  | 'paddingRight'
  | 'paddingBottom'
  | 'paddingLeft'
  | 'opacity';

export interface TokenBindingTarget {
  field: TokenBindingField;
  paintIndex?: number;
}

export interface TokenSuggestion {
  variableId: string;
  variableName: string;
  variableKey?: string;
  confidence: TokenConfidence;
  reason: string;
  source: 'inferred' | 'exact-value' | 'scope-match' | 'near-value' | 'name-match';
  /**
   * The candidate's resolved value, populated only for near-value/name-match
   * suggestions whose value intentionally differs from the layer's raw value.
   */
  suggestedValue?: string | number;
}

export interface TokenPropertyIssue {
  id: string;
  nodeId: string;
  nodeName: string;
  property: TokenPropertyKind;
  bindingTarget: TokenBindingTarget;
  currentValue: string | number;
  isEditableHere: boolean;
  containerInstanceId?: string;
  suggestion?: TokenSuggestion;
  alternativeSuggestions?: TokenSuggestion[];
}

export interface TokenAuditSummary {
  /**
   * False when the scan traversed a selection with zero auditable properties
   * ("nothing to audit" must never render as 100% coverage).
   */
  audited: boolean;
  totalPropertiesScanned: number;
  boundPropertiesCount: number;
  unboundPropertiesCount: number;
  tokenCoveragePercent: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  issues: TokenPropertyIssue[];
}

export interface DeprecatedInstanceNotice {
  nodeId: string;
  instanceName: string;
  componentName: string;
  deprecationNotice: string;
}

export interface LibraryHealthSummary {
  totalInstances: number;
  uniqueComponentsCount: number;
  deprecatedInstances: DeprecatedInstanceNotice[];
  remoteInstancesCount: number;
  localInstancesCount: number;
}

export interface DesignHealthScanResult {
  scanId: string;
  targetNode: {
    id: string;
    name: string;
    type: string;
  };
  tokenAudit: TokenAuditSummary;
  libraryHealth: LibraryHealthSummary;
  /** Number of layers actually visited by the scan traversal. */
  nodesVisited: number;
  /** True when the node budget (800) cut the traversal short. */
  capReached: boolean;
  /** Size of the Figma selection at scan time; >1 means only the first layer was audited. */
  selectionCount: number;
  scannedAt: number;
}

export interface TokenBindingRequest {
  nodeId: string;
  property: TokenPropertyKind;
  variableId: string;
  bindingTarget: TokenBindingTarget;
}
