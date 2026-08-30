import { emit } from '@create-figma-plugin/utilities';
import { isRecord } from '../codegen';
import { diffTokenSnapshots } from '../sync-tokens/export-diff';
import { createTokenSnapshot, serializeTokenCollection } from '../sync-tokens/serialize-formats';
import type {
  AliasValue,
  ColorValue,
  ExportFile,
  ExportOptions,
  ResolvedTokenValue,
  Token,
  TokenCollection,
  TokenCollectionSummary,
  TokenExportWarning,
  TokenValue,
  VariableResolvedType,
} from '../sync-tokens/types';
import type {
  ExportTokensResultHandler,
  LoadTokenCollectionsResultHandler,
  PreviewTokensResultHandler,
} from '../types';
import type { RawCollectionData, RawVariableValue } from '../documentation/token-doc-model';
import { errorMessage } from './types';

export const TOKEN_EXPORT_HISTORY_KEY = 'tashil-token-export-history-v1';

let latestTokensExportId = '';
let latestTokensPreviewId = '';

export async function loadTokenCollections(): Promise<void> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const summaries: TokenCollectionSummary[] = collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      modes: collection.modes.map((mode) => ({ modeId: mode.modeId, name: mode.name })),
      defaultModeId: collection.defaultModeId,
      tokenCount: collection.variableIds.length,
    }));
    emit<LoadTokenCollectionsResultHandler>('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: true,
      collections: summaries,
    });
  } catch (error) {
    emit<LoadTokenCollectionsResultHandler>('LOAD_TOKEN_COLLECTIONS_RESULT', {
      ok: false,
      message: errorMessage(error, 'load variable collections'),
    });
  }
}

export async function exportTokens(
  operationId: string,
  collectionIds: readonly string[],
  options: ExportOptions,
): Promise<void> {
  latestTokensExportId = operationId;
  try {
    const files = await generateTokenFiles(
      collectionIds,
      options,
      () => latestTokensExportId === operationId,
    );
    if (files === null) {
      return;
    }
    await saveTokenExportHistory(files);
    emit<ExportTokensResultHandler>('EXPORT_TOKENS_RESULT', {
      ok: true,
      operationId,
      files,
    });
  } catch (error) {
    if (latestTokensExportId !== operationId) {
      return;
    }
    emit<ExportTokensResultHandler>('EXPORT_TOKENS_RESULT', {
      ok: false,
      operationId,
      message: errorMessage(error, 'export tokens'),
    });
  }
}

export async function previewTokens(
  operationId: string,
  collectionIds: readonly string[],
  options: ExportOptions,
): Promise<void> {
  latestTokensPreviewId = operationId;
  try {
    const files = await generateTokenFiles(
      collectionIds,
      options,
      () => latestTokensPreviewId === operationId,
    );
    if (files === null) {
      return;
    }
    emit<PreviewTokensResultHandler>('PREVIEW_TOKENS_RESULT', {
      ok: true,
      operationId,
      files,
    });
  } catch (error) {
    if (latestTokensPreviewId !== operationId) {
      return;
    }
    emit<PreviewTokensResultHandler>('PREVIEW_TOKENS_RESULT', {
      ok: false,
      operationId,
      message: errorMessage(error, 'preview tokens'),
    });
  }
}

