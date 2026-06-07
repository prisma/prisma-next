import type { Contract } from '@prisma-next/contract/types';
import { blindCast } from '@prisma-next/utils/casts';

/**
 * Resolve a cross-space FK `tableName` to the real table name from the
 * extension contract. Accepts either the exact real table name (TS path)
 * or the symbolic `modelName.toLowerCase()` fallback (PSL path).
 *
 * Lookup strategy (two steps):
 * 1. Exact match — find the model whose `storage['table'] === tableName`.
 *    This handles the TS case where the FK already carries the real table name.
 * 2. Model-name-lowercase match — find the model where
 *    `modelName.toLowerCase() === tableName`.
 *    This handles the PSL symbolic fallback (e.g. 'user' → finds 'User' → table 'users').
 *
 * When `targetColumns` is non-empty, every column is validated against the
 * resolved table's storage column set. Missing columns throw a diagnostic
 * naming the column, model, space, namespace, and the available column list.
 *
 * Throws a precise diagnostic when the lookup fails. This is an
 * internal-error path (M2 rejected authoring against an undeclared space),
 * but a precise message saves debug time if the invariant breaks.
 *
 * The function uses only framework-level types (`Contract.domain.namespaces`,
 * `model.storage` as `Readonly<Record<string, unknown>>`) to stay within the
 * framework domain and avoid importing SQL-domain types.
 */
export function resolveCrossSpaceFkTableName(
  extensionContract: Contract,
  spaceId: string,
  namespaceId: string,
  tableName: string,
  targetColumns: readonly string[] = [],
): string {
  const ns = extensionContract.domain.namespaces[namespaceId];
  if (ns === undefined) {
    const available = Object.keys(extensionContract.domain.namespaces).join(', ') || '(none)';
    throw new Error(
      `Cross-space FK resolution failed: namespace "${namespaceId}" not found in space "${spaceId}"; ` +
        `available namespaces: ${available}`,
    );
  }

  const models = ns.models;

  // Step 1: exact match on storage table name.
  let resolvedTableName: string | undefined;
  let resolvedModelName: string | undefined;
  for (const [modelName, model] of Object.entries(models)) {
    const storageTable = model.storage['table'];
    if (storageTable === tableName) {
      resolvedTableName = tableName;
      resolvedModelName = modelName;
      break;
    }
  }

  // Step 2: model-name-lowercase match (PSL symbolic fallback).
  if (resolvedTableName === undefined) {
    for (const [modelName, model] of Object.entries(models)) {
      if (modelName.toLowerCase() === tableName) {
        const storageTable = model.storage['table'];
        if (typeof storageTable === 'string') {
          resolvedTableName = storageTable;
          resolvedModelName = modelName;
          break;
        }
      }
    }
  }

  if (resolvedTableName === undefined || resolvedModelName === undefined) {
    const availableModels = Object.keys(models).join(', ') || '(none)';
    throw new Error(
      `Cross-space FK resolution failed: model not found for tableName "${tableName}" in ` +
        `space "${spaceId}" namespace "${namespaceId}"; available models: ${availableModels}`,
    );
  }

  // Validate that every requested column exists on the resolved table.
  if (targetColumns.length > 0) {
    const storageLike = blindCast<
      {
        namespaces: Record<
          string,
          { entries: { table: Record<string, { columns: Record<string, unknown> }> } }
        >;
      },
      'Contract.storage is cast narrowly to read column keys for existence validation'
    >(extensionContract.storage);
    const storageNs = storageLike.namespaces[namespaceId];
    const tableEntry = storageNs?.entries?.table?.[resolvedTableName];
    const availableCols = tableEntry ? Object.keys(tableEntry.columns) : [];
    for (const col of targetColumns) {
      if (!availableCols.includes(col)) {
        throw new Error(
          `column "${col}" not found on target model "${resolvedModelName}" in space "${spaceId}" namespace "${namespaceId}"; ` +
            `available columns: ${availableCols.join(', ') || '(none)'}`,
        );
      }
    }
  }

  return resolvedTableName;
}
