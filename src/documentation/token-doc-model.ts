/**
 * Pure builder for Token Documentation documents (IR).
 *
 * Takes variable collections and token data, groups them into logical semantic
 * sections, resolves mode values and aliases, and computes deterministic hashes.
 */

import { formatColor } from '../sync-tokens/serialize';
import type { ColorValue } from '../sync-tokens/types';
import type {
  TokenDocDocument,
  TokenDocItem,
  TokenDocMode,
  TokenDocSection,
  TokenDocValue,
  TokenGroupingDepth,
} from './types';

export type RawVariableValue = {
  aliasTargetName?: string;
  isColor?: boolean;
  isFloat?: boolean;
  value: ColorValue | number | string | boolean;
};

export type RawCollectionData = {
  collectionId: string;
  collectionName: string;
  defaultModeId?: string;
  modes: Array<{ modeId: string; name: string }>;
  tokens: Array<{
    description?: string;
    id: string;
    name: string;
    scopes?: string[];
    valuesByMode: Record<string, RawVariableValue>;
  }>;
};

export function summarizeTokenDocGroups(
  tokenNames: readonly string[],
  collectionName: string,
  groupingDepth: TokenGroupingDepth = 'all',
): { groupCount: number; groupNames: string[] } {
  const groups = new Map<string, string>();

  for (const tokenName of tokenNames) {
    const segments = tokenName.split('/').map((segment) => segment.trim()).filter(Boolean);
    const { groupKey, groupTitle } = inferSectionGrouping(segments, collectionName, groupingDepth);
    if (!groups.has(groupKey)) {
      groups.set(groupKey, formatDynamicHeadline(groupTitle));
    }
  }

  return {
    groupCount: groups.size,
    groupNames: [...groups.values()],
  };
}

export function buildTokenDocDocument(
  collection: RawCollectionData,
  groupingDepth: TokenGroupingDepth = 'all',
): TokenDocDocument {
  const modes: TokenDocMode[] = collection.modes.map((mode) => ({
    modeId: mode.modeId,
    name: mode.name,
  }));

  const sectionsMap = new Map<string, { groupTitle: string; id: string; tokens: TokenDocItem[] }>();

  for (const token of collection.tokens) {
    const segments = token.name.split('/').map((s) => s.trim()).filter(Boolean);
    const { groupKey, groupTitle } = inferSectionGrouping(
      segments,
      collection.collectionName,
      groupingDepth,
    );

    const valuesByMode: Record<string, TokenDocValue> = {};
    for (const mode of modes) {
      const raw = token.valuesByMode[mode.modeId];
      if (raw) {
        valuesByMode[mode.modeId] = formatDocValue(raw, mode.modeId, mode.name);
      }
    }

    const docItem: TokenDocItem = {
      id: token.id,
      name: token.name,
      pathSegments: segments,
      scopes: token.scopes ?? [],
      valuesByMode,
      ...(token.description ? { description: token.description } : {}),
    };

    const existing = sectionsMap.get(groupKey);
    if (existing) {
      existing.tokens.push(docItem);
    } else {
      sectionsMap.set(groupKey, {
        groupTitle,
        id: groupKey,
        tokens: [docItem],
      });
    }
  }

  const sections: TokenDocSection[] = [];
  for (const [key, sectionData] of sectionsMap.entries()) {
    const headline = formatDynamicHeadline(sectionData.groupTitle);
    const description = generateDynamicSectionDescription(
      headline,
      sectionData.tokens,
      collection.collectionName,
    );

    sections.push({
      description,
      headline,
      id: key,
      tokens: sectionData.tokens,
    });
  }
  const totalTokens = collection.tokens.length;
  const title = collection.collectionName;
  const description = `Comprehensive design tokens and variable values for ${collection.collectionName} across ${modes.length} mode${modes.length === 1 ? '' : 's'}.`;

  return {
    collectionId: collection.collectionId,
    collectionName: collection.collectionName,
    contentHash: computeCollectionHash(collection, groupingDepth),
    description,
    heroBadgeGradient: inferCollectionGradient(collection.collectionName),
    groupingDepth,
    modes,
    sections,
    title,
    totalTokens,
  };
}

