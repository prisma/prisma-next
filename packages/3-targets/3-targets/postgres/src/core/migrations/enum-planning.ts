/**
 * Pure planning helpers for Postgres enum types: the diff/rebuild logic
 * that the verifier and planner use to walk `PostgresEnumType` instances
 * natively. Op builders live in `./operations/enums.ts`.
 */

import { arraysEqual } from '@prisma-next/family-sql/schema-verify';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import type { PostgresEnumStorageEntry, SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';
import type { PostgresEnumType } from '../postgres-enum-type';
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
 * into a string. This is the same `(namespace, entityName)` coordinate the
 * contract side addresses entities by.
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
 * Resolves the live-schema name a namespace's enums are introspected under,
 * for keying `readExistingEnumValues` lookups. The unbound namespace's
 * `ddlSchemaName` is a planner-emit sentinel (`__unbound__`) that never names a
 * real schema, so for the unbound coordinate we read the *introspected* schema
 * recorded on `annotations.pg.schema` (the live `current_schema()` the adapter
 * walked) — that is the schema the enum's `storageTypes` entry is keyed under.
 * Named namespaces resolve to their own DDL schema, which matches the
 * per-schema introspection key directly.
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

/** Contract-scoped bridge for the family verifier's enum value resolver. */
export function createResolveExistingEnumValues(
  storage: SqlStorage,
): (
  schema: SqlSchemaIR,
  enumType: PostgresEnumStorageEntry,
  namespaceId: string,
) => readonly string[] | null {
  return (schema, enumType, namespaceId) =>
    readExistingEnumValues(
      schema,
      resolveDdlSchemaForNamespaceStorage(storage, namespaceId, schema),
      enumType.nativeType,
    );
}

/**
 * Categorisation of how an existing enum type's values relate to the
 * desired set in the contract.
 */
export type EnumDiff =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'add_values'; readonly values: readonly string[] }
  | { readonly kind: 'rebuild'; readonly removedValues: readonly string[] };

/**
 * Reads existing enum values for `(schemaName, nativeType)` from the
 * Postgres-introspected `schema.annotations.pg.enumTypes` map, addressed by
 * the `(schema, nativeType)` coordinate.
 *
 * Schema IR's enum entries are always codec-typed
 * (`{codecId: PG_ENUM_CODEC_ID, typeParams.values}`): the introspector
 * writes that shape, and the Contract→Schema IR projector resolves
 * `PostgresEnumType` instances down to the same codec-typed triple before
 * they ever land in Schema IR. There is no second on-disk shape to
 * accept here.
 *
 * Returns `null` when no enum entry exists for the given native type.
 */
export function readExistingEnumValues(
  schema: SqlSchemaIR,
  schemaName: string,
  nativeType: string,
): readonly string[] | null {
  const enumTypes = readPostgresSchemaIrAnnotations(schema).enumTypes;
  const existing = enumTypes?.[schemaName]?.[nativeType];
  if (!existing || existing.codecId !== PG_ENUM_CODEC_ID) {
    return null;
  }
  const enumValues = existing.typeParams?.values;
  if (!Array.isArray(enumValues) || !enumValues.every((v) => typeof v === 'string')) {
    return null;
  }
  return enumValues;
}

/**
 * Determines what changes are needed to transform existing enum values to
 * desired values.
 *
 * Postgres enums can only have values added (not removed or reordered)
 * without a full type rebuild involving temp type creation and column
 * migration; `'rebuild'` covers the value-removal and reorder cases.
 */
export function determineEnumDiff(
  existing: readonly string[],
  desired: readonly string[],
): EnumDiff {
  if (arraysEqual(existing, desired)) {
    return { kind: 'unchanged' };
  }
  const existingSet = new Set(existing);
  const desiredSet = new Set(desired);
  const missingValues = desired.filter((value) => !existingSet.has(value));
  const removedValues = existing.filter((value) => !desiredSet.has(value));
  const orderMismatch =
    missingValues.length === 0 && removedValues.length === 0 && !arraysEqual(existing, desired);
  if (removedValues.length > 0 || orderMismatch) {
    return { kind: 'rebuild', removedValues };
  }
  return { kind: 'add_values', values: missingValues };
}

/**
 * Convenience accessor — returns the enum's desired values from a
 * `PostgresEnumType` IR instance.
 */
export function getDesiredEnumValues(typeInstance: PostgresEnumType): readonly string[] {
  return typeInstance.values;
}
