import type {
  TokenAuditSummary,
  TokenPropertyIssue,
  TokenPropertyKind,
  TokenSuggestion,
} from './types';

export interface TokenCandidateInput {
  variableId: string;
  variableName: string;
  variableKey?: string;
  resolvedType: 'COLOR' | 'FLOAT' | 'STRING' | 'BOOLEAN';
  scopes: string[];
  value: string | number;
}

export function rankTokenSuggestion(params: {
  property: TokenPropertyKind;
  currentValue: string | number;
  inferredVariable?: { id: string; name: string; key?: string };
  availableTokens?: TokenCandidateInput[];
}): { suggestion?: TokenSuggestion; alternatives?: TokenSuggestion[] } {
  const { property, currentValue, inferredVariable, availableTokens = [] } = params;

  // 1. High Confidence: Figma inferredVariable
  if (inferredVariable) {
    const mainSuggestion: TokenSuggestion = {
      variableId: inferredVariable.id,
      variableName: inferredVariable.name,
      variableKey: inferredVariable.key,
      confidence: 'high',
      reason: 'Figma Inferred Variable match',
      source: 'inferred',
    };

    // Find other candidate tokens with same value as alternatives
    const alternatives = availableTokens
      .filter((t) => t.variableId !== inferredVariable.id && isValueEqual(t.value, currentValue))
      .map((t): TokenSuggestion => ({
        variableId: t.variableId,
        variableName: t.variableName,
        variableKey: t.variableKey,
        confidence: 'medium',
        reason: 'Matching raw value',
        source: 'exact-value',
      }));

    return { suggestion: mainSuggestion, alternatives };
  }

  // 2. Exact Value + Scope Compatibility matching
  const matchingTokens = availableTokens.filter((token) => isValueEqual(token.value, currentValue));

  if (matchingTokens.length === 0) {
    return {};
  }

  // Filter by property scope compatibility
  const scopeMatchingTokens = matchingTokens.filter((token) => isScopeCompatible(property, token.scopes));
  const candidateTokens = scopeMatchingTokens.length > 0 ? scopeMatchingTokens : matchingTokens;

  if (candidateTokens.length === 1) {
    const matched = candidateTokens[0];
    return {
      suggestion: {
        variableId: matched.variableId,
        variableName: matched.variableName,
        variableKey: matched.variableKey,
        confidence: 'medium',
        reason: `Matched token value (${currentValue}) and scope (${property})`,
        source: 'scope-match',
      },
      alternatives: matchingTokens.filter((t) => t.variableId !== matched.variableId).map((t) => ({
        variableId: t.variableId,
        variableName: t.variableName,
        variableKey: t.variableKey,
        confidence: 'low',
        reason: 'Same value but alternate scope',
        source: 'exact-value',
      })),
    };
  }

  // 3. Ambiguous / Multiple Candidates -> Prioritize by semantic name match
  const prioritized = candidateTokens.slice().sort((a, b) => {
    const aName = a.variableName.toLowerCase();
    const bName = b.variableName.toLowerCase();
    const aMatchesProp = (property === 'cornerRadius' && aName.includes('radius'))
      || ((property === 'gap' || property === 'spacing' || property === 'padding') && (aName.includes('space') || aName.includes('spacing') || aName.includes('gap') || aName.includes('pad')))
      || (property === 'fill' && (aName.includes('bg') || aName.includes('surface') || aName.includes('fill') || aName.includes('color')))
      || (property === 'stroke' && (aName.includes('border') || aName.includes('stroke') || aName.includes('line')));
    const bMatchesProp = (property === 'cornerRadius' && bName.includes('radius'))
      || ((property === 'gap' || property === 'spacing' || property === 'padding') && (bName.includes('space') || bName.includes('spacing') || bName.includes('gap') || bName.includes('pad')))
      || (property === 'fill' && (bName.includes('bg') || bName.includes('surface') || bName.includes('fill') || bName.includes('color')))
      || (property === 'stroke' && (bName.includes('border') || bName.includes('stroke') || bName.includes('line')));
    if (aMatchesProp && !bMatchesProp) return -1;
    if (!aMatchesProp && bMatchesProp) return 1;
    return 0;
  });

  const first = prioritized[0];
  const hasSemanticAffinity = (property === 'cornerRadius' && first.variableName.toLowerCase().includes('radius'))
    || ((property === 'gap' || property === 'spacing' || property === 'padding') && (first.variableName.toLowerCase().includes('space') || first.variableName.toLowerCase().includes('gap') || first.variableName.toLowerCase().includes('pad')))
    || (property === 'fill' && (first.variableName.toLowerCase().includes('bg') || first.variableName.toLowerCase().includes('surface') || first.variableName.toLowerCase().includes('fill') || first.variableName.toLowerCase().includes('color')));

  return {
    suggestion: {
      variableId: first.variableId,
      variableName: first.variableName,
      variableKey: first.variableKey,
      confidence: hasSemanticAffinity ? 'medium' : 'low',
      reason: hasSemanticAffinity
        ? `Matched token value (${currentValue}) with matching name affinity`
        : `Multiple tokens match value (${currentValue})`,
      source: hasSemanticAffinity ? 'scope-match' : 'exact-value',
    },
    alternatives: matchingTokens.filter((t) => t.variableId !== first.variableId).map((t) => ({
      variableId: t.variableId,
      variableName: t.variableName,
      variableKey: t.variableKey,
      confidence: 'low',
      reason: `Alternative token matching (${currentValue})`,
      source: 'exact-value',
    })),
  };
}

