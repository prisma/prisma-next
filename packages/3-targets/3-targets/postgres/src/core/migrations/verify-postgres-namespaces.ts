import type { Contract } from '@prisma-next/contract/types';
import type { SchemaIssue } from '@prisma-next/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema } from '../postgres-schema';

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
  const namespace = getStorageNamespace(storage as Record<string, unknown>, namespaceId);
  if (isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}

/**
 * Reads the introspected list of schema names from the Postgres-flavoured
 * annotations slot on the schema IR. Defaults to the always-present
 * `public` schema when introspection did not populate the slot — a fresh
 * Postgres database always carries `public` (unless an operator dropped
 * it manually), so any verifier path that runs without an enriched
 * introspection still suppresses the redundant `CREATE SCHEMA "public"`.
 *
 * Production introspection (`PostgresControlAdapter.introspect`) is the
 * authoritative source: it queries `pg_namespace` and writes every
 * non-system schema into `annotations.pg.existingSchemas`. Tests that
 * want to assert against a richer initial state pass the slot
 * explicitly via the schema IR.
 */
function existingSchemasFromSchema(schema: SqlSchemaIR): readonly string[] {
  const annotations = (schema as { annotations?: { pg?: { existingSchemas?: unknown } } })
    .annotations;
  const slot = annotations?.pg?.existingSchemas;
  if (Array.isArray(slot)) {
    return slot.filter((s): s is string => typeof s === 'string');
  }
  return ['public'];
}

/**
 * Emits a `missing_schema` issue for every contract-declared Postgres
 * namespace whose live container does not yet exist.
 *
 * A namespace's live container is the schema returned by its
 * polymorphic `ddlSchemaName(storage)` method — named schemas resolve
 * to their own id, the unbound singleton projects to `public` (sibling
 * present) or the framework sentinel (sibling absent). Issues are
 * emitted only when the resolved name is a real, creatable schema
 * (not the unbound sentinel) and is missing from the introspected
 * list. `public` is suppressed implicitly because the introspection
 * (or its sensible default) always carries it.
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
  const namespaceIds = [...storageNamespaceEntries(contract.storage as Record<string, unknown>)]
    .map(([id]) => id)
    .sort();
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
