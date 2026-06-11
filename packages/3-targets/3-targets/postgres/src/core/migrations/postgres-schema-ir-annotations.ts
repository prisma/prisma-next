import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema } from '../postgres-schema';

/** Postgres-specific subtree on family `SqlSchemaIR.annotations`. */
export interface PostgresSchemaIrAnnotations {
  readonly schema?: string;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads the Postgres annotation envelope (`schema.annotations.pg`) from
 * family Schema IR. `SqlAnnotations` is an open target-pack extensibility
 * map (`Record<string, unknown>`); this accessor narrows the `pg` slot at
 * runtime so Postgres code can read introspection fields without casts.
 */
export function readPostgresSchemaIrAnnotations(schema: SqlSchemaIR): PostgresSchemaIrAnnotations {
  const raw = schema.annotations?.['pg'];
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const schemaField = readOptionalString(Reflect.get(raw, 'schema'));
  return {
    ...(schemaField !== undefined ? { schema: schemaField } : {}),
  };
}

/**
 * Resolves the live-schema name a namespace's storage is introspected under.
 * The unbound namespace uses the introspected schema recorded on
 * `annotations.pg.schema` (the live `current_schema()` the adapter walked).
 * Named namespaces resolve to their own DDL schema name.
 */
export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
  schemaIr?: SqlSchemaIR,
): string {
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    return (schemaIr ? readPostgresSchemaIrAnnotations(schemaIr).schema : undefined) ?? 'public';
  }
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  return namespaceId;
}
