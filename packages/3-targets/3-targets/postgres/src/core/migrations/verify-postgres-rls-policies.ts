import type { Contract } from '@prisma-next/contract/types';
import type { DiffableRoot, SchemaDiffIssue } from '@prisma-next/framework-components/control';
import { diffSchema } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { PostgresSchemaIR } from '../postgres-schema-ir';
import { collectContractRlsPolicies } from './project-postgres-schema-from-contract';

// Postgres binds the late-bound (`__unbound__`) namespace to the `public`
// schema, so an unbound contract owns `public` in the live database. Both the
// contract slot ids and the introspected policy coordinates can carry either
// form depending on how the schema was lowered, so normalize both sides to the
// same id before comparing ownership.
const POSTGRES_DEFAULT_NAMESPACE_ID = 'public';

function resolveNamespaceId(namespaceId: string): string {
  return namespaceId === UNBOUND_NAMESPACE_ID ? POSTGRES_DEFAULT_NAMESPACE_ID : namespaceId;
}

/**
 * Computes RLS policy drift between the contract and the live DB schema using
 * the generic {@link diffSchema} differ. Returns `SchemaDiffIssue[]` keyed by
 * the full `EntityCoordinate` (plane + namespaceId + entityKind + entityName).
 *
 * The differ walks two roots and never sees the contract: the expected root
 * yields the contract's `PostgresRlsPolicy` nodes, the actual root yields the
 * introspected schema's policies. Both sides supply nodes with a concrete
 * namespace coordinate — the contract carries the explicit `namespaceId` set
 * during lowering (e.g. `'public'`); the introspected schema carries the
 * resolved DDL schema name. The differ matches purely on coordinate identity.
 *
 * The owned-namespace decision is applied to the diff's outcomes, not its
 * inputs: an `extra` policy in a namespace this contract does not own belongs
 * to another contract space and is left alone. The live introspection returns
 * every policy across all DB schemas, so without this an `auth`/`storage`-only
 * space (e.g. supabase) would flag the application space's `public.*` policies
 * as extra during verify. This is behavior-identical to a pre-diff filter: an
 * unowned actual policy can never share a coordinate with an owned expected
 * policy, so it only ever surfaces as `extra`.
 *
 * Ownership is the set of namespaces the contract declares (its
 * `storage.namespaces` slot keys), with the late-bound `__unbound__` slot
 * resolved to the Postgres default `public`.
 */
export function diffPostgresRlsPolicies(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresSchemaIR;
}): readonly SchemaDiffIssue[] {
  const { contract, schema } = input;
  const expected: DiffableRoot = { children: () => collectContractRlsPolicies(contract) };
  const actual: DiffableRoot = { children: () => schema.rlsPolicies };
  const issues = diffSchema(expected, actual);

  const owned = new Set(Object.keys(contract.storage.namespaces).map(resolveNamespaceId));
  return issues.filter(
    (issue) =>
      issue.outcome !== 'extra' || owned.has(resolveNamespaceId(issue.coordinate.namespaceId)),
  );
}
