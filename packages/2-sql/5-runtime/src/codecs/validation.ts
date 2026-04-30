import type { Contract } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { CodecDescriptorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';

export function extractCodecIds(contract: Contract<SqlStorage>): Set<string> {
  const codecIds = new Set<string>();

  for (const table of Object.values(contract.storage.tables)) {
    for (const column of Object.values(table.columns)) {
      const codecId = column.codecId;
      codecIds.add(codecId);
    }
  }

  return codecIds;
}

function extractCodecIdsFromColumns(contract: Contract<SqlStorage>): Map<string, string> {
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

interface CodecLookupForValidation {
  has(id: string): boolean;
}

function adaptDescriptorRegistry(registry: CodecDescriptorRegistry): CodecLookupForValidation {
  return { has: (id: string) => registry.descriptorFor(id) !== undefined };
}

function isDescriptorRegistry(
  registry: CodecRegistry | CodecDescriptorRegistry,
): registry is CodecDescriptorRegistry {
  return 'descriptorFor' in registry;
}

export function validateContractCodecMappings(
  registry: CodecRegistry | CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  const lookup: CodecLookupForValidation = isDescriptorRegistry(registry)
    ? adaptDescriptorRegistry(registry)
    : registry;

  const codecIds = extractCodecIdsFromColumns(contract);
  const invalidCodecs: Array<{ table: string; column: string; codecId: string }> = [];

  for (const [key, codecId] of codecIds.entries()) {
    if (!lookup.has(codecId)) {
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
  registry: CodecRegistry | CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  validateContractCodecMappings(registry, contract);
}
