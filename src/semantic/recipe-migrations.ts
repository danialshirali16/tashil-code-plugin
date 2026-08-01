/**
 * In-memory semantic recipe schema migrations.
 *
 * Migrations are deliberately output-preserving: reading an older recipe may
 * normalize its document shape, but never changes bindings or promotes a
 * pending source contract. The normalized document is persisted only when the
 * user explicitly saves the connection.
 */

import { SEMANTIC_RECIPE_SCHEMA_VERSION } from './types';

export type RecipeDocumentMigrationResult =
  | { ok: true; value: Record<string, unknown>; migratedFrom?: number }
  | { ok: false; message: string };

type RecipeDocumentMigration = (
  value: Readonly<Record<string, unknown>>,
) => Record<string, unknown>;

/**
 * One entry for every previous schema version. New binding target/source kinds
 * must add their shape normalization to the migration that introduces them.
 */
const MIGRATIONS: Readonly<Record<number, RecipeDocumentMigration>> = {
  // v2 adds pending source-contract migration state, extraction diagnostics,
  // and nested INSTANCE_SWAP identity. All are optional, so v1 output is
  // preserved exactly and only the document version needs normalization.
  1: (value) => ({ ...value, schemaVersion: 2 }),
};

export function migrateRecipeDocument(
  value: Record<string, unknown>,
): RecipeDocumentMigrationResult {
  const version = value.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    return { message: 'Semantic recipe is missing a numeric schemaVersion.', ok: false };
  }
  if (version > SEMANTIC_RECIPE_SCHEMA_VERSION) {
    return {
      message: `Semantic recipe uses schema version ${version}, newer than this plugin supports (version ${SEMANTIC_RECIPE_SCHEMA_VERSION}). Update the plugin; the data was left unchanged.`,
      ok: false,
    };
  }
  if (version < 1) {
    return { message: `Semantic recipe uses unsupported schema version ${version}.`, ok: false };
  }

  let current = value;
  let currentVersion = version;
  while (currentVersion < SEMANTIC_RECIPE_SCHEMA_VERSION) {
    const migration = MIGRATIONS[currentVersion];
    if (!migration) {
      return {
        message: `Semantic recipe uses unsupported schema version ${currentVersion}.`,
        ok: false,
      };
    }
    current = migration(current);
    currentVersion += 1;
  }

  return {
    ok: true,
    value: current,
    ...(version === currentVersion ? {} : { migratedFrom: version }),
  };
}
