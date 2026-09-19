export type TokenConfidence = 'high' | 'medium' | 'low';

export type TokenPropertyKind =
  | 'fill'
  | 'stroke'
  | 'spacing'
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
  source: 'inferred' | 'exact-value' | 'scope-match';
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
  totalPropertiesScanned: number;
  boundPropertiesCount: number;
  unboundPropertiesCount: number;
  tokenCoveragePercent: number;
  highConfidenceCount: number;
  mediumConfidenceCount: number;
  lowConfidenceCount: number;
  issues: TokenPropertyIssue[];
}

export interface ComponentReplacementCandidate {
  sourceComponentKey: string;
  sourceComponentName: string;
  instancesCount: number;
  instanceIds: string[];
}

export type PropertyCompatibilityStatus = 'preserved' | 'needs-review' | 'unmapped';

export interface PropertyCompatibility {
  name: string;
  normalizedName: string;
  sourceType: string;
  targetType?: string;
  targetName?: string;
  status: PropertyCompatibilityStatus;
  details?: string;
}

export interface CompatibilityPlan {
  sourceComponentKey: string;
  sourceComponentName: string;
  targetComponentKey: string;
  targetComponentName: string;
  instancesCount: number;
  properties: PropertyCompatibility[];
  preservedCount: number;
  needsReviewCount: number;
  atRiskCount: number;
  canAutoMigrate: boolean;
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
  componentCandidates: ComponentReplacementCandidate[];
  libraryHealth: LibraryHealthSummary;
  scannedAt: number;
}

export interface TokenBindingRequest {
  nodeId: string;
  property: TokenPropertyKind;
  variableId: string;
  bindingTarget: TokenBindingTarget;
}

export interface ComponentReplacementExecutionRequest {
  sourceComponentKey: string;
  targetComponentKey: string;
  instanceIds: string[];
  propertyMappings: Record<string, string>; // sourceNormalizedName -> targetNormalizedName
}

export interface ComponentReplacementExecutionResult {
  ok: boolean;
  replacedCount: number;
  failedCount: number;
  warningCount: number;
  message?: string;
}
