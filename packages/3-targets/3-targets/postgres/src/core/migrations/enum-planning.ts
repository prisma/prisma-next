/**
 * Pure planning helpers for Postgres enum types.
 *
 * Lifted verbatim from the legacy `pgEnumControlHooks.planTypeOperations`
 * codec-hook glue so the verifier and planner can walk `SqlEnumType`
 * instances natively (no codec-hook dispatch). The Op builders themselves
 * live in `./operations/enums.ts`; this module hosts the diff/rebuild
 * helpers that consume them.
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
 * Bridging adapter — reads existing enum values for `nativeType` from the
 * Postgres-introspected `schema.annotations.pg.storageTypes` map. The
 * introspector populates this map with `Record<string, StorageTypeInstance>`
 * shaped entries (`codecId: PG_ENUM_CODEC_ID`, `typeParams.values`).
 *
 * Returns `null` when no enum entry exists for the given native type.
 *
 * Schema IR retains the codec-typed annotation shape per Decision 18; this
 * function is the small (~20 LOC) translation between that shape and the
 * native `SqlEnumType` walk.
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
          kind?: string;
          values?: unknown;
          typeParams?: { values?: unknown };
        }
      >
    | undefined;
  const existing = storageTypes?.[nativeType];
  if (!existing) {
    return null;
  }
  // Two annotation shapes are accepted: live-introspection codec-typed
  // entries (`{codecId: PG_ENUM_CODEC_ID, typeParams.values}`) and
  // synthesised-from-contract `SqlEnumType` entries (`{kind:
  // 'sql-enum-type', values}`). Both flow through the same Postgres
  // `storage.types` annotation slot today.
  const enumValues =
    existing.kind === 'sql-enum-type' ? existing.values : existing.typeParams?.values;
  if (existing.kind !== 'sql-enum-type' && existing.codecId !== PG_ENUM_CODEC_ID) {
    return null;
  }
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
