/**
 * Pure planning helpers for Postgres enum types: the diff/rebuild logic
 * that the verifier and planner use to walk `SqlEnumType` instances
 * natively. Op builders live in `./operations/enums.ts`.
 */

import { arraysEqual } from '@prisma-next/family-sql/schema-verify';
import type { SqlEnumType } from '@prisma-next/sql-contract/types';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import { PG_ENUM_CODEC_ID } from '../codec-ids';

/**
 * Categorisation of how an existing enum type's values relate to the
 * desired set in the contract.
 */
export type EnumDiff =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'add_values'; readonly values: readonly string[] }
  | { readonly kind: 'rebuild'; readonly removedValues: readonly string[] };

/**
 * Reads existing enum values for `nativeType` from the
 * Postgres-introspected `schema.annotations.pg.storageTypes` map.
 *
 * Schema IR's `storageTypes` slots are always codec-typed
 * (`{codecId: PG_ENUM_CODEC_ID, typeParams.values}`): the introspector
 * writes that shape, and the Contract→Schema IR projector resolves
 * `SqlEnumType` instances down to the same codec-typed triple before
 * they ever land in Schema IR. There is no second on-disk shape to
 * accept here.
 *
 * Returns `null` when no enum entry exists for the given native type.
 */
export function readExistingEnumValues(
  schema: SqlSchemaIR,
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
  const existing = storageTypes?.[nativeType];
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
 * `SqlEnumType` IR instance.
 */
export function getDesiredEnumValues(typeInstance: SqlEnumType): readonly string[] {
  return typeInstance.values;
}
