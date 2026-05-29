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
 * Separator for `(schemaName, nativeType)` keys in introspected
 * `schema.annotations.pg.storageTypes`. NUL cannot appear in Postgres
 * identifiers, so the pair is unambiguous.
 */
export const ENUM_STORAGE_KEY_SEP = '\u0000';

/** Builds the schema-qualified storageTypes map key for a live Postgres enum. */
export function enumStorageCompoundKey(schemaName: string, nativeType: string): string {
  return `${schemaName}${ENUM_STORAGE_KEY_SEP}${nativeType}`;
}

/**
 * Resolves the DDL schema name for a namespace coordinate without a full
 * strategy context — used when bridging verifier/planner enum lookups.
 */
export function resolveDdlSchemaForNamespaceStorage(
  storage: SqlStorage,
  namespaceId: string,
  schemaIr?: SqlSchemaIR,
): string {
  const namespace = storage.namespaces[namespaceId];
  if (namespace && isPostgresSchema(namespace)) {
    return namespace.ddlSchemaName(storage);
  }
  if (namespaceId === UNBOUND_NAMESPACE_ID) {
    const pg = schemaIr?.annotations?.['pg'] as { schema?: string } | undefined;
    return pg?.schema ?? 'public';
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
 * Postgres-introspected `schema.annotations.pg.storageTypes` map.
 *
 * Schema IR's `storageTypes` slots are always codec-typed
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
  const storageTypes = (schema.annotations?.['pg'] as Record<string, unknown> | undefined)?.[
    'storageTypes'
  ] as
    | Record<
        string,
        {
          codecId?: string;
          typeParams?: { values?: unknown };
        }
      >
    | undefined;
  const existing = storageTypes?.[enumStorageCompoundKey(schemaName, nativeType)];
  if (!existing || existing.codecId !== PG_ENUM_CODEC_ID) {
    return null;
  }
  const enumValues = existing.typeParams?.values;
  if (!Array.isArray(enumValues) || !enumValues.every((v) => typeof v === 'string')) {
    return null;
  }
  return enumValues as readonly string[];
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
