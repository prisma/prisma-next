import {
  type Contract,
  defaultDomainNamespaceIdForSqlTarget,
  type ResolvedDomainModel,
  resolveDomainModel,
} from '@prisma-next/contract/types';
import { defaultStorageNamespaceIdForSqlTarget } from '@prisma-next/sql-contract/default-namespace';
import {
  type ResolvedStorageTable,
  resolveStorageTable,
} from '@prisma-next/sql-contract/resolve-storage-table';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import { TableSource } from '@prisma-next/sql-relational-core/ast';

export type { ResolvedDomainModel, ResolvedStorageTable };

export function resolveTableForContract(
  contract: Contract<SqlStorage>,
  tableName: string,
): ResolvedStorageTable | undefined {
  return resolveStorageTable(contract.storage, tableName, {
    defaultNamespaceId: defaultStorageNamespaceIdForSqlTarget(contract.target),
  });
}

export function requireStorageTableForContract(
  contract: Contract<SqlStorage>,
  tableName: string,
): ResolvedStorageTable {
  const resolved = resolveTableForContract(contract, tableName);
  if (resolved === undefined) {
    throw new Error(`Unknown table "${tableName}"`);
  }
  return resolved;
}

export function storageTableForContract(
  contract: Contract<SqlStorage>,
  tableName: string,
): StorageTable {
  return requireStorageTableForContract(contract, tableName).table;
}

export function resolveDomainModelForContract(
  contract: Contract<SqlStorage>,
  modelName: string,
): ResolvedDomainModel | undefined {
  return resolveDomainModel(contract.domain, modelName, {
    defaultNamespaceId: defaultDomainNamespaceIdForSqlTarget(contract.target),
  });
}

export function domainModelNames(contract: Contract<SqlStorage>): string[] {
  const names = new Set<string>();
  for (const namespace of Object.values(contract.domain.namespaces)) {
    for (const modelName of Object.keys(namespace.models)) {
      names.add(modelName);
    }
  }
  return [...names];
}

export function tableSourceForContract(
  contract: Contract<SqlStorage>,
  tableName: string,
  alias?: string,
): TableSource {
  const { namespaceId } = requireStorageTableForContract(contract, tableName);
  const effectiveAlias = alias !== undefined && alias !== tableName ? alias : undefined;
  return TableSource.named(tableName, effectiveAlias, namespaceId);
}
