import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import type { ReferentialAction } from '@prisma-next/sql-contract/types';
import { quoteIdentifier } from '../../sql-utils';
import type { SqlitePlanTargetDetails } from '../planner-target-details';

export type Op = SqlMigrationPlanOperation<SqlitePlanTargetDetails>;

export function step(description: string, sql: string): { description: string; sql: string } {
  return { description, sql };
}

export function esc(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Flat, fully-resolved column shape consumed by `createTable`, `addColumn`,
 * and `recreateTable`. Codec / `typeRef` / default expansion happens at the
 * call-construction site (in the issue-planner / strategies) so the
 * operation factories deal only in pre-rendered SQL fragments — mirrors the
 * Postgres `ColumnSpec` pattern.
 *
 * - `typeSql` is the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`).
 * - `defaultSql` is the full `DEFAULT …` clause (or empty when there is no
 *   default and when the column is rendered as `INTEGER PRIMARY KEY
 *   AUTOINCREMENT`, since SQLite forbids a default on an autoincrement PK).
 * - `inlineAutoincrementPrimaryKey` directs the renderer to emit
 *   `INTEGER PRIMARY KEY AUTOINCREMENT` inline and to skip the table-level
 *   primary-key constraint for this column. SQLite-specific: the column
 *   becomes an alias for `rowid` only when this exact form is used.
 */
export interface SqliteColumnSpec {
  readonly name: string;
  readonly typeSql: string;
  readonly defaultSql: string;
  readonly nullable: boolean;
  readonly inlineAutoincrementPrimaryKey?: boolean;
}

export interface SqlitePrimaryKeySpec {
  readonly columns: readonly string[];
}

export interface SqliteUniqueSpec {
  readonly columns: readonly string[];
  readonly name?: string;
}

export interface SqliteForeignKeySpec {
  readonly columns: readonly string[];
  readonly references: {
    readonly table: string;
    readonly columns: readonly string[];
  };
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly constraint: boolean;
}

/**
 * Flat shape of a contract table for DDL emission. Used by both
 * `createTable` (additive) and `recreateTable` (widening/destructive).
 */
export interface SqliteTableSpec {
  readonly columns: readonly SqliteColumnSpec[];
  readonly primaryKey?: SqlitePrimaryKeySpec;
  readonly uniques?: readonly SqliteUniqueSpec[];
  readonly foreignKeys?: readonly SqliteForeignKeySpec[];
}

/**
 * Index recreation spec for `recreateTable`. Both declared indexes and
 * FK-backing indexes flatten to the same shape; the planner dedupes by
 * column-set before constructing the call.
 */
export interface SqliteIndexSpec {
  readonly name: string;
  readonly columns: readonly string[];
}

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};

/**
 * Renders a single column's inline DDL fragment within a `CREATE TABLE`
 * statement. Honours the `inlineAutoincrementPrimaryKey` flag — SQLite
 * treats `INTEGER PRIMARY KEY AUTOINCREMENT` as a special form that aliases
 * `rowid`, and the column must not carry a `DEFAULT` or repeat `NOT NULL`.
 */
export function renderColumnDefinition(column: SqliteColumnSpec): string {
  const parts: string[] = [quoteIdentifier(column.name), column.typeSql];
  if (column.inlineAutoincrementPrimaryKey) {
    parts.push('PRIMARY KEY AUTOINCREMENT');
  } else {
    if (column.defaultSql) parts.push(column.defaultSql);
    if (!column.nullable) parts.push('NOT NULL');
  }
  return parts.join(' ');
}

/**
 * Renders an inline FOREIGN KEY constraint clause for a `CREATE TABLE`
 * body. Returns the empty string when `constraint` is false (the FK is
 * tracked at the contract level for index-creation purposes only and must
 * not produce DDL).
 */
export function renderForeignKeyClause(fk: SqliteForeignKeySpec): string {
  if (!fk.constraint) return '';
  const name = fk.name ? `CONSTRAINT ${quoteIdentifier(fk.name)} ` : '';
  let sql = `${name}FOREIGN KEY (${fk.columns.map(quoteIdentifier).join(', ')}) REFERENCES ${quoteIdentifier(fk.references.table)} (${fk.references.columns.map(quoteIdentifier).join(', ')})`;
  if (fk.onDelete !== undefined) {
    sql += ` ON DELETE ${REFERENTIAL_ACTION_SQL[fk.onDelete]}`;
  }
  if (fk.onUpdate !== undefined) {
    sql += ` ON UPDATE ${REFERENTIAL_ACTION_SQL[fk.onUpdate]}`;
  }
  return sql;
}
