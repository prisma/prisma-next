import type { DiffableNode } from '@prisma-next/framework-components/control';
import { freezeNode } from '@prisma-next/framework-components/ir';
import {
  PrimaryKey,
  type SqlAnnotations,
  SqlCheckConstraintIR,
  SqlColumnIR,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlSchemaIRNode,
  type SqlTableIRInput,
  SqlUniqueIR,
} from '@prisma-next/sql-schema-ir/types';
import type { PostgresPolicySchemaNode } from './postgres-policy-schema-node';

export interface PostgresTableSchemaNodeInput extends SqlTableIRInput {
  readonly policies?: readonly PostgresPolicySchemaNode[];
}

/**
 * Postgres-specific table schema-diff node. Carries all `SqlTableIR` fields
 * plus `policies`, and implements `DiffableNode` so the table instance is
 * directly the diff-tree node — no separate wrapper needed.
 *
 * Extends `SqlSchemaIRNode` directly rather than `SqlTableIR` because
 * `SqlTableIR` calls `freezeNode` in its own constructor, which prevents
 * subclass field initialisation.
 *
 * `id` is the table name. `children()` returns the policy nodes on this table.
 * `isEqualTo` is always true — table-level attributes are not diffed yet.
 */
export class PostgresTableSchemaNode extends SqlSchemaIRNode implements DiffableNode {
  readonly name: string;
  readonly columns: Readonly<Record<string, SqlColumnIR>>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR>;
  readonly uniques: ReadonlyArray<SqlUniqueIR>;
  readonly indexes: ReadonlyArray<SqlIndexIR>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly annotations?: SqlAnnotations;
  declare readonly checks?: ReadonlyArray<SqlCheckConstraintIR>;
  readonly policies: readonly PostgresPolicySchemaNode[];

  constructor(input: PostgresTableSchemaNodeInput) {
    super();
    this.name = input.name;
    this.columns = Object.freeze(
      Object.fromEntries(
        Object.entries(input.columns).map(([key, col]) => [
          key,
          col instanceof SqlColumnIR ? col : new SqlColumnIR(col),
        ]),
      ),
    );
    this.foreignKeys = Object.freeze(
      input.foreignKeys.map((fk) => (fk instanceof SqlForeignKeyIR ? fk : new SqlForeignKeyIR(fk))),
    );
    this.uniques = Object.freeze(
      input.uniques.map((u) => (u instanceof SqlUniqueIR ? u : new SqlUniqueIR(u))),
    );
    this.indexes = Object.freeze(
      input.indexes.map((i) => (i instanceof SqlIndexIR ? i : new SqlIndexIR(i))),
    );
    if (input.primaryKey !== undefined) {
      this.primaryKey =
        input.primaryKey instanceof PrimaryKey
          ? input.primaryKey
          : new PrimaryKey(input.primaryKey);
    }
    if (input.annotations !== undefined) this.annotations = input.annotations;
    if (input.checks !== undefined && input.checks.length > 0) {
      this.checks = Object.freeze(
        input.checks.map((c) =>
          c instanceof SqlCheckConstraintIR ? c : new SqlCheckConstraintIR(c),
        ),
      );
    }
    this.policies = Object.freeze([...(input.policies ?? [])]);
    freezeNode(this);
  }

  get id(): string {
    return this.name;
  }

  isEqualTo(_other: DiffableNode): boolean {
    return true;
  }

  children(): readonly DiffableNode[] {
    return this.policies;
  }

  static is(node: DiffableNode): node is PostgresTableSchemaNode {
    return node instanceof PostgresTableSchemaNode;
  }
}
