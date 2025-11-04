import type { SqlContract, SqlStorage } from '@prisma-next/sql/contract-types';
import type { CodecRegistry } from '@prisma-next/sql-target';

/**
 * Extracts all unique type IDs from a contract's storage tables.
 *
 * Iterates through all tables and columns, collecting the `type` field
 * from each column definition. Returns a Set of unique type ID strings.
 *
 * @param contract - The SQL contract to extract types from
 * @returns Set of unique type ID strings (e.g., 'pg/text@1', 'pg/int4@1')
 */
export function extractTypeIds(contract: SqlContract<SqlStorage>): Set<string> {
  const typeIds = new Set<string>();

  for (const table of Object.values(contract.storage.tables)) {
    for (const column of Object.values(table.columns)) {
      if (column.type) {
        typeIds.add(column.type);
      }
    }
  }

  return typeIds;
}

interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

function runtimeError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeErrorEnvelope {
  const error = new Error(message) as RuntimeErrorEnvelope;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code,
    category: 'RUNTIME' as const,
    severity: 'error' as const,
    message,
    details,
  });
}

/**
 * Extracts all typeIds from column types.
 *
 * @param contract - The contract to extract typeIds from
 * @returns Map of table.column → typeId
 */
function extractTypeIdsFromColumns(
  contract: SqlContract<SqlStorage>,
): Map<string, string> {
  const typeIds = new Map<string, string>();

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      if (column.type) {
        const key = `${tableName}.${columnName}`;
        typeIds.set(key, column.type);
      }
    }
  }

  return typeIds;
}

/**
 * Validates that all column typeIds have codec implementations.
 *
 * Checks that:
 * - All typeIds from column types exist in the registry
 *
 * @param registry - The codec registry to validate against
 * @param contract - The contract to check
 * @throws RuntimeError with code 'RUNTIME.CODEC_MISSING' if any typeIds are missing
 */
export function validateContractCodecMappings(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  const typeIds = extractTypeIdsFromColumns(contract);
  const invalidCodecs: Array<{ table: string; column: string; typeId: string }> = [];

  // Check that all column typeIds have codec implementations
  for (const [key, typeId] of typeIds.entries()) {
    if (!registry.has(typeId)) {
      const parts = key.split('.');
      const table = parts[0] ?? '';
      const column = parts[1] ?? '';
      invalidCodecs.push({ table, column, typeId });
    }
  }

  if (invalidCodecs.length > 0) {
    const details: Record<string, unknown> = {
      contractTarget: contract.target,
      invalidCodecs,
    };

    throw runtimeError(
      'RUNTIME.CODEC_MISSING',
      `Missing codec implementations for column typeIds: ${invalidCodecs.map((c) => `${c.table}.${c.column} (${c.typeId})`).join(', ')}`,
      details,
    );
  }
}

/**
 * Validates that a codec registry contains codecs for all requirements of the contract.
 *
 * Checks:
 * - All column typeIds have codec implementations
 *
 * @param registry - The codec registry to validate
 * @param contract - The contract to check against
 * @throws RuntimeError with code 'RUNTIME.CODEC_MISSING' if any requirements are missing
 */
export function validateCodecRegistryCompleteness(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  // Validate that all column typeIds have implementations
  validateContractCodecMappings(registry, contract);
}

