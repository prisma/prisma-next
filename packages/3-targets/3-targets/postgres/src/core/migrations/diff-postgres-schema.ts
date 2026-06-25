import type { Contract } from '@prisma-next/contract/types';
import type { DiffableRoot, SchemaDiffIssue } from '@prisma-next/framework-components/control';
import {
  diffSchemas,
  filterSchemaIssuesByOwnership,
} from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { resolveNamespaceId } from '../postgres-schema';
import type { PostgresSchemaIR } from '../postgres-schema-ir';
import { collectContractRlsPolicies } from './collect-contract-postgres-nodes';

/**
 * Computes RLS policy drift between the contract and the live DB schema.
 * Ownership filtering is applied to the diff's outcomes, not its inputs.
 */
export function diffPostgresSchema(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;
  const expected: DiffableRoot = { children: () => collectContractRlsPolicies(contract) };
  const actual: DiffableRoot = { children: () => schema.rlsPolicies };
  const issues = diffSchemas(expected, actual);

  const owned = new Set(Object.keys(contract.storage.namespaces).map(resolveNamespaceId));
  return filterSchemaIssuesByOwnership(issues, (namespaceId) =>
    owned.has(resolveNamespaceId(namespaceId)),
  );
}
