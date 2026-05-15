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
 * `kind: 'postgres-enum'` literal.
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
  /**
   * Enumerable own property so the persisted JSON envelope carries
   * `codecId: 'pg/enum@1'` alongside `kind: 'postgres-enum'`. The
   * runtime path (`codecRefForStorageColumn`, `assertColumnCodecIntegrity`)
   * receives JSON-shaped contracts (e.g. inside a user-written
   * `migration.ts` that loads `endContract` from `end-contract.json`)
   * and reads `codecId` directly from the envelope rather than
   * dispatching through the prototype-only `codecBinding` accessor.
   */
  readonly codecId: typeof PG_ENUM_CODEC_ID = PG_ENUM_CODEC_ID;

  constructor(input: PostgresEnumTypeInput<TName, TValues>) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType ?? input.name;
    // `Object.freeze` returns `Readonly<string[]>`, widening past the
    // `TValues` literal tuple. Cast preserves the caller-supplied
    // tuple shape so inferred contract types retain literal narrowing.
    this.values = Object.freeze([...input.values] as unknown as TValues);
    freezeNode(this);
  }

  get codecBinding(): {
    readonly codecId: typeof PG_ENUM_CODEC_ID;
    readonly typeParams: { readonly values: TValues };
  } {
    return { codecId: PG_ENUM_CODEC_ID, typeParams: { values: this.values } };
  }
}
