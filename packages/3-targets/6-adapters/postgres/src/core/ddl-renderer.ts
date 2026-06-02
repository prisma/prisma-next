import type { ColumnDefault } from '@prisma-next/contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import type {
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresDdlNode,
  PostgresDdlVisitor,
} from '@prisma-next/target-postgres/ddl';
import type { PostgresLoweredStatement } from './types';

class PostgresDdlVisitorImpl implements PostgresDdlVisitor<string> {
  createTable(node: PostgresCreateTable): string {
    const ifNotExists = node.ifNotExists ? 'if not exists ' : '';
    const tableRef = node.schema ? `${node.schema}.${node.table}` : node.table;
    const columnDefs = node.columns.map((column) => renderColumn(column)).join(',\n    ');
    return `create table ${ifNotExists}${tableRef} (\n    ${columnDefs}\n  )`;
  }

  createSchema(node: PostgresCreateSchema): string {
    const ifNotExists = node.ifNotExists ? 'if not exists ' : '';
    return `create schema ${ifNotExists}${node.schema}`;
  }
}

function renderColumnDefault(defaultValue: ColumnDefault | undefined): string {
  if (defaultValue === undefined) {
    return '';
  }
  if (defaultValue.kind === 'literal') {
    const { value } = defaultValue;
    if (typeof value === 'string') {
      return `default '${value}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `default ${String(value)}`;
    }
    if (value === null) {
      return 'default null';
    }
    return `default '${JSON.stringify(value)}'`;
  }
  if (defaultValue.kind === 'function') {
    if (defaultValue.expression === 'autoincrement()') {
      return '';
    }
    if (defaultValue.expression === 'now()') {
      return 'default now()';
    }
    return `default (${defaultValue.expression})`;
  }
  return '';
}

function renderColumn(column: DdlColumn): string {
  const parts = [column.name, column.type];
  if (column.notNull) {
    parts.push('not null');
  }
  if (column.primaryKey) {
    parts.push('primary key');
  }
  const defaultClause = renderColumnDefault(column.default);
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: PostgresDdlNode): PostgresLoweredStatement {
  const sql = ast.accept(new PostgresDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
