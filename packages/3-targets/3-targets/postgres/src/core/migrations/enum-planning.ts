import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { isPostgresSchema } from '../postgres-schema';

/**
 * Codec-typed enum entry shape stored under
 * `schema.annotations.pg.enumTypes[schemaName][nativeType]`.
 */
interface PgStorageTypeEntry {
  readonly codecId?: string;
  readonly typeParams?: { readonly values?: unknown };
}

/**
 * Live enum types keyed by `(schemaName, nativeType)` as a nested map, so two
 * schemas sharing a native enum name stay distinct without packing the pair
 * into a string.
 */
type PgEnumTypesMap = Readonly<Record<string, Readonly<Record<string, PgStorageTypeEntry>>>>;

/** Postgres-specific subtree on family `SqlSchemaIR.annotations`. */
export interface PostgresSchemaIrAnnotations {
  readonly schema?: string;
  readonly enumTypes?: PgEnumTypesMap;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readPgStorageTypeEntry(value: unknown): PgStorageTypeEntry | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const codecId = Reflect.get(value, 'codecId');
  const typeParamsRaw = Reflect.get(value, 'typeParams');
  const typeParams =
    typeParamsRaw !== undefined &&
    typeParamsRaw !== null &&
    typeof typeParamsRaw === 'object' &&
    !Array.isArray(typeParamsRaw)
      ? { values: Reflect.get(typeParamsRaw, 'values') }
      : undefined;
  return {
    ...(typeof codecId === 'string' ? { codecId } : {}),
    ...(typeParams !== undefined ? { typeParams } : {}),
  };
}

function readPgEnumTypesMap(value: unknown): PgEnumTypesMap | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const bySchema: Record<string, Record<string, PgStorageTypeEntry>> = {};
  for (const [schemaName, byTypeRaw] of Object.entries(value)) {
    if (byTypeRaw === null || typeof byTypeRaw !== 'object' || Array.isArray(byTypeRaw)) {
      continue;
    }
    const byType: Record<string, PgStorageTypeEntry> = {};
    for (const [nativeType, entryValue] of Object.entries(byTypeRaw)) {
      const entry = readPgStorageTypeEntry(entryValue);
      if (entry !== undefined) {
        byType[nativeType] = entry;
      }
    }
    if (Object.keys(byType).length > 0) {
      bySchema[schemaName] = byType;
    }
  }
  return Object.keys(bySchema).length > 0 ? bySchema : undefined;
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
  const enumTypes = readPgEnumTypesMap(Reflect.get(raw, 'enumTypes'));
  return {
    ...(schemaField !== undefined ? { schema: schemaField } : {}),
    ...(enumTypes !== undefined ? { enumTypes } : {}),
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
