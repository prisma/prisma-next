import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlEnumType } from '@prisma-next/sql-contract/types';

export interface PostgresEnumTypeInput<
  TName extends string = string,
  TValues extends readonly string[] = readonly string[],
> {
  /**
   * Contract-level enum name (e.g. `'Role'`). Used as the key in
   * `SqlStorage.types` and as the contract-facing identifier in
   * planner / verifier diagnostics.
   */
  readonly name: TName;
  /**
   * Postgres-side native type name created by `CREATE TYPE … AS ENUM`.
   * Defaults to `name` when not overridden via PSL `@map(...)` or the
   * TS authoring surface.
   */
  readonly nativeType?: string;
  readonly values: TValues;
}

/**
 * Postgres concretion of `SqlEnumType`. First per-target SQL IR class
 * — establishes the abstract+target split for SQL IR alongside the
 * earned polymorphic-dispatch consumers (verifier walks enum types
 * separately from codec-typed entries; planner emits `CREATE TYPE` /
 * `ALTER TYPE` operations directly from the IR).
 *
 * Carries Postgres-specific resolution (`nativeType` defaults to
 * `name`; `values` is frozen at construction time). Constructor calls
 * `freezeNode(this)` per Decision 8 — the instance is fully
 * immutable, JSON-clean, and dispatchable on its enumerable
 * `kind: 'sql-enum-type'` literal.
 */
/** Codec id used by Postgres enum-typed columns (text wire format). */
const PG_ENUM_CODEC_ID = 'pg/enum@1';

export class PostgresEnumType<
  TName extends string = string,
  TValues extends readonly string[] = readonly string[],
> extends SqlEnumType {
  readonly name: TName;
  readonly nativeType: string;
  readonly values: TValues;

  constructor(input: PostgresEnumTypeInput<TName, TValues>) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType ?? input.name;
    this.values = Object.freeze([...input.values] as unknown as TValues);
    freezeNode(this);
  }

  get codecBinding(): {
    readonly codecId: typeof PG_ENUM_CODEC_ID;
    readonly typeParams: { readonly values: TValues };
  } {
    return { codecId: PG_ENUM_CODEC_ID, typeParams: { values: this.values } };
  }

  /**
   * `StorageTypeInstance`-compatibility shims (Decision 18 Option B
   * scaffolding). These are prototype-level accessors so they stay
   * out of the JSON envelope (`JSON.stringify` only sees enumerable
   * own properties — `kind`, `name`, `nativeType`, `values`); they
   * exist so the existing `Record<string, StorageTypeInstance>`
   * surfaces in the contract-builder, lowering, and authoring
   * helpers continue to type-check during R1a without rippling the
   * polymorphic union through the entire authoring type graph.
   * R1b removes these once the verifier / planner walk
   * `SqlEnumType` natively and the consuming surfaces switch to the
   * polymorphic union explicitly.
   */
  get codecId(): typeof PG_ENUM_CODEC_ID {
    return PG_ENUM_CODEC_ID;
  }

  get typeParams(): { readonly values: TValues } {
    return { values: this.values };
  }
}
