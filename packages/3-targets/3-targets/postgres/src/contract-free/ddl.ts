import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import { PostgresCreateSchema, PostgresCreateTable } from '../core/ddl/nodes';

export function createTable(options: {
  readonly table: string;
  readonly schema?: string;
  readonly ifNotExists?: boolean;
  readonly columns: readonly DdlColumn[];
}): PostgresCreateTable {
  return new PostgresCreateTable(options);
}

export function createSchema(options: {
  readonly schema: string;
  readonly ifNotExists?: boolean;
}): PostgresCreateSchema {
  return new PostgresCreateSchema(options);
}
