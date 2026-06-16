import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  AddColumnAction,
  type AnyAlterTableAction,
  DropDefaultAction,
  PostgresAlterTable,
  PostgresCreateSchema,
  PostgresCreateTable,
} from '../core/ddl/nodes';

/**
 * Build a Postgres `CREATE TABLE` query node.
 *
 * Pass `constraints` for table-level composite primary keys, foreign keys, and
 * unique constraints — use the {@link PrimaryKeyConstraint}, {@link ForeignKeyConstraint},
 * and {@link UniqueConstraint} classes from `@prisma-next/sql-relational-core/ast`.
 *
 * Precondition: identifiers (`table`, `schema`, column names/types) are
 * emitted to SQL verbatim — they are not quoted or escaped, so callers must
 * pass pre-trusted values (e.g. fixed control-plane identifiers). String-literal
 * default values, by contrast, are single-quote-escaped (embedded `'` doubled)
 * by the renderer. Identifier quoting for untrusted identifiers is added when
 * the migration planner adopts this lowering path.
 */
export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
  readonly constraints?: readonly DdlTableConstraint[];
}): PostgresCreateTable {
  return new PostgresCreateTable(options);
}

/**
 * Build a Postgres `CREATE SCHEMA` query node. See {@link createTable} for the
 * pre-trusted-identifier precondition.
 */
export function createSchema(options: {
  readonly schema: string;
  readonly ifNotExists?: boolean;
}): PostgresCreateSchema {
  return new PostgresCreateSchema(options);
}

/**
 * Build an `ADD COLUMN` action for use inside {@link alterTable}.
 * The column is a structured `DdlColumn` so codec-encoded defaults flow
 * through the adapter's `pgRenderDdlColumn` → `pgRenderDdlColumnDefault` path.
 */
export function addColumnAction(column: DdlColumn): AddColumnAction {
  return new AddColumnAction(column);
}

/**
 * Build a `DROP DEFAULT` action (`ALTER COLUMN "<name>" DROP DEFAULT`) for
 * use inside {@link alterTable}. The renderer quotes the column name.
 */
export function dropDefaultAction(columnName: string): DropDefaultAction {
  return new DropDefaultAction(columnName);
}

/**
 * Build a Postgres `ALTER TABLE` query node carrying one or more actions.
 * See {@link addColumnAction} / {@link dropDefaultAction} for building actions.
 */
export function alterTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly actions: readonly AnyAlterTableAction[];
}): PostgresAlterTable {
  return new PostgresAlterTable(options);
}