export async function generateTokenFiles(
  collectionIds: readonly string[],
  options: ExportOptions,
  isCurrent: () => boolean,
): Promise<ExportFile[] | null> {
  const wantSet = new Set(collectionIds);
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();
  const collectionsById = new Map(
    collections.map((collection) => [collection.id, collection]),
  );
  const variablesById = new Map(
    variables.map((variable) => [variable.id, variable]),
  );
  const files: ExportFile[] = [];
  const previousHistory = await loadTokenExportHistory();

  for (const collection of collections) {
    if (!isCurrent()) {
      return null;
    }
    if (!wantSet.has(collection.id)) {
      continue;
    }
    const modeIds = options.modesByCollection[collection.id] ?? [collection.defaultModeId];
    const collectionSlug = slug(collection.name) || collection.id;
    for (const modeId of modeIds) {
      if (!isCurrent()) {
        return null;
      }
      const mode = collection.modes.find((item) => item.modeId === modeId);
      const warnings: TokenExportWarning[] = [];
      const configuredOverrides =
        options.aliasModeOverridesByCollectionMode?.[collection.id]?.[modeId] ?? {};
      const resolvedModeIds = new Map<string, string>([[collection.id, modeId]]);
      for (const [targetCollectionId, targetModeId] of Object.entries(configuredOverrides)) {
        const targetCollection = collectionsById.get(targetCollectionId);
        if (targetCollection?.modes.some((item) => item.modeId === targetModeId)) {
          resolvedModeIds.set(targetCollectionId, targetModeId);
        }
      }
      const tokens = await collectTokens(collection, modeId, {
        collectionsById,
        modeFallbackKeys: new Set(),
        modeIdsByCollection: resolvedModeIds,
        preferredModeName: mode?.name ?? '',
        sourceCollectionId: collection.id,
        sourceModeId: modeId,
        variablesById,
        warnings,
      }, options);
      const domain: TokenCollection = {
        id: collection.id,
        name: collection.name,
        modes: collection.modes.map((item) => ({
          modeId: item.modeId,
          name: item.name,
        })),
        defaultModeId: collection.defaultModeId,
        tokens,
      };
      const suffix = collection.modes.length > 1 && mode ? `-${slug(mode.name)}` : '';
      const serialized = serializeTokenCollection(domain, options);
      const name = `${collectionSlug}${suffix}.${serialized.extension}`;
      const tokenSnapshot = createTokenSnapshot(tokens);
      files.push({
        name,
        css: serialized.content,
        declarationCount: tokens.length,
        sourceVariableCount: collection.variableIds.length,
        warnings,
        diff: diffTokenSnapshots(previousHistory[name], tokenSnapshot),
        tokenSnapshot,
      });
    }
  }

  return files;
}

export type TokenExportHistory = Record<string, Record<string, string>>;

export async function loadTokenExportHistory(): Promise<TokenExportHistory> {
  try {
    const value = await figma.clientStorage?.getAsync(TOKEN_EXPORT_HISTORY_KEY) as unknown;
    return isRecord(value) ? value as TokenExportHistory : {};
  } catch (_error) {
    return {};
  }
}

export async function saveTokenExportHistory(files: readonly ExportFile[]): Promise<void> {
  try {
    const previous = await loadTokenExportHistory();
    const next: TokenExportHistory = { ...previous };
    for (const file of files) next[file.name] = { ...(file.tokenSnapshot ?? {}) };
    await figma.clientStorage?.setAsync(TOKEN_EXPORT_HISTORY_KEY, next);
  } catch (_error) {
    // Export history is informational and must never block a download.
  }
}

export type TokenResolutionContext = {
  collectionsById: Map<string, VariableCollection>;
  modeFallbackKeys: Set<string>;
  modeIdsByCollection: Map<string, string>;
  preferredModeName: string;
  sourceCollectionId: string;
  sourceModeId: string;
  variablesById: Map<string, Variable>;
  warnings: TokenExportWarning[];
};

export async function collectTokens(
  collection: VariableCollection,
  modeId: string,
  context: TokenResolutionContext,
  options: ExportOptions,
): Promise<Token[]> {
  const tokens: Token[] = [];
  for (const variableId of collection.variableIds) {
    const variable = await getVariable(variableId, context);
    if (variable === null) {
      context.warnings.push({
        code: 'missing-variable',
        message: `Variable ${variableId} is no longer available.`,
      });
      continue;
    }
    const raw = variable.valuesByMode[modeId];
    if (raw === undefined) {
      context.warnings.push({
        code: 'missing-mode-value',
        message: `No value exists for the selected mode.`,
        tokenName: variable.name,
      });
      continue;
    }
    const value = await normalizeValue(raw, variable.resolvedType, context);
    if (value === null) {
      context.warnings.push({
        code: 'unsupported-value',
        message: `The value type cannot be exported as CSS.`,
        tokenName: variable.name,
      });
      continue;
    }
    if (value.kind === 'alias' && value.value.resolvedValue === undefined) {
      context.warnings.push({
        code: 'unresolved-alias',
        message: `The referenced variable could not be resolved; the var() reference was preserved.`,
        tokenName: variable.name,
      });
    }
    if (
      options.convertPxToRem
      && variable.resolvedType === 'FLOAT'
      && (variable.scopes.length === 0 || variable.scopes.includes('ALL_SCOPES'))
      && tokenValueContainsNumber(value)
    ) {
      context.warnings.push({
        code: 'unknown-number-scope',
        message: `The numeric value stayed unitless because its Figma scope does not identify a length.`,
        tokenName: variable.name,
      });
    }
    tokens.push({
      id: variable.id,
      name: variable.name,
      resolvedType: variable.resolvedType as VariableResolvedType,
      scopes: variable.scopes as readonly string[],
      value,
    });
  }
  return tokens;
}

