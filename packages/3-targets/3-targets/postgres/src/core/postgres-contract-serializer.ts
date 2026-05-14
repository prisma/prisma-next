import type { Contract } from '@prisma-next/contract/types';
import { SqlContractSerializerBase } from '@prisma-next/family-sql/ir';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { PostgresEnumType } from './postgres-enum-type';

/**
 * Postgres target `ContractSerializer` concretion. Inherits the full
 * SQL-family deserialization pipeline (structural validation +
 * hydration walker that materialises the SQL Contract IR class
 * hierarchy from the validated JSON envelope). Postgres-specific
 * concretion is limited to the `hydrateEnumType` hook — it
 * constructs `PostgresEnumType` instances from validated enum
 * entries (Decision 18, Option B); codec-typed entries continue to
 * fall through to `StorageTypeInstance` via the family base.
 *
 * `serializeContract` falls through to the family-base default —
 * Postgres' contract is JSON-clean today (`PostgresEnumType`
 * instances are frozen with enumerable own properties, so
 * `JSON.stringify` produces the canonical envelope shape). Once
 * target-only fields land (e.g. per-target derived storage fields)
 * this is the home for stripping them from the persisted envelope.
 */
export class PostgresContractSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
  protected override hydrateEnumType(entry: {
    readonly name: string;
    readonly nativeType: string;
    readonly values: readonly string[];
  }): PostgresEnumType {
    return new PostgresEnumType({
      name: entry.name,
      nativeType: entry.nativeType,
      values: entry.values,
    });
  }
}
