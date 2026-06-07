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
  SqliteCreateTable,
  SqliteDdlNode,
  SqliteDdlVisitor,
} from '@prisma-next/target-sqlite/ddl';
import { escapeLiteral, quoteIdentifier } from '@prisma-next/target-sqlite/sql-utils';
import type { SqliteLoweredStatement } from './types';

function renderPrimaryKeyConstraint(constraint: PrimaryKeyConstraint): string {
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${constraint.name} PRIMARY KEY (${cols})`;
  }
  return `PRIMARY KEY (${cols})`;
}

function renderForeignKeyConstraint(constraint: ForeignKeyConstraint): string {
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  const refCols = constraint.refColumns.map(quoteIdentifier).join(', ');
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
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
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

class SqliteDdlVisitorImpl implements SqliteDdlVisitor<string> {
  createTable(node: SqliteCreateTable): string {
    const ifNotExists = node.ifNotExists ? 'IF NOT EXISTS ' : '';
    const tableRef = quoteIdentifier(node.table);
    const columnDefs = node.columns.map((column) => renderColumn(column));
    const constraintDefs =
      node.constraints !== undefined ? node.constraints.map(renderTableConstraint) : [];
    const allDefs = [...columnDefs, ...constraintDefs].join(',\n  ');
    return `CREATE TABLE ${ifNotExists}${tableRef} (\n  ${allDefs}\n)`;
  }
}

const defaultVisitor: DdlColumnDefaultVisitor<string> = {
  literal(node: LiteralColumnDefault): string {
    const { value } = node;
    if (typeof value === 'string') {
      return `DEFAULT '${escapeLiteral(value)}'`;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      return `DEFAULT ${String(value)}`;
    }
    if (value === null) {
      return 'DEFAULT NULL';
    }
    return `DEFAULT '${JSON.stringify(value)}'`;
  },
  function(node: FunctionColumnDefault): string {
    if (node.expression === 'autoincrement()') {
      return '';
    }
    return `DEFAULT (${node.expression})`;
  },
};

function renderColumn(column: DdlColumn): string {
  if (column.type.includes('AUTOINCREMENT')) {
    return `${quoteIdentifier(column.name)} ${column.type}`;
  }
  const parts = [quoteIdentifier(column.name), column.type];
  if (column.notNull) {
    parts.push('NOT NULL');
  }
  if (column.primaryKey) {
    parts.push('PRIMARY KEY');
  }
  const defaultClause = column.default ? column.default.accept(defaultVisitor) : '';
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: SqliteDdlNode): SqliteLoweredStatement {
  const sql = ast.accept(new SqliteDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
