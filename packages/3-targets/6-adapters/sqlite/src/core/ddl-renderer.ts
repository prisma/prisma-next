import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import type {
  SqliteCreateTable,
  SqliteDdlNode,
  SqliteDdlVisitor,
} from '@prisma-next/target-sqlite/ddl';
import type { SqliteLoweredStatement } from './types';

class SqliteDdlVisitorImpl implements SqliteDdlVisitor<string> {
  createTable(node: SqliteCreateTable): string {
    const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
    const tableRef = node.table;
    const columnDefs = node.columns.map((column) => renderColumn(column)).join(',\n    ');
    return `CREATE TABLE ${ifNotExists}${tableRef} (\n    ${columnDefs}\n  )`;
  }
}

function renderColumnDefault(defaultValue: ColumnDefault | undefined): string {
  if (defaultValue === undefined) {
    return '';
  }
  if (defaultValue.kind === 'literal') {
    const { value } = defaultValue;
    if (typeof value === 'string') {
      return `DEFAULT '${value}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `DEFAULT ${String(value)}`;
    }
    if (value === null) {
      return 'DEFAULT NULL';
    }
    return `DEFAULT '${JSON.stringify(value)}'`;
  }
  if (defaultValue.kind === 'function') {
    if (defaultValue.expression === 'autoincrement()') {
      return '';
    }
    return `DEFAULT (${defaultValue.expression})`;
  }
  return '';
}

function renderColumn(column: DdlColumn): string {
  if (column.type.includes('AUTOINCREMENT')) {
    return `${column.name} ${column.type}`;
  }
  const parts = [column.name, column.type];
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  }
  const defaultClause = renderColumnDefault(column.default);
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: SqliteDdlNode): SqliteLoweredStatement {
  const sql = ast.accept(new SqliteDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
