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
 * Validates that a codec registry contains codecs for all scalar types
 * required by the contract.
 *
 * Checks that for each scalar type found in the contract's storage tables,
 * there is at least one codec in the registry's `byScalar` map.
 *
 * @param registry - The codec registry to validate
 * @param contract - The contract to check against
 * @throws RuntimeError with code 'RUNTIME.CODEC_MISSING' if any types are missing
 */
export function validateCodecRegistryCompleteness(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  const requiredTypes = extractScalarTypes(contract);
  const missingTypes: string[] = [];

  for (const type of requiredTypes) {
    const codecs = registry.byScalar.get(type);
    if (!codecs || codecs.length === 0) {
      missingTypes.push(type);
    }
  }

  if (missingTypes.length > 0) {
    throw runtimeError(
      'RUNTIME.CODEC_MISSING',
      `Missing codecs for contract scalar types: ${missingTypes.join(', ')}`,
      {
        missingTypes,
        contractTarget: contract.target,
      },
    );
  }
}

