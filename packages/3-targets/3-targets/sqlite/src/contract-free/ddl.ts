import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { SqliteCreateTable } from '../core/ddl/nodes';

/**
 * Build a SQLite `CREATE TABLE` query node.
 *
 * Precondition: identifiers (`table`, column names/types) are emitted to SQL
 * verbatim — they are not quoted or escaped, so callers must pass pre-trusted
 * values (e.g. fixed control-plane identifiers). String-literal default values,
 * by contrast, are single-quote-escaped (embedded `'` doubled) by the renderer.
 * Identifier quoting for untrusted identifiers is added when the migration
 * planner adopts this lowering path.
 */
export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
}): SqliteCreateTable {
  return new SqliteCreateTable(options);
}