export async function getVariable(
  variableId: string,
  context: TokenResolutionContext,
): Promise<Variable | null> {
  const cached = context.variablesById.get(variableId);
  if (cached !== undefined) {
    return cached;
  }
  const variable = await figma.variables.getVariableByIdAsync(variableId);
  if (variable !== null) {
    context.variablesById.set(variable.id, variable);
  }
  return variable;
}

export function tokenValueContainsNumber(value: TokenValue): boolean {
  return value.kind === 'number'
    || (value.kind === 'alias' && value.value.resolvedValue?.kind === 'number');
}

export async function normalizeValue(
  raw: VariableValue,
  resolvedType: VariableResolvedDataType,
  context: TokenResolutionContext,
): Promise<TokenValue | null> {
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw };
  }
  if (typeof raw === 'number') {
    return { kind: 'number', value: raw };
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw };
  }
  const maybeAlias = raw as { type?: string; id?: string };
  if (maybeAlias.type === 'VARIABLE_ALIAS' && typeof maybeAlias.id === 'string') {
    const target = await getVariable(maybeAlias.id, context);
    const targetName = target?.name ?? maybeAlias.id;
    const resolvedValue = target === null
      ? null
      : await resolveVariableValue(target, context, new Set());
    const alias: AliasValue = {
      targetName,
      ...(resolvedValue === null ? {} : { resolvedValue }),
    };
    return { kind: 'alias', value: alias };
  }
  if (resolvedType === 'COLOR' || isColorShape(raw)) {
    const color = toColorValue(raw);
    if (color !== null) {
      return { kind: 'color', value: color };
    }
  }
  return null;
}

export async function resolveVariableValue(
  variable: Variable,
  context: TokenResolutionContext,
  visitedVariableIds: Set<string>,
): Promise<ResolvedTokenValue | null> {
  if (visitedVariableIds.has(variable.id)) {
    return null;
  }
  visitedVariableIds.add(variable.id);

  const modeId = await resolveVariableModeId(variable, context);
  if (modeId === null) {
    return null;
  }
  const raw = variable.valuesByMode[modeId];
  if (raw === undefined) {
    return null;
  }
  if (typeof raw === 'object' && raw !== null) {
    const alias = raw as { type?: string; id?: string };
    if (alias.type === 'VARIABLE_ALIAS' && typeof alias.id === 'string') {
      const target = await getVariable(alias.id, context);
      return target === null
        ? null
        : resolveVariableValue(target, context, visitedVariableIds);
    }
  }
  return normalizeResolvedValue(raw, variable.resolvedType);
}