function inferSectionGrouping(
  segments: string[],
  collectionName: string,
  groupingDepth: TokenGroupingDepth,
): { groupKey: string; groupTitle: string } {
  if (segments.length === 0) {
    return { groupKey: 'general', groupTitle: 'General' };
  }

  if (segments.length === 1) {
    return { groupKey: 'general', groupTitle: 'General' };
  }

  // Check if first segment is redundant with collection name or generic root
  let relevantSegments = segments;
  const firstLower = segments[0].toLowerCase();
  const colNameLower = collectionName.toLowerCase();

  if (
    (firstLower === colNameLower ||
      firstLower === 'color' ||
      firstLower === 'colors' ||
      firstLower === 'token' ||
      firstLower === 'tokens') &&
    segments.length > 2
  ) {
    relevantSegments = segments.slice(1);
  }

  // Group is the requested number of folder levels before the leaf token name.
  // `all` preserves the historical behavior for existing documents.
  const candidateGroupSegments = relevantSegments.slice(0, relevantSegments.length - 1);
  const maxLevels = groupingDepth === 'all'
    ? candidateGroupSegments.length
    : Number(groupingDepth);
  const groupSegments = candidateGroupSegments.slice(0, maxLevels);
  const groupTitle = groupSegments.join(' / ');
  const groupKey = groupSegments.map((s) => s.toLowerCase()).join('-');

  return {
    groupKey,
    groupTitle,
  };
}

