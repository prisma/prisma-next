import type {
  AnyDdlNode,
  CreateTable,
  DdlColumn,
  DdlVisitor,
} from '@prisma-next/sql-relational-core/ast';
import { quoteIdentifier } from '@prisma-next/target-postgres/sql-utils';
import type { PostgresLoweredStatement } from './types';

class PostgresDdlVisitor implements DdlVisitor<string> {
  createTable(node: CreateTable): string {
    const tableRef = node.schema
      ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
      : quoteIdentifier(node.table);
    const columnDefs = node.columns.map((column) => renderColumn(column)).join(', ');
    return `CREATE TABLE ${tableRef} (${columnDefs})`;
  }
}

function renderColumn(column: DdlColumn): string {
  const parts = [`${quoteIdentifier(column.name)} ${column.type}`];
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: AnyDdlNode): PostgresLoweredStatement {
  const sql = ast.accept(new PostgresDdlVisitor());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