export async function resolveVariableModeId(
  variable: Variable,
  context: TokenResolutionContext,
): Promise<string | null> {
  const cachedModeId = context.modeIdsByCollection.get(variable.variableCollectionId);
  if (cachedModeId !== undefined) {
    return cachedModeId;
  }

  let collection = context.collectionsById.get(variable.variableCollectionId);
  if (collection === undefined) {
    collection = await figma.variables.getVariableCollectionByIdAsync(
      variable.variableCollectionId,
    ) ?? undefined;
    if (collection !== undefined) {
      context.collectionsById.set(collection.id, collection);
    }
  }
  if (collection === undefined) {
    return null;
  }

  const preferredModeName = context.preferredModeName.trim().toLocaleLowerCase();
  const matchingMode = preferredModeName.length === 0
    ? undefined
    : collection.modes.find(
      (mode) => mode.name.trim().toLocaleLowerCase() === preferredModeName,
    );
  const modeId = matchingMode?.modeId ?? collection.defaultModeId;
  if (matchingMode === undefined && preferredModeName.length > 0) {
    const fallbackKey = `${collection.id}:${preferredModeName}`;
    if (!context.modeFallbackKeys.has(fallbackKey)) {
      const fallbackMode = collection.modes.find(
        (mode) => mode.modeId === collection.defaultModeId,
      );
      context.modeFallbackKeys.add(fallbackKey);
      context.warnings.push({
        code: 'mode-fallback',
        message: `No “${context.preferredModeName}” mode exists in ${collection.name}; using ${fallbackMode?.name ?? 'its default mode'}.`,
        tokenName: variable.name,
        sourceCollectionId: context.sourceCollectionId,
        sourceModeId: context.sourceModeId,
        targetCollectionId: collection.id,
        fallbackModeId: modeId,
      });
    }
  }
  context.modeIdsByCollection.set(collection.id, modeId);
  return modeId;
}

export function normalizeResolvedValue(
  raw: VariableValue,
  resolvedType: VariableResolvedDataType,
): ResolvedTokenValue | null {
  if (typeof raw === 'boolean') {
    return { kind: 'boolean', value: raw };
  }
  if (typeof raw === 'number') {
    return { kind: 'number', value: raw };
  }
  if (typeof raw === 'string') {
    return { kind: 'string', value: raw };
  }
  if (resolvedType === 'COLOR' || isColorShape(raw)) {
    const color = toColorValue(raw);
    return color === null ? null : { kind: 'color', value: color };
  }
  return null;
}

export function isColorShape(value: unknown): value is { r: number; g: number; b: number; a?: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { r, g, b } = value as { r?: unknown; g?: unknown; b?: unknown };
  return typeof r === 'number' && typeof g === 'number' && typeof b === 'number';
}

export function toColorValue(value: unknown): ColorValue | null {
  if (!isColorShape(value)) {
    return null;
  }
  return 'a' in value ? { r: value.r, g: value.g, b: value.b, a: value.a } : { r: value.r, g: value.g, b: value.b };
}

export function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function loadRawCollectionData(collectionId: string): Promise<RawCollectionData | null> {
  try {
    const collections = await figma.variables.getLocalVariableCollectionsAsync();
    const collection = collections.find((c) => c.id === collectionId);
    if (!collection) return null;

    const variables = await figma.variables.getLocalVariablesAsync();
    const variablesById = new Map(variables.map((v) => [v.id, v]));

    const tokens: RawCollectionData['tokens'] = [];
    for (const varId of collection.variableIds) {
      const variable = variablesById.get(varId);
      if (!variable) continue;

      const valuesByMode: Record<string, RawVariableValue> = {};
      for (const mode of collection.modes) {
        const val = variable.valuesByMode[mode.modeId];
        let aliasTargetName: string | undefined;
        let resolvedValue: unknown = val;

        if (typeof val === 'object' && val !== null && 'type' in val && val.type === 'VARIABLE_ALIAS') {
          const targetVar = variablesById.get((val as { id: string }).id);
          if (targetVar) {
            aliasTargetName = targetVar.name;
            const targetVal = targetVar.valuesByMode[mode.modeId] ?? Object.values(targetVar.valuesByMode)[0];
            resolvedValue = targetVal;
          }
        }

        valuesByMode[mode.modeId] = {
          aliasTargetName,
          isColor: variable.resolvedType === 'COLOR',
          isFloat: variable.resolvedType === 'FLOAT',
          value: (resolvedValue as ColorValue | number | string | boolean) ?? '',
        };
      }

      tokens.push({
        id: variable.id,
        name: variable.name,
        description: variable.description,
        scopes: variable.scopes,
        valuesByMode,
      });
    }

    return {
      collectionId: collection.id,
      collectionName: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((m) => ({ modeId: m.modeId, name: m.name })),
      tokens,
    };
  } catch (_e) {
    return null;
  }
}
