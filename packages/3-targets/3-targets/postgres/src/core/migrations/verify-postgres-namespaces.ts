import type { Contract } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema } from '../postgres-schema';
import { isPostgresSchemaIR } from '../postgres-schema-ir';

/**
 * Resolves the live-database schema name for a given namespace
 * coordinate. Mirrors `resolveDdlSchemaForNamespace` in
 * `planner-strategies.ts` so the verifier's projection and the
 * planner's projection always agree — Postgres-aware namespaces (the
 * production path) dispatch to `ddlSchemaName(storage)`, and bare
 * object payloads (used by some tests) fall back to the coordinate
 * itself.
 */
function resolveDdlSchemaName(storage: SqlStorage, namespaceId: string): string {
  const namespace = storage.namespaces[namespaceId];
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}

/**
 * Reads the introspected list of schema names from a `PostgresSchemaIR`.
 * Defaults to the always-present `public` schema when the schema IR is not a
 * `PostgresSchemaIR` — a fresh Postgres database always carries `public`
 * (unless an operator dropped it manually), so any verifier path that runs
 * without an enriched introspection still suppresses the redundant
 * `CREATE SCHEMA "public"`.
 *
 * Production introspection (`PostgresControlAdapter.introspect`) is the
 * authoritative source: it queries `pg_namespace` and sets `existingSchemas`
 * on the returned `PostgresSchemaIR`. Tests that want to assert against a
 * richer initial state construct a `PostgresSchemaIR` explicitly.
 */
function existingSchemasFromSchema(schema: SqlSchemaIR): readonly string[] {
  if (isPostgresSchemaIR(schema)) {
    return schema.existingSchemas;
  }
  return ['public'];
}

/**
 * Emits a `missing_schema` issue for every contract-declared Postgres
 * namespace whose live container does not yet exist.
 *
 * A namespace's live container is the schema returned by its
 * polymorphic `ddlSchemaName(storage)` method — named schemas resolve
 * to their own id; the unbound singleton returns `UNBOUND_NAMESPACE_ID`
 * and is skipped explicitly (late-bound namespaces have no fixed DDL
 * schema). Issues are emitted only when the resolved name is a real,
 * creatable schema (not the unbound sentinel) and is missing from the
 * introspected list. `public` is suppressed implicitly because the
 * introspection (or its sensible default) always carries it.
 *
 * Each emitted issue stamps `namespaceId` with the contract namespace
 * coordinate so the downstream `mapIssueToCall` re-resolves the DDL
 * schema name through the same polymorphic path — keeping the
 * coordinate, not the resolved name, as the issue's stable identity.
 */
export function verifyPostgresNamespacePresence(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: SqlSchemaIR;
}): readonly SchemaIssue[] {
  const { contract, schema } = input;
  const existing = new Set(existingSchemasFromSchema(schema));
  const issues: SchemaIssue[] = [];
  const namespaceIds = Object.keys(contract.storage.namespaces).sort();
  for (const namespaceId of namespaceIds) {
    if (namespaceId === UNBOUND_NAMESPACE_ID) continue;
    const ddlName = resolveDdlSchemaName(contract.storage, namespaceId);
    if (ddlName === UNBOUND_NAMESPACE_ID) continue;
    if (existing.has(ddlName)) continue;
    issues.push({
      kind: 'missing_schema',
      namespaceId,
      message: `Schema "${ddlName}" is missing from database`,
    });
  }
  return issues;
}
