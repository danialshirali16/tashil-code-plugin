import type {
  TokenAuditSummary,
  TokenConfidence,
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

type NumericTokenEntry = {
  token: TokenCandidateInput;
  value: number;
};

type ParsedHexColor = { r: number; g: number; b: number; a: number };

export interface TokenCandidateIndex {
  tokens: readonly TokenCandidateInput[];
  compatibleByProperty: Record<TokenPropertyKind, readonly TokenCandidateInput[]>;
  exactStringTokens: ReadonlyMap<string, readonly TokenCandidateInput[]>;
  rawStringTokens: ReadonlyMap<string, readonly TokenCandidateInput[]>;
  numericTokens: readonly NumericTokenEntry[];
  numericTokensByString: ReadonlyMap<string, readonly TokenCandidateInput[]>;
  originalOrder: ReadonlyMap<TokenCandidateInput, number>;
  affinityByProperty: Record<TokenPropertyKind, ReadonlyMap<TokenCandidateInput, number>>;
  lowercaseNameByToken: ReadonlyMap<TokenCandidateInput, string>;
  parsedColorByToken: ReadonlyMap<TokenCandidateInput, ParsedHexColor | undefined>;
}

export function rankTokenSuggestion(params: {
  property: TokenPropertyKind;
  currentValue: string | number;
  inferredVariable?: { id: string; name: string; key?: string };
  availableTokens?: TokenCandidateInput[];
  candidateIndex?: TokenCandidateIndex;
  nodeName?: string;
}): { suggestion?: TokenSuggestion; alternatives?: TokenSuggestion[] } {
  const {
    property,
    currentValue,
    inferredVariable,
    availableTokens = [],
    candidateIndex = createTokenCandidateIndex(availableTokens),
    nodeName,
  } = params;
  const matchingTokens = exactCandidatesForValue(candidateIndex, currentValue);

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
    const alternatives = matchingTokens
      .filter((t) => t.variableId !== inferredVariable.id)
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
  // Variable scopes are binding constraints, not hints: a token scoped away
  // from this property (a radius-only token offered for a gap) is never a
  // candidate, even when its value matches exactly.
  const scopeMatchingTokens = matchingTokens.filter((token) => isScopeCompatible(property, token.scopes));

  if (scopeMatchingTokens.length === 0) {
    // 3. No scope-compatible token holds this value: offer the closest
    // alternatives instead of a dead end — nearest scale step / nearest shade
    // first, then tokens named like the layer. Decision-only suggestions
    // (never auto-bound).
    return suggestByProximityAndName({
      property,
      currentValue,
      candidateIndex,
      nodeName,
    });
  }
  const candidateTokens = scopeMatchingTokens;

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
      alternatives: candidateTokens.filter((t) => t.variableId !== matched.variableId).map((t) => ({
        variableId: t.variableId,
        variableName: t.variableName,
        variableKey: t.variableKey,
        confidence: 'low',
        reason: 'Same value but alternate scope',
        source: 'exact-value',
      })),
    };
  }

  // Ambiguous / Multiple Candidates -> Prioritize by name signals. A word of
  // the layer's own name (rank 0) outranks every keyword tier; within keyword
  // tiers, semantic words (background…) outrank the generic bucket (color…),
  // and bare-number primitive scale steps rank one tier weaker.
  const contextWords = nodeName ? tokenizeWords(nodeName) : [];
  const keywordTierCount = PROPERTY_KEYWORD_TIERS[property].length;
  const rankOf = (token: TokenCandidateInput): number =>
    nodeNameAffinityLower(
      candidateIndex.lowercaseNameByToken.get(token) ?? token.variableName.toLowerCase(),
      contextWords,
    )
      ? 0
      : candidateIndex.affinityByProperty[property].get(token)
        ?? propertyAffinityTier(property, token.variableName);

  const prioritized = candidateTokens.slice().sort((a, b) => rankOf(a) - rankOf(b));

  const first = prioritized[0];
  const firstRank = rankOf(first);
  const secondRank = prioritized.length > 1 ? rankOf(prioritized[1]) : keywordTierCount + 1;
  const hasSemanticAffinity = firstRank < secondRank && firstRank <= keywordTierCount;

  return {
    suggestion: {
      variableId: first.variableId,
      variableName: first.variableName,
      variableKey: first.variableKey,
      confidence: hasSemanticAffinity ? 'medium' : 'low',
      reason: firstRank === 0
        ? `Matched token value (${currentValue}) and this layer's name`
        : hasSemanticAffinity
          ? `Matched token value (${currentValue}) with matching name affinity`
          : `Multiple tokens match value (${currentValue})`,
      source: hasSemanticAffinity ? 'scope-match' : 'exact-value',
    },
    alternatives: candidateTokens.filter((t) => t.variableId !== first.variableId).map((t) => ({
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
    ? 0
    : Math.round((boundPropertiesCount / totalPropertiesScanned) * 100);
  const audited = totalPropertiesScanned > 0;

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
    audited,
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
    case 'padding':
      return scopes.includes('GAP') || scopes.includes('WIDTH_HEIGHT');
    case 'opacity':
      return scopes.includes('OPACITY');
    default:
      return true;
  }
}

export function isValueEqual(a: string | number, b: string | number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 0.001;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return String(a).toLowerCase() === String(b).toLowerCase();
}

/** Shade distance (redmean, 0–765 scale) under which a color token counts as near. */
const NEAR_COLOR_MAX_DISTANCE = 40;
/** Relative distance under which a numeric token counts as near. */
const NEAR_NUMBER_RELATIVE_TOLERANCE = 0.3;
/** Absolute fallback for small scale steps; never applies to opacity (range 0–1). */
const NEAR_NUMBER_ABSOLUTE_TOLERANCE = 2;

const NODE_NAME_STOPWORDS = new Set([
  'frame', 'group', 'rectangle', 'ellipse', 'vector', 'text', 'line', 'row',
  'column', 'component', 'instance', 'section', 'container',
]);

/**
 * Property-keyword affinity tiers, strongest first. Tier-1 words say "this
 * token exists FOR this property kind" (background/bg/surface for fills);
 * the last tier is the generic bucket (color) that nearly every token name
 * matches on its own.
 */
const PROPERTY_KEYWORD_TIERS: Record<TokenPropertyKind, string[][]> = {
  fill: [
    ['background', 'bg', 'surface'],
    ['fill', 'base'],
    ['color'],
  ],
  stroke: [
    ['border', 'stroke'],
    ['line', 'divider'],
  ],
  cornerRadius: [
    ['radius', 'corner'],
  ],
  gap: [
    ['space', 'spacing'],
    ['gap', 'pad', 'padding'],
  ],
  padding: [
    ['space', 'spacing'],
    ['gap', 'pad', 'padding'],
  ],
  opacity: [
    ['opacity', 'alpha'],
    ['transparent'],
  ],
};

const TOKEN_PROPERTY_KINDS: readonly TokenPropertyKind[] = [
  'fill',
  'stroke',
  'cornerRadius',
  'gap',
  'padding',
  'opacity',
];

/**
 * Builds the scan-local lookup tables reused by every issue in one audit.
 * Callers that rank only one value can omit this and keep using
 * `rankTokenSuggestion({ availableTokens })` directly.
 */
export function createTokenCandidateIndex(
  tokens: readonly TokenCandidateInput[],
): TokenCandidateIndex {
  const tokenList = [...tokens];
  const exactStringTokens = new Map<string, TokenCandidateInput[]>();
  const rawStringTokens = new Map<string, TokenCandidateInput[]>();
  const numericTokens: NumericTokenEntry[] = [];
  const numericTokensByString = new Map<string, TokenCandidateInput[]>();
  const originalOrder = new Map<TokenCandidateInput, number>();
  const lowercaseNameByToken = new Map<TokenCandidateInput, string>();
  const parsedColorByToken = new Map<TokenCandidateInput, ParsedHexColor | undefined>();
  const compatibleByProperty = {} as Record<TokenPropertyKind, readonly TokenCandidateInput[]>;
  const affinityByProperty = {} as Record<
    TokenPropertyKind,
    ReadonlyMap<TokenCandidateInput, number>
  >;

  for (let index = 0; index < tokenList.length; index++) {
    const token = tokenList[index];
    originalOrder.set(token, index);
    lowercaseNameByToken.set(token, token.variableName.toLowerCase());

    if (typeof token.value === 'number') {
      if (Number.isFinite(token.value)) {
        numericTokens.push({ token, value: token.value });
      }
      appendTokenBucket(numericTokensByString, String(token.value).toLowerCase(), token);
    } else {
      appendTokenBucket(exactStringTokens, token.value.trim().toLowerCase(), token);
      appendTokenBucket(rawStringTokens, token.value.toLowerCase(), token);
    }

    parsedColorByToken.set(
      token,
      token.resolvedType === 'COLOR' && typeof token.value === 'string'
        ? parseHexColor(token.value)
        : undefined,
    );
  }

  numericTokens.sort((a, b) => a.value - b.value);
  for (const property of TOKEN_PROPERTY_KINDS) {
    const compatible = typeCompatibleCandidates(property, tokenList);
    compatibleByProperty[property] = compatible;
    affinityByProperty[property] = new Map(
      compatible.map((token) => [
        token,
        propertyAffinityTier(property, token.variableName),
      ]),
    );
  }

  return {
    tokens: tokenList,
    compatibleByProperty,
    exactStringTokens,
    rawStringTokens,
    numericTokens,
    numericTokensByString,
    originalOrder,
    affinityByProperty,
    lowercaseNameByToken,
    parsedColorByToken,
  };
}

function appendTokenBucket(
  map: Map<string, TokenCandidateInput[]>,
  key: string,
  token: TokenCandidateInput,
): void {
  const bucket = map.get(key);
  if (bucket) {
    bucket.push(token);
  } else {
    map.set(key, [token]);
  }
}

function exactCandidatesForValue(
  index: TokenCandidateIndex,
  currentValue: string | number,
): TokenCandidateInput[] {
  const candidates: TokenCandidateInput[] = [];

  if (typeof currentValue === 'number') {
    if (Number.isFinite(currentValue)) {
      const start = lowerBoundNumericTokens(index.numericTokens, currentValue - 0.001);
      for (let position = start; position < index.numericTokens.length; position++) {
        const entry = index.numericTokens[position];
        if (entry.value >= currentValue + 0.001) break;
        if (isValueEqual(entry.value, currentValue)) {
          candidates.push(entry.token);
        }
      }
    }
    candidates.push(...(index.rawStringTokens.get(String(currentValue).toLowerCase()) ?? []));
  } else {
    candidates.push(...(index.exactStringTokens.get(currentValue.trim().toLowerCase()) ?? []));
    candidates.push(...(index.numericTokensByString.get(currentValue.toLowerCase()) ?? []));
  }

  return Array.from(new Set(candidates)).sort(
    (a, b) => (index.originalOrder.get(a) ?? 0) - (index.originalOrder.get(b) ?? 0),
  );
}

function lowerBoundNumericTokens(
  entries: readonly NumericTokenEntry[],
  target: number,
): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (entries[middle].value < target) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}

/**
 * Path-segment words that mark an interaction state. A raw audited fill is in
 * its resting state, so a hover/active/… variant of the same value is not the
 * binding an audit should propose first.
 */
const INTERACTION_STATE_WORDS = [
  'hover', 'active', 'pressed', 'focus', 'selected', 'disabled', 'visited',
  'dragging', 'loading',
];

/**
 * Keyword affinity of a token name for a property, as a tier number (1 =
 * strongest; tiers.length + 1 = no keyword signal). Tokens whose last path
 * segment is a bare number (color/gray/100, primary/600) are primitive scale
 * steps rather than semantic choices, and tokens naming an interaction state
 * (background/neutral/transparent-hover) describe transient states rather
 * than resting values — both rank one tier weaker wherever they land, so a
 * same-value semantic resting token wins the suggestion.
 */
function propertyAffinityTier(property: TokenPropertyKind, tokenName: string): number {
  const tiers = PROPERTY_KEYWORD_TIERS[property];
  const nameLower = tokenName.toLowerCase();
  let tier = tiers.length + 1;
  for (let index = 0; index < tiers.length; index++) {
    if (tiers[index].some((keyword) => nameLower.includes(keyword))) {
      tier = index + 1;
      break;
    }
  }
  if (tier <= tiers.length && (isPrimitiveScaleName(nameLower) || hasInteractionStateSegment(nameLower))) {
    tier = Math.min(tier + 1, tiers.length + 1);
  }
  return tier;
}

function isPrimitiveScaleName(tokenNameLower: string): boolean {
  const segments = tokenNameLower.split('/');
  const last = segments[segments.length - 1]?.trim() ?? '';
  return /^\d+$/.test(last);
}

/**
 * Matches state words inside hyphenated segments too:
 * "background/neutral/transparent-hover" → segment words [transparent, hover].
 */
function hasInteractionStateSegment(tokenNameLower: string): boolean {
  return tokenNameLower
    .split('/')
    .some((segment) =>
      segment
        .split(/[^a-z]+/)
        .filter(Boolean)
        .some((word) => INTERACTION_STATE_WORDS.includes(word)),
    );
}

/**
 * A word of the layer's own name appearing in the token name. The layer says
 * what it is better than any naming convention does, so this signal outranks
 * every keyword tier.
 */
function nodeNameAffinityLower(
  tokenNameLower: string,
  contextWords: readonly string[],
): boolean {
  if (contextWords.length === 0) {
    return false;
  }
  return contextWords.some((word) => tokenNameLower.includes(word));
}

function tokenizeWords(raw: string): string[] {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length >= 3 && !NODE_NAME_STOPWORDS.has(word));
}

