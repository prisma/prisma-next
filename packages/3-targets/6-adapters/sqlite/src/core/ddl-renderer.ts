import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DdlColumn, DdlNode } from '@prisma-next/sql-relational-core/ast';
import type {
  SqliteCreateTable,
  SqliteDdlNode,
  SqliteDdlVisitor,
} from '@prisma-next/target-sqlite/ddl';
import { escapeLiteral, quoteIdentifier } from '@prisma-next/target-sqlite/sql-utils';
import type { SqliteLoweredStatement } from './types';

function isSqliteDdlNode(node: DdlNode): node is SqliteDdlNode {
  return node.kind === 'create-table';
}

class SqliteDdlVisitorImpl implements SqliteDdlVisitor<string> {
  createTable(node: SqliteCreateTable): string {
    const tableRef = quoteIdentifier(node.table);
    const columnDefs = node.columns.map((column) => renderColumn(column)).join(', ');
    return `CREATE TABLE ${tableRef} (${columnDefs})`;
  }
}

function renderColumnDefaultClause(defaultValue: ColumnDefault | undefined): string {
  if (defaultValue === undefined) {
    return '';
  }
  if (defaultValue.kind === 'literal') {
    const { value } = defaultValue;
    if (typeof value === 'string') {
      return ` DEFAULT '${escapeLiteral(value)}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return ` DEFAULT ${String(value)}`;
    }
    if (value === null) {
      return ' DEFAULT NULL';
    }
    return ` DEFAULT '${escapeLiteral(JSON.stringify(value))}'`;
  }
  if (defaultValue.kind === 'function') {
    if (defaultValue.expression === 'autoincrement()') {
      return '';
    }
    return ` DEFAULT (${defaultValue.expression})`;
  }
  return '';
}

function renderColumn(column: DdlColumn): string {
  const parts = [`${quoteIdentifier(column.name)} ${column.type}`];
  const defaultClause = renderColumnDefaultClause(column.default);
  if (defaultClause.length > 0) {
    parts.push(defaultClause.trim());
  }
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: DdlNode): SqliteLoweredStatement {
  if (!isSqliteDdlNode(ast)) {
    throw new Error(`Unsupported DDL node kind: ${ast.kind}`);
  }
  const sql = ast.accept(new SqliteDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
