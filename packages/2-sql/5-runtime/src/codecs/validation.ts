import type { Contract } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import { namespaceTables, type SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';

export function extractCodecIds(contract: Contract<SqlStorage>): Set<string> {
  const codecIds = new Set<string>();

  for (const ns of Object.values(contract.storage.namespaces)) {
    for (const table of Object.values(namespaceTables(ns))) {
      for (const column of Object.values(table.columns)) {
        const codecId = column.codecId;
        codecIds.add(codecId);
      }
    }
  }

  return codecIds;
}

function extractCodecIdsFromColumns(contract: Contract<SqlStorage>): Map<string, string> {
  const codecIds = new Map<string, string>();

  for (const ns of Object.values(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(namespaceTables(ns))) {
      for (const [columnName, column] of Object.entries(table.columns)) {
        const codecId = column.codecId;
        const key = `${tableName}.${columnName}`;
        codecIds.set(key, codecId);
      }
    }
  }

  return codecIds;
}

export function validateContractCodecMappings(
  registry: CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  const codecIds = extractCodecIdsFromColumns(contract);
  const invalidCodecs: Array<{ table: string; column: string; codecId: string }> = [];

  for (const [key, codecId] of codecIds.entries()) {
    if (registry.descriptorFor(codecId) === undefined) {
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
  registry: CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  validateContractCodecMappings(registry, contract);
}
