import type {
  AnyDdlNode,
  CreateTable,
  DdlColumn,
  DdlVisitor,
} from '@prisma-next/sql-relational-core/ast';
import { quoteIdentifier } from '@prisma-next/target-sqlite/sql-utils';
import type { SqliteLoweredStatement } from './types';

class SqliteDdlVisitor implements DdlVisitor<string> {
  createTable(node: CreateTable): string {
    const tableRef = quoteIdentifier(node.table);
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

export function renderLoweredDdl(ast: AnyDdlNode): SqliteLoweredStatement {
  const sql = ast.accept(new SqliteDdlVisitor());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
