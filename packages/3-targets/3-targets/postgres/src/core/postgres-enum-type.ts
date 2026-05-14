import { freezeNode } from '@prisma-next/framework-components/ir';
import { SqlEnumType } from '@prisma-next/sql-contract/types';

export interface PostgresEnumTypeInput {
  /**
   * Contract-level enum name (e.g. `'Role'`). Used as the key in
   * `SqlStorage.types` and as the contract-facing identifier in
   * planner / verifier diagnostics.
   */
  readonly name: string;
  /**
   * Postgres-side native type name created by `CREATE TYPE … AS ENUM`.
   * Defaults to `name` when not overridden via PSL `@map(...)` or the
   * TS authoring surface.
   */
  readonly nativeType?: string;
  readonly values: readonly string[];
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
export class PostgresEnumType extends SqlEnumType {
  readonly name: string;
  readonly nativeType: string;
  readonly values: readonly string[];

  constructor(input: PostgresEnumTypeInput) {
    super();
    this.name = input.name;
    this.nativeType = input.nativeType ?? input.name;
    this.values = Object.freeze([...input.values]);
    freezeNode(this);
  }
}
