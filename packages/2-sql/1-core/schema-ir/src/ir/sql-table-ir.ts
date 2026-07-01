import { freezeNode } from '@prisma-next/framework-components/ir';
import { PrimaryKey, type PrimaryKeyInput } from './primary-key';
import {
  SqlCheckConstraintIR,
  type SqlCheckConstraintIRInput,
  sqlCheckConstraintIR,
} from './sql-check-constraint-ir';
import { type SqlAnnotations, SqlColumnIR, type SqlColumnIRInput } from './sql-column-ir';
import { SqlForeignKeyIR, type SqlForeignKeyIRInput } from './sql-foreign-key-ir';
import { SqlIndexIR, type SqlIndexIRInput } from './sql-index-ir';
import { SqlSchemaIRNode } from './sql-schema-ir-node';
import { SqlUniqueIR, type SqlUniqueIRInput } from './sql-unique-ir';

export interface SqlTableIRInput {
  readonly name: string;
  readonly columns: Record<string, SqlColumnIR | SqlColumnIRInput>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR | SqlForeignKeyIRInput>;
  readonly uniques: ReadonlyArray<SqlUniqueIR | SqlUniqueIRInput>;
  readonly indexes: ReadonlyArray<SqlIndexIR | SqlIndexIRInput>;
  readonly primaryKey?: PrimaryKey | PrimaryKeyInput;
  readonly annotations?: SqlAnnotations;
  /** Optional check constraints for enum-restricted columns. Omitted when none present. */
  readonly checks?: ReadonlyArray<SqlCheckConstraintIR | SqlCheckConstraintIRInput>;
}

/**
 * Schema IR node for a single table as observed by introspection.
 *
 * Unlike the Contract IR `StorageTable`, this carries the table's
 * `name` — introspection queries return tables as arrays and the
 * verifier keys them into `SqlSchemaIR.tables` afterwards, so the name
 * stays on the table object for downstream call sites that walk
 * `Object.values(schema.tables)`.
 *
 * The constructor normalises nested IR-class fields so downstream
 * walks see a uniform AST regardless of whether the input was a
 * plain-data literal (from introspection) or already-constructed
 * class instances.
 */
export class SqlTableIR extends SqlSchemaIRNode {
  readonly name: string;
  readonly columns: Readonly<Record<string, SqlColumnIR>>;
  readonly foreignKeys: ReadonlyArray<SqlForeignKeyIR>;
  readonly uniques: ReadonlyArray<SqlUniqueIR>;
  readonly indexes: ReadonlyArray<SqlIndexIR>;
  declare readonly primaryKey?: PrimaryKey;
  declare readonly annotations?: SqlAnnotations;
  declare readonly checks?: ReadonlyArray<SqlCheckConstraintIR>;

  constructor(input: SqlTableIRInput) {
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
        input.checks.map((c) => (c instanceof SqlCheckConstraintIR ? c : sqlCheckConstraintIR(c))),
      );
    }
    freezeNode(this);
  }
}
