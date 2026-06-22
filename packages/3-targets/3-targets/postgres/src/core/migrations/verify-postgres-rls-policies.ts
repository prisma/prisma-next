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
 *
 * The diff is scoped to the namespaces the verified contract owns. The live
 * schema introspection returns every policy across all DB schemas, but a policy
 * in a namespace this contract does not declare belongs to another contract
 * space (or is external) and must not be reported as extra. Without this scope a
 * space that owns only `auth`/`storage` (e.g. the supabase extension space)
 * would flag the application space's `public.*` policies as extra during verify.
 */
export function diffPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;

  const ownedNamespaceIds = new Set(Object.keys(contract.storage.namespaces));

  const expected = Object.values(contract.storage.namespaces).flatMap((ns) =>
    isPostgresSchema(ns) ? Object.values(ns.policy) : [],
  );

  const actual = schema.rlsPolicies.filter((policy) => ownedNamespaceIds.has(policy.namespaceId));

  return diffNodes(expected, actual);
}
