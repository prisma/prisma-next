import type { DocumentContract } from '../types';

// Shared types
export type { FieldType, Source, ContractBase } from '../types';

// SQL family types - re-exported from @prisma-next/sql-query/contract-types
export type {
  StorageColumn,
  StorageTable,
  SqlStorage,
  SqlContract,
} from '@prisma-next/sql-query/contract-types';

// Document family types
export type { DocCollection, DocIndex, Expr, DocumentStorage, DocumentContract } from '../types';

/**
 * Type guard to check if a contract is a SQL contract
 */
export function isSqlContract(
  contract: unknown,
): contract is import('@prisma-next/sql-query/contract-types').SqlContract<
  import('@prisma-next/sql-query/contract-types').SqlStorage
> {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'targetFamily' in contract &&
    contract.targetFamily === 'sql'
  );
}

/**
 * Type guard to check if a contract is a Document contract
 */
export function isDocumentContract(contract: unknown): contract is DocumentContract {
  return (
    typeof contract === 'object' &&
    contract !== null &&
    'targetFamily' in contract &&
    contract.targetFamily === 'document'
  );
}
