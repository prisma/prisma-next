import type { ControlPolicy } from '@prisma-next/contract/types';
import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlNode } from '@prisma-next/sql-contract/types';

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
  readonly control?: ControlPolicy;
}

/** Codec id used by Postgres enum-typed columns (text wire format). */
const PG_ENUM_CODEC_ID = 'pg/enum@1';

/**
 * Postgres IR class for the `CREATE TYPE … AS ENUM` concept.
 *
 * Per Decision 18, enum is a target-only concept (Postgres alone today;
 * SQLite emulates via CHECK constraints). There is no family-layer
 * enum abstract — the abstract-earns-existence rule keeps the IR class
 * hierarchy minimal: this class extends `SqlNode` directly and is the
 * single concrete representation of the polymorphic `'postgres-enum'`
 * slot variant.
 *
 * Carries Postgres-specific resolution (`nativeType` defaults to
 * `name`; `values` is frozen at construction time). Constructor calls
 * `freezeNode(this)` per Decision 8 — the instance is fully immutable,
 * JSON-clean, and dispatchable on its enumerable `kind: 'postgres-enum'`
 * literal.
 *
 * The family-layer slot dispatch (verifier, planner, lowering, etc.)
 * narrows polymorphic `StorageType` entries via the `kind` literal
 * (e.g. `isPostgresEnumStorageEntry`) — SQL-domain code must not import
 * `target-postgres` directly (cross-domain layering rule). The
 * structural interface lives at the family layer for that purpose;
 * this class is the runtime concrete that satisfies it.
 */
export class PostgresEnumType<
  TName extends string = string,
  TValues extends readonly string[] = readonly string[],
> extends SqlNode {
  override readonly kind = 'postgres-enum' as const;
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
  declare readonly control?: ControlPolicy;

  constructor(input: PostgresEnumTypeInput<TName, TValues>) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType ?? input.name;
    // `Object.freeze` returns `Readonly<string[]>`, widening past the
    // `TValues` literal tuple. Cast preserves the caller-supplied
    // tuple shape so inferred contract types retain literal narrowing.
    this.values = Object.freeze([...input.values] as unknown as TValues);
    if (input.control !== undefined) this.control = input.control;
    freezeNode(this);
  }

  get codecBinding(): {
    readonly codecId: typeof PG_ENUM_CODEC_ID;
    readonly typeParams: { readonly values: TValues };
  } {
    return { codecId: PG_ENUM_CODEC_ID, typeParams: { values: this.values } };
  }
}
