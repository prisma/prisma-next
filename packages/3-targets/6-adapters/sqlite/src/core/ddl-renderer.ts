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

function quoteQualifiedIdentifier(name: string): string {
  return name.split('.').map(quoteIdentifier).join('.');
}

function renderPrimaryKeyConstraint(constraint: PrimaryKeyConstraint): string {
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} PRIMARY KEY (${cols})`;
  }
  return `PRIMARY KEY (${cols})`;
}

function renderForeignKeyConstraint(constraint: ForeignKeyConstraint): string {
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  const refCols = constraint.refColumns.map(quoteIdentifier).join(', ');
  let sql = `FOREIGN KEY (${cols}) REFERENCES ${quoteQualifiedIdentifier(constraint.refTable)} (${refCols})`;
  if (constraint.onDelete !== undefined) {
    sql += ` ON DELETE ${REFERENTIAL_ACTION_SQL[constraint.onDelete]}`;
  }
  if (constraint.onUpdate !== undefined) {
    sql += ` ON UPDATE ${REFERENTIAL_ACTION_SQL[constraint.onUpdate]}`;
  }
  if (constraint.name !== undefined) {
    sql = `CONSTRAINT ${quoteIdentifier(constraint.name)} ${sql}`;
  }
  return sql;
}

function renderUniqueConstraint(constraint: UniqueConstraint): string {
  const cols = constraint.columns.map(quoteIdentifier).join(', ');
  if (constraint.name !== undefined) {
    return `CONSTRAINT ${quoteIdentifier(constraint.name)} UNIQUE (${cols})`;
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
  // SQLite has no `jsonb` / `json` column type, so the ctx is unused — but
  // the visitor interface requires it for cross-dialect symmetry with the
  // Postgres renderer, which uses ctx.nativeType to emit JSON casts.
  literal(node: LiteralColumnDefault, _ctx): string {
    const { value } = node;
    if (value instanceof Date) {
      return `DEFAULT '${escapeLiteral(value.toISOString())}'`;
    }
    if (typeof value === 'string') {
      return `DEFAULT '${escapeLiteral(value)}'`;
    }
    if (typeof value === 'number') {
      return `DEFAULT ${String(value)}`;
    }
    if (typeof value === 'boolean') {
      // SQLite has no boolean type; store as 0/1 to match the pre-slice format.
      return `DEFAULT ${value ? '1' : '0'}`;
    }
    if (typeof value === 'bigint') {
      // Defensive: bigint is not in ColumnDefaultLiteralInputValue but guard
      // against JSON.stringify throwing if one ever reaches this path.
      return `DEFAULT ${String(value)}`;
    }
    if (value === null) {
      return 'DEFAULT NULL';
    }
    return `DEFAULT '${escapeLiteral(JSON.stringify(value))}'`;
  },
  function(node: FunctionColumnDefault, _ctx): string {
    if (node.expression === 'autoincrement()') {
      return '';
    }
    if (node.expression === 'now()') return "DEFAULT (datetime('now'))";
    return `DEFAULT (${node.expression})`;
  },
};

function renderColumn(column: DdlColumn): string {
  // The `tableToDdlParts` helper in issue-planner.ts encodes the
  // `INTEGER PRIMARY KEY AUTOINCREMENT` inline column definition directly into
  // `DdlColumn.type` (rather than setting a column-level flag) because
  // `DdlColumn` has no SQLite-specific autoincrement field. Both sites must
  // stay in sync: when one changes the encoded string the other must change
  // the detection. The structural fix is tracked in TML-2866.
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
  const defaultClause = column.default
    ? column.default.accept(defaultVisitor, { nativeType: column.type })
    : '';
  if (defaultClause.length > 0) {
    parts.push(defaultClause);
  }
  return parts.join(' ');
}

export function renderLoweredDdl(ast: SqliteDdlNode): SqliteLoweredStatement {
  const sql = ast.accept(new SqliteDdlVisitorImpl());
  return Object.freeze({ sql, params: Object.freeze([]) });
}
