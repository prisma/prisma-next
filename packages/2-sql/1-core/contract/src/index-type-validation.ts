import { ContractValidationError } from '@prisma-next/contract/contract-validation-error';
import type { Contract } from '@prisma-next/contract/types';
import { storageNamespaceEntries } from '@prisma-next/framework-components/ir';
import { type } from 'arktype';
import type { IndexTypeRegistry } from './index-types';
import type { SqlNamespace } from './ir/sql-storage';
import type { SqlStorage, StorageTable } from './types';

export function validateIndexTypes(
  contract: Contract<SqlStorage>,
  indexTypeRegistry: IndexTypeRegistry,
): void {
  for (const [namespaceId, ns] of [...storageNamespaceEntries(contract.storage)]) {
    for (const [tableName, rawTable] of Object.entries((ns as SqlNamespace).tables)) {
      const table = rawTable as StorageTable;
      for (const index of table.indexes) {
        if (index.type === undefined && index.options !== undefined) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index on columns [${index.columns.join(', ')}] has options without a type`,
            'storage',
          );
        }
        if (index.type === undefined) continue;
        const entry = indexTypeRegistry.get(index.type);
        if (entry === undefined) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index on columns [${index.columns.join(', ')}] uses unregistered index type "${index.type}"`,
            'storage',
          );
        }
        const optionsValue = index.options ?? {};
        const result = entry.options(optionsValue);
        if (result instanceof type.errors) {
          throw new ContractValidationError(
            `Namespace "${namespaceId}" table "${tableName}" index on columns [${index.columns.join(', ')}] has invalid options for type "${index.type}": ${result.summary}`,
            'storage',
          );
        }
      }
    }
  }
}
