import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { SqliteCreateTable } from '../core/ddl/nodes';

export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
}): SqliteCreateTable {
  return new SqliteCreateTable(options);
}
