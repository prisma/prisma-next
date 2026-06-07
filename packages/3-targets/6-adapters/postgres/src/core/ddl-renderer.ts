import { REFERENTIAL_ACTION_SQL } from '@prisma-next/sql-contract/referential-action-sql';
import type {
  DdlColumn,
  DdlColumnDefaultVisitor,
  DdlTableConstraint,
  ForeignKeyConstraint,
  FunctionColumnDefault,
  LiteralColumnDefault,
  PrimaryKeyConstraint,
  UniqueConstraint,
} from '@prisma-next/sql-relational-core/ast';
import type {
  PostgresCreateSchema,
  PostgresCreateTable,
  PostgresDdlNode,
  PostgresDdlVisitor,
} from '@prisma-next/target-postgres/ddl';
import { escapeLiteral } from '@prisma-next/target-postgres/sql-utils';
import type { PostgresLoweredStatement } from './types';

function renderPrimaryKeyConstraint(constraint: PrimaryKeyConstraint): string {
  const cols = constraint.columns.join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${constraint.name} PRIMARY KEY (${cols})`;
  }
  return `PRIMARY KEY (${cols})`;
}

function renderForeignKeyConstraint(constraint: ForeignKeyConstraint): string {
  const cols = constraint.columns.join(', ');
  const refCols = constraint.refColumns.join(', ');
  let sql = `FOREIGN KEY (${cols}) REFERENCES ${constraint.refTable} (${refCols})`;
  if (constraint.onDelete !== undefined) {
    sql += ` ON DELETE ${REFERENTIAL_ACTION_SQL[constraint.onDelete]}`;
  }
  if (constraint.onUpdate !== undefined) {
    sql += ` ON UPDATE ${REFERENTIAL_ACTION_SQL[constraint.onUpdate]}`;
  }
  if (constraint.name !== undefined) {
    sql = `CONSTRAINT ${constraint.name} ${sql}`;
  }
  return sql;
}

function renderUniqueConstraint(constraint: UniqueConstraint): string {
  const cols = constraint.columns.join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${constraint.name} UNIQUE (${cols})`;
  }
  return `UNIQUE (${cols})`;
}

function renderTableConstraint(constraint: DdlTableConstraint): string {
  switch (constraint.kind) {
    case 'primary-key':
      return renderPrimaryKeyConstraint(constraint);
    case 'foreign-key':
      return renderForeignKeyConstraint(constraint);
    case 'unique':
      return renderUniqueConstraint(constraint);
  }
}

class PostgresDdlVisitorImpl implements PostgresDdlVisitor<string> {
  createTable(node: PostgresCreateTable): string {
    const ifNotExists = node.ifNotExists ? 'if not exists ' : '';
    const tableRef = node.schema ? `${node.schema}.${node.table}` : node.table;
    const columnDefs = node.columns.map((column) => renderColumn(column));
    const constraintDefs =
      node.constraints !== undefined ? node.constraints.map(renderTableConstraint) : [];
    const allDefs = [...columnDefs, ...constraintDefs].join(',\n    ');
    return `create table ${ifNotExists}${tableRef} (\n    ${allDefs}\n  )`;
  }

  createSchema(node: PostgresCreateSchema): string {
    const ifNotExists = node.ifNotExists ? 'if not exists ' : '';
    return `create schema ${ifNotExists}${node.schema}`;
  }
}

const defaultVisitor: DdlColumnDefaultVisitor<string> = {
  literal(node: LiteralColumnDefault): string {
    const { value } = node;
    if (typeof value === 'string') {
      return `default '${escapeLiteral(value)}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `default ${String(value)}`;
    }
    if (value === null) {
      return 'default null';
    }
    return `default '${JSON.stringify(value)}'`;
  },
  function(node: FunctionColumnDefault): string {
    if (node.expression === 'autoincrement()') {
      return '';
    }
    if (node.expression === 'now()') {
      return 'default now()';
    }
    return `default (${node.expression})`;
  },
};

function renderColumn(column: DdlColumn): string {
  const parts = [column.name, column.type];
  if (column.notNull) {
    parts.push('not null');
  }
  if (column.primaryKey) {
    parts.push('primary key');
  }
  const defaultClause = column.default ? column.default.accept(defaultVisitor) : '';
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: PostgresDdlNode): PostgresLoweredStatement {
  const sql = ast.accept(new PostgresDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
