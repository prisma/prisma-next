import { runtimeError } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';

export function extractCodecIds(contract: SqlContract<SqlStorage>): Set<string> {
  const codecIds = new Set<string>();

  for (const table of Object.values(contract.storage.tables)) {
    for (const column of Object.values(table.columns)) {
      const codecId = column.codecId;
      codecIds.add(codecId);
    }
  }

  return codecIds;
}

function extractCodecIdsFromColumns(contract: SqlContract<SqlStorage>): Map<string, string> {
  const codecIds = new Map<string, string>();

  for (const [tableName, table] of Object.entries(contract.storage.tables)) {
    for (const [columnName, column] of Object.entries(table.columns)) {
      const codecId = column.codecId;
      const key = `${tableName}.${columnName}`;
      codecIds.set(key, codecId);
    }
  }

  return codecIds;
}

export function validateContractCodecMappings(
  registry: CodecRegistry,
  contract: SqlContract<SqlStorage>,
): void {
  const codecIds = extractCodecIdsFromColumns(contract);
  const invalidCodecs: Array<{ table: string; column: string; codecId: string }> = [];

  for (const [key, codecId] of codecIds.entries()) {
    if (!registry.has(codecId)) {
      const parts = key.split('.');
      const table = parts[0] ?? '';
      const column = parts[1] ?? '';
      invalidCodecs.push({ table, column, codecId });
    }
  }

  if (invalidCodecs.length > 0) {
    const details: Record<string, unknown> = {
      contractTarget: contract.target,
      invalidCodecs,
    };

    throw runtimeError(
      'RUNTIME.CODEC_MISSING',
      `Missing codec implementations for column codecIds: ${invalidCodecs.map((c) => `${c.table}.${c.column} (${c.codecId})`).join(', ')}`,
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
