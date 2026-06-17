import type { Contract } from '@prisma-next/contract/types';
import type { SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffNodes } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { isPostgresSchema } from '../postgres-schema';
import type { PostgresSchemaIR } from '../postgres-schema-ir';

/**
 * Computes RLS policy drift between the contract and the live DB schema using
 * the generic {@link diffNodes} differ. Returns `SchemaDiffIssue[]` keyed by
 * the full `EntityCoordinate` (plane + namespaceId + entityKind + entityName).
 *
 * Both sides supply `PostgresRlsPolicy` nodes that implement `DiffableNode`
 * with a concrete namespace coordinate — the contract carries explicit
 * `namespaceId` set during lowering (e.g. `'public'`); the introspected schema
 * carries the resolved DDL schema name. The differ matches purely on coordinate
 * identity; no namespace interpretation happens here.
 */
export function diffPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;

  const expected = Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.policy) : [],
  );

  return diffNodes(expected, schema.rlsPolicies);
}
