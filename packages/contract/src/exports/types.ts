import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { DocumentContract } from '../types';

// Shared types
// Document family types
export type {
  ContractBase,
  DocCollection,
  DocIndex,
  DocumentContract,
  DocumentStorage,
  Expr,
  FieldType,
  Source,
} from '../types';

/**
 * Type guard to check if a contract is a SQL contract
 */
export function isSqlContract(contract: unknown): contract is SqlContract<SqlStorage> {
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

// Plan types - target-family agnostic execution types
export type {
  ParamDescriptor,
  Plan,
  PlanMeta,
  PlanRefs,
  ResultType,
} from '../types';
