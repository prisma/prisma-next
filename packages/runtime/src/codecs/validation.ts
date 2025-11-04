import type { SqlContract, SqlStorage } from '@prisma-next/sql/contract-types';
import type { CodecRegistry } from '@prisma-next/sql-target';

/**
 * Extracts all unique scalar types from a contract's storage tables.
 *
 * Iterates through all tables and columns, collecting the `type` field
 * from each column definition. Returns a Set of unique scalar type strings.
 *
 * @param contract - The SQL contract to extract types from
 * @returns Set of unique scalar type strings (e.g., 'text', 'int4', 'timestamptz')
 */
export function extractScalarTypes(contract: SqlContract<SqlStorage>): Set<string> {
  const types = new Set<string>();

  for (const table of Object.values(contract.storage.tables)) {
    for (const column of Object.values(table.columns)) {
      if (column.type) {
        types.add(column.type);
      }
    }
  }

  return types;
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
 * Extracts all typeIds declared in extension decorations.
 *
 * @param contract - The contract to extract typeIds from
 * @returns Map of table.column → typeId
 */
function extractTypeIdsFromExtensions(
  contract: SqlContract<SqlStorage>,
): Map<string, string> {
  const typeIds = new Map<string, string>();

  if (!contract.extensions) {
    return typeIds;
  }

  for (const [_namespace, extension] of Object.entries(contract.extensions)) {
    if (typeof extension !== 'object' || extension === null) {
      continue;
    }

    const ext = extension as {
      decorations?: {
        columns?: Array<{
          ref?: { kind?: string; table?: string; column?: string };
          payload?: { typeId?: string };
        }>;
      };
    };

    if (ext.decorations?.columns) {
      for (const decoration of ext.decorations.columns) {
        if (
          decoration.ref?.kind === 'column' &&
          decoration.ref.table &&
          decoration.ref.column &&
          decoration.payload?.typeId
        ) {
          const key = `${decoration.ref.table}.${decoration.ref.column}`;
          typeIds.set(key, decoration.payload.typeId);
        }
      }
    }
  }

  return typeIds;
}

/**
 * Validates that all declared typeIds in extension decorations have codec implementations.
 *
 * Checks that:
 * - All typeIds declared in extension decorations exist in the registry
 *
 * @param registry - The codec registry to validate against
 * @param contract - The contract to check
 * @throws RuntimeError with code 'RUNTIME.CODEC_MISSING' if any typeIds are missing
 */
export function validateContractCodecMappings(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  const typeIds = extractTypeIdsFromExtensions(contract);
  const invalidCodecs: Array<{ table: string; column: string; typeId: string }> = [];

  // Check that all declared typeIds have codec implementations
  for (const [key, typeId] of typeIds.entries()) {
    if (!registry.has(typeId)) {
      const [table, column] = key.split('.');
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
      `Missing codec implementations for declared typeIds: ${invalidCodecs.map((c) => `${c.table}.${c.column} (${c.typeId})`).join(', ')}`,
      details,
    );
  }
}

/**
 * Validates that a codec registry contains codecs for all requirements of the contract.
 *
 * Checks:
 * 1. All typeIds declared in extension decorations have codec implementations
 * 2. For columns without typeId, there is at least one codec for the scalar type
 *
 * @param registry - The codec registry to validate
 * @param contract - The contract to check against
 * @throws RuntimeError with code 'RUNTIME.CODEC_MISSING' if any requirements are missing
 */
export function validateCodecRegistryCompleteness(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  // First validate that all declared typeIds have implementations
  validateContractCodecMappings(registry, contract);

  // Then validate scalar types for columns without typeId
  const typeIds = extractTypeIdsFromExtensions(contract);
  const requiredTypes = extractScalarTypes(contract);
  const missingTypes: string[] = [];

  // Only check scalar types for columns that don't have a typeId
  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      const key = `${tableName}.${columnName}`;
      // Skip columns that have a typeId (they're already validated above)
      if (typeIds.has(key)) {
        continue;
      }

      // For columns without typeId, ensure there's a codec for the scalar type
      if (column.type) {
        const codecs = registry.getByScalar(column.type);
        if (codecs.length === 0 && !missingTypes.includes(column.type)) {
          missingTypes.push(column.type);
        }
      }
    }
  }

  if (missingTypes.length > 0) {
    throw runtimeError(
      'RUNTIME.CODEC_MISSING',
      `Missing codecs for contract scalar types (columns without typeId): ${missingTypes.join(', ')}`,
      {
        missingTypes,
        contractTarget: contract.target,
      },
    );
  }
}