function isColorProperty(property: TokenPropertyKind): boolean {
  return property === 'fill' || property === 'stroke';
}

function typeCompatibleCandidates(
  property: TokenPropertyKind,
  tokens: readonly TokenCandidateInput[],
): TokenCandidateInput[] {
  // Scopes are binding constraints here too: proximity suggestions must stay
  // within tokens the property can legally bind.
  const wantType = isColorProperty(property) ? 'COLOR' : 'FLOAT';
  return tokens.filter(
    (token) => token.resolvedType === wantType && isScopeCompatible(property, token.scopes),
  );
}

function proximitySuggestion(
  token: TokenCandidateInput,
  confidence: TokenConfidence,
  reason: string,
  source: 'near-value' | 'name-match',
): TokenSuggestion {
  return {
    variableId: token.variableId,
    variableName: token.variableName,
    variableKey: token.variableKey,
    confidence,
    reason,
    source,
    suggestedValue: token.value,
  };
}

function suggestByProximityAndName(params: {
  property: TokenPropertyKind;
  currentValue: string | number;
  candidateIndex: TokenCandidateIndex;
  nodeName?: string;
}): { suggestion?: TokenSuggestion; alternatives?: TokenSuggestion[] } {
  const near = rankNearValueSuggestions(params);
  const byName = rankNameMatchSuggestions(params);
  const ordered = [...near, ...byName];
  if (ordered.length === 0) {
    return {};
  }
  return {
    suggestion: ordered[0],
    alternatives: ordered.length > 1 ? ordered.slice(1) : undefined,
  };
}

