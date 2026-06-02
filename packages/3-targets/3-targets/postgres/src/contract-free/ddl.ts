import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { PostgresCreateSchema, PostgresCreateTable } from '../core/ddl/nodes';

/**
 * Build a Postgres `CREATE TABLE` query node.
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