export function formatDynamicHeadline(groupTitle: string): string {
  if (!groupTitle || groupTitle.toLowerCase() === 'general') {
    return 'General';
  }

  // Split by slashes if subgrouped (e.g. "Button / Primary" or "Surface")
  const parts = groupTitle.split('/').map((part) => {
    const trimmed = part.trim();
    // If it's all lowercase or separated by dashes/underscores, title-case it
    if (trimmed.includes('-') || trimmed.includes('_') || trimmed === trimmed.toLowerCase()) {
      return trimmed
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
    return trimmed;
  });

  return parts.join(' / ');
}

export function generateDynamicSectionDescription(
  headline: string,
  tokens: TokenDocItem[],
  collectionName: string,
): string {
  const lowerName = headline.toLowerCase();
  const lowerCollection = collectionName.toLowerCase();

  // Inspect token types
  let hasColor = false;
  let hasNumber = false;
  let hasBoolean = false;

  for (const token of tokens) {
    for (const val of Object.values(token.valuesByMode)) {
      if (val.resolvedType === 'COLOR' || val.hexColor) hasColor = true;
      if (val.resolvedType === 'FLOAT' || typeof val.rawValue === 'number') hasNumber = true;
      if (val.resolvedType === 'BOOLEAN' || typeof val.rawValue === 'boolean') hasBoolean = true;
    }
  }

  // 1. Semantic contextual heuristics
  if (
    lowerName.includes('surface') ||
    lowerName.includes('bg') ||
    lowerName.includes('background') ||
    lowerName.includes('canvas')
  ) {
    return 'Tokens defining background surfaces, container fills, and layered canvas elevations.';
  }
  if (
    lowerName.includes('border') ||
    lowerName.includes('stroke') ||
    lowerName.includes('divider') ||
    lowerName.includes('outline')
  ) {
    return 'Stroke and boundary definitions for component outlines, dividers, and container edges.';
  }
  if (
    lowerName.includes('text') ||
    lowerName.includes('typography') ||
    lowerName.includes('label') ||
    lowerName.includes('heading')
  ) {
    return 'Typography colors and tokens for readable content, labels, and text hierarchy.';
  }
  if (lowerName.includes('icon') || lowerName.includes('glyph') || lowerName.includes('symbol')) {
    return 'Foreground fills and indicators for icons, symbols, and visual cues.';
  }
  if (
    lowerName.includes('accent') ||
    lowerName.includes('badge') ||
    lowerName.includes('tag') ||
    lowerName.includes('highlight')
  ) {
    return 'Accent tokens and highlight color definitions for badges, tags, and categorical emphasis.';
  }
  if (lowerName.includes('link') || lowerName.includes('anchor') || lowerName.includes('nav')) {
    return 'Interactive link and navigation tokens for actionable text and breadcrumbs.';
  }
  if (
    lowerName.includes('interactive') ||
    lowerName.includes('state') ||
    lowerName.includes('hover') ||
    lowerName.includes('pressed') ||
    lowerName.includes('focus')
  ) {
    return 'Stateful tokens defining interactive feedback for hover, active, and focus states.';
  }
  if (
    lowerName.includes('feedback') ||
    lowerName.includes('alert') ||
    lowerName.includes('status') ||
    lowerName.includes('success') ||
    lowerName.includes('error') ||
    lowerName.includes('warning') ||
    lowerName.includes('danger')
  ) {
    return 'Status and messaging tokens for feedback indicators, alerts, and system notifications.';
  }
  if (
    lowerName.includes('spacing') ||
    lowerName.includes('space') ||
    lowerName.includes('gap') ||
    lowerName.includes('padding') ||
    lowerName.includes('margin')
  ) {
    return 'Spatial scale tokens establishing systematic layout rhythm, padding, and gaps.';
  }
  if (
    lowerName.includes('radius') ||
    lowerName.includes('radii') ||
    lowerName.includes('corner') ||
    lowerName.includes('shape')
  ) {
    return 'Corner radius tokens controlling boundary rounding for components and containers.';
  }
  if (lowerName.includes('shadow') || lowerName.includes('elevation') || lowerName.includes('depth')) {
    return 'Elevation and depth tokens establishing spatial hierarchy across layers.';
  }
  if (lowerName.includes('opacity') || lowerName.includes('alpha') || lowerName.includes('transparency')) {
    return 'Alpha and opacity tokens for subtle overlays, scrims, and disabled states.';
  }

  // 2. Component-specific groups (e.g. Button, Input, Modal, etc.)
  if (
    lowerName.includes('component') ||
    lowerName.includes('button') ||
    lowerName.includes('input') ||
    lowerName.includes('card') ||
    lowerName.includes('modal') ||
    lowerName.includes('dialog') ||
    lowerName.includes('tab') ||
    lowerName.includes('table') ||
    lowerName.includes('avatar')
  ) {
    return `Token specifications and variable values designated for ${headline} components.`;
  }

  // 3. Dynamic fallbacks by dominant data type and context
  if (hasColor || lowerCollection.includes('color')) {
    return `Color definitions and variables for ${headline} styling across all modes.`;
  }
  if (hasNumber || lowerCollection.includes('spacing') || lowerCollection.includes('radius')) {
    return `Numeric scale tokens and values defined for ${headline}.`;
  }
  if (hasBoolean) {
    return `Boolean configuration flags and conditional tokens for ${headline}.`;
  }

  return `Token specifications and theme variables designated for ${headline}.`;
}

function formatDocValue(
  raw: RawVariableValue,
  modeId: string,
  modeName: string,
): TokenDocValue {
  if (typeof raw.value === 'object' && raw.value !== null && 'r' in raw.value) {
    const hex = formatColor(raw.value as ColorValue, 'hex');
    return {
      hexColor: hex,
      modeId,
      modeName,
      rawValue: hex,
      resolvedType: 'COLOR',
      ...(raw.aliasTargetName ? { aliasTargetName: raw.aliasTargetName } : {}),
    };
  }

  if (typeof raw.value === 'number') {
    return {
      modeId,
      modeName,
      rawValue: raw.value,
      resolvedType: 'FLOAT',
      unit: raw.isFloat ? 'px' : undefined,
      ...(raw.aliasTargetName ? { aliasTargetName: raw.aliasTargetName } : {}),
    };
  }

  if (typeof raw.value === 'boolean') {
    return {
      modeId,
      modeName,
      rawValue: raw.value,
      resolvedType: 'BOOLEAN',
      ...(raw.aliasTargetName ? { aliasTargetName: raw.aliasTargetName } : {}),
    };
  }

  return {
    modeId,
    modeName,
    rawValue: String(raw.value),
    resolvedType: 'STRING',
    ...(raw.aliasTargetName ? { aliasTargetName: raw.aliasTargetName } : {}),
  };
}

function inferCollectionGradient(name: string): { from: string; to: string; via?: string } {
  const lower = name.toLowerCase();
  if (lower.includes('color')) {
    return { from: '#E7000B', via: '#F54900', to: '#2463EB' };
  }
  if (lower.includes('spacing') || lower.includes('space') || lower.includes('layout')) {
    return { from: '#2463EB', to: '#009689' };
  }
  if (lower.includes('radius') || lower.includes('shape')) {
    return { from: '#7F22FE', to: '#E60076' };
  }
  return { from: '#2463EB', to: '#101828' };
}

export function computeCollectionHash(
  collection: RawCollectionData,
  groupingDepth: TokenGroupingDepth = 'all',
): string {
  const parts: string[] = [collection.collectionName];
  // Keep the legacy full-depth hash byte-for-byte compatible with documents
  // generated before grouping depth was configurable.
  if (groupingDepth !== 'all') {
    parts.push(`grouping-depth:${groupingDepth}`);
  }
  for (const mode of collection.modes) {
    parts.push(`mode:${mode.modeId}:${mode.name}`);
  }
  for (const token of collection.tokens) {
    parts.push(`token:${token.id}:${token.name}`);
    for (const [modeId, val] of Object.entries(token.valuesByMode)) {
      parts.push(`v:${modeId}:${val.aliasTargetName ?? ''}:${JSON.stringify(val.value)}`);
    }
  }
  return hashString(parts.join('|'));
}

function hashString(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}
