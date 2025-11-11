import { runtimeError } from '@prisma-next/runtime-core';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';

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

function extractTypeIdsFromColumns(contract: SqlContract<SqlStorage>): Map<string, string> {
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

export function validateContractCodecMappings(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  const typeIds = extractTypeIdsFromColumns(contract);
  const invalidCodecs: Array<{ table: string; column: string; typeId: string }> = [];

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

export function validateCodecRegistryCompleteness(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  validateContractCodecMappings(registry, contract);
}
