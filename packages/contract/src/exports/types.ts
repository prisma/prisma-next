// Shared types
export type { FieldType, Source } from '../types';

// SQL family types
export type { StorageColumn, StorageTable, SqlStorage, SqlContract } from '../types';

// Document family types
export type { DocCollection, DocIndex, Expr, DocumentStorage, DocumentContract } from '../types';

// Union type
export type { DataContract } from '../types';

// Backward compatibility: deprecated types
/**
 * @deprecated Use `SqlContract` or `DocumentContract` instead. This type is kept for backward compatibility.
 */
export type { ContractStorage } from '../types';

// Type guards
import type { DataContract, SqlContract, DocumentContract } from '../types';

/**
 * Type guard to check if a contract is a SQL contract
 */
export function isSqlContract(contract: DataContract): contract is SqlContract {
  return contract.targetFamily === 'sql';
}

/**
 * Type guard to check if a contract is a Document contract
 */
export function isDocumentContract(contract: DataContract): contract is DocumentContract {
  return contract.targetFamily === 'document';
}
