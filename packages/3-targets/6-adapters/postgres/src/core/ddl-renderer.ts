import type { ColumnDefault } from '@prisma-next/contract/types';
import type { StorageColumn } from '@prisma-next/sql-contract/types';
import type { DdlColumn } from '@prisma-next/sql-relational-core/ast';
import type {
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresDdlNode,
  PostgresDdlVisitor,
} from '@prisma-next/target-postgres/ddl';
import { buildColumnDefaultSql } from '@prisma-next/target-postgres/planner-ddl-builders';
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

function storageColumnFromDdlColumn(column: DdlColumn): StorageColumn {
  const nativeType = column.type.replace(/\s+primary key$/i, '').trim();
  return {
    codecId: 'pg/text@1',
    nativeType,
    nullable: !column.notNull,
  };
}

function renderColumnDefault(column: DdlColumn): string {
  if (column.default === undefined) {
    return '';
  }
  if (column.default.kind === 'function' && column.default.expression === 'now()') {
    return 'default now()';
  }
  if (column.default.kind === 'literal' && typeof column.default.value === 'string') {
    return `default '${column.default.value}'`;
  }
  const plannerSql = buildColumnDefaultSql(column.default, storageColumnFromDdlColumn(column));
  if (plannerSql.length > 0) {
    return plannerSql.toLowerCase();
  }
  return renderBootstrapDefault(column.default);
}

function renderBootstrapDefault(defaultValue: ColumnDefault): string {
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
  const defaultClause = renderColumnDefault(column);
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: PostgresDdlNode): PostgresLoweredStatement {
  const sql = ast.accept(new PostgresDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
