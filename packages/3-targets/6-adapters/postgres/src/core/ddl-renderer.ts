import type { DdlColumn, DdlNode } from '@prisma-next/sql-relational-core/ast';
import type {
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresDdlNode,
  PostgresDdlVisitor,
} from '@prisma-next/target-postgres/ddl';
import { buildColumnDefaultSql } from '@prisma-next/target-postgres/planner-ddl-builders';
import { quoteIdentifier } from '@prisma-next/target-postgres/sql-utils';
import type { PostgresLoweredStatement } from './types';

function isPostgresDdlNode(node: DdlNode): node is PostgresDdlNode {
  return node.kind === 'create-table' || node.kind === 'create-schema';
}

class PostgresDdlVisitorImpl implements PostgresDdlVisitor<string> {
  createTable(node: PostgresCreateTable): string {
    const tableRef = node.schema
      ? `${quoteIdentifier(node.schema)}.${quoteIdentifier(node.table)}`
      : quoteIdentifier(node.table);
    const columnDefs = node.columns.map((column) => renderColumn(column)).join(', ');
    return `CREATE TABLE ${tableRef} (${columnDefs})`;
  }

  createSchema(node: PostgresCreateSchema): string {
    const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
    return `CREATE SCHEMA ${ifNotExists}${quoteIdentifier(node.schema)}`;
  }
}

function renderColumn(column: DdlColumn): string {
  const parts = [`${quoteIdentifier(column.name)} ${column.type}`];
  const defaultClause = buildColumnDefaultSql(column.default);
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: DdlNode): PostgresLoweredStatement {
  if (!isPostgresDdlNode(ast)) {
    throw new Error(`Unsupported DDL node kind: ${ast.kind}`);
  }
  const sql = ast.accept(new PostgresDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