export function calculateTokenAuditSummary(
  boundPropertiesCount: number,
  issues: TokenPropertyIssue[],
): TokenAuditSummary {
  const unboundPropertiesCount = issues.length;
  const totalPropertiesScanned = boundPropertiesCount + unboundPropertiesCount;
  const tokenCoveragePercent = totalPropertiesScanned === 0
    ? 100
    : Math.round((boundPropertiesCount / totalPropertiesScanned) * 100);

  let highConfidenceCount = 0;
  let mediumConfidenceCount = 0;
  let lowConfidenceCount = 0;

  for (const issue of issues) {
    if (!issue.suggestion) continue;
    if (issue.suggestion.confidence === 'high') {
      highConfidenceCount++;
    } else if (issue.suggestion.confidence === 'medium') {
      mediumConfidenceCount++;
    } else if (issue.suggestion.confidence === 'low') {
      lowConfidenceCount++;
    }
  }

  return {
    totalPropertiesScanned,
    boundPropertiesCount,
    unboundPropertiesCount,
    tokenCoveragePercent,
    highConfidenceCount,
    mediumConfidenceCount,
    lowConfidenceCount,
    issues,
  };
}

export function filterHighConfidenceIssues(issues: TokenPropertyIssue[]): TokenPropertyIssue[] {
  return issues.filter(
    (issue) => issue.isEditableHere && issue.suggestion?.confidence === 'high',
  );
}

export function isScopeCompatible(property: TokenPropertyKind, scopes: string[]): boolean {
  if (!scopes || scopes.length === 0 || scopes.includes('ALL_SCOPES')) return true;
  switch (property) {
    case 'fill':
      return scopes.some((s) => s === 'ALL_FILLS' || s === 'FRAME_FILL' || s === 'SHAPE_FILL' || s === 'TEXT_FILL');
    case 'stroke':
      return scopes.includes('STROKE_COLOR') || scopes.includes('ALL_FILLS');
    case 'cornerRadius':
      return scopes.includes('CORNER_RADIUS');
    case 'gap':
    case 'spacing':
    case 'padding':
      return scopes.includes('GAP') || scopes.includes('WIDTH_HEIGHT');
    case 'opacity':
      return scopes.includes('OPACITY');
    default:
      return true;
  }
}

function isValueEqual(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.001;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}
