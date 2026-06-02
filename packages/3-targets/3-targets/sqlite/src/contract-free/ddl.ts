import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { SqliteCreateTable } from '../core/ddl/nodes';

/**
 * Build a SQLite `CREATE TABLE` query node.
 *
 * Precondition: identifiers (`table`, column names/types) and string-literal
 * defaults are emitted to SQL verbatim — they are not quoted or escaped.
 * Callers must pass pre-trusted values (e.g. fixed control-plane identifiers).
 * Quoting/escaping for untrusted identifiers is added when the migration
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