function rankNearValueSuggestions(params: {
  property: TokenPropertyKind;
  currentValue: string | number;
  candidateIndex: TokenCandidateIndex;
}): TokenSuggestion[] {
  const { property, currentValue, candidateIndex } = params;
  const candidates = candidateIndex.compatibleByProperty[property];
  if (candidates.length === 0) {
    return [];
  }

  if (isColorProperty(property) && typeof currentValue === 'string') {
    const current = parseHexColor(currentValue);
    if (!current) {
      return [];
    }
    const withDistance: Array<{ token: TokenCandidateInput; distance: number }> = [];
    for (const token of candidates) {
      const tokenColor = candidateIndex.parsedColorByToken.get(token);
      if (!tokenColor) continue;
      if (current.r === tokenColor.r && current.g === tokenColor.g && current.b === tokenColor.b) {
        // Same RGB, different alpha: binding keeps the paint's own opacity,
        // so this is visually identical — the strongest proximity signal.
        withDistance.push({ token, distance: -1 });
        continue;
      }
      const distance = colorDistance(current, tokenColor);
      if (distance <= NEAR_COLOR_MAX_DISTANCE) {
        withDistance.push({ token, distance });
      }
    }
    withDistance.sort((a, b) => a.distance - b.distance);
    return withDistance.slice(0, 3).map(({ token, distance }) => proximitySuggestion(
      token,
      distance < 0 ? 'medium' : 'low',
      distance < 0
        ? 'Matches token color — only paint opacity differs'
        : 'Nearest token color by shade distance',
      'near-value',
    ));
  }

  if (!isColorProperty(property) && typeof currentValue === 'number') {
    const withDistance: Array<{ token: TokenCandidateInput; distance: number; affinity: number }> = [];
    for (const token of candidates) {
      if (typeof token.value !== 'number') continue;
      const diff = Math.abs(token.value - currentValue);
      if (diff <= 0.001) continue; // Equal values were handled by the exact phase.
      const withinRelative = diff / Math.max(Math.abs(currentValue), 1e-6) <= NEAR_NUMBER_RELATIVE_TOLERANCE;
      const withinAbsolute = property !== 'opacity' && diff <= NEAR_NUMBER_ABSOLUTE_TOLERANCE;
      if (withinRelative || withinAbsolute) {
        withDistance.push({
          token,
          distance: diff,
          affinity: candidateIndex.affinityByProperty[property].get(token)
            ?? propertyAffinityTier(property, token.variableName),
        });
      }
    }
    withDistance.sort((a, b) => a.distance - b.distance || a.affinity - b.affinity);
    return withDistance.slice(0, 3).map(({ token }) => proximitySuggestion(
      token,
      'low',
      `Nearest token value (${token.value} vs ${currentValue})`,
      'near-value',
    ));
  }

  return [];
}

function rankNameMatchSuggestions(params: {
  property: TokenPropertyKind;
  candidateIndex: TokenCandidateIndex;
  nodeName?: string;
}): TokenSuggestion[] {
  const { property, candidateIndex, nodeName } = params;
  const contextWords = nodeName ? tokenizeWords(nodeName) : [];
  if (contextWords.length === 0) {
    // Property keywords alone ("color", "bg", …) match almost every token
    // name; without a layer-name signal a name suggestion would be noise.
    return [];
  }
  const candidates = candidateIndex.compatibleByProperty[property];
  const keywordTierCount = PROPERTY_KEYWORD_TIERS[property].length;
  const scored: Array<{ token: TokenCandidateInput; score: number; matchedWord: string }> = [];
  for (const token of candidates) {
    const nameLower = candidateIndex.lowercaseNameByToken.get(token)
      ?? token.variableName.toLowerCase();
    const matchedWord = contextWords.find((word) => nameLower.includes(word));
    if (!matchedWord) continue;
    const affinity = candidateIndex.affinityByProperty[property].get(token)
      ?? propertyAffinityTier(property, nameLower);
    const score = 3 + (affinity <= keywordTierCount ? 2 : 0);
    scored.push({ token, score, matchedWord });
  }
  if (scored.length === 0) {
    return [];
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 3).map(({ token, matchedWord }) => proximitySuggestion(
    token,
    'low',
    `Named like this layer ("${matchedWord}")`,
    'name-match',
  ));
}

function parseHexColor(hex: string): { r: number; g: number; b: number; a: number } | undefined {
  const match = /^#?([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(hex.trim());
  if (!match) {
    return undefined;
  }
  const digits = match[1];
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) : 255,
  };
}

/** redmean distance between two colors; alpha is ignored by design. */
function colorDistance(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const meanR = (a.r + b.r) / 2;
  const deltaR = a.r - b.r;
  const deltaG = a.g - b.g;
  const deltaB = a.b - b.b;
  return Math.sqrt(
    ((512 + meanR) * deltaR * deltaR) / 256
    + 4 * deltaG * deltaG
    + ((767 - meanR) * deltaB * deltaB) / 256,
  );
}
