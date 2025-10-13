import { createHash } from 'crypto';
import { compileToSQL } from '@prisma/sql';
import {
  ScriptAST,
  StatementAST,
  DdlAST,
  RawStmtAST,
  TxBlockAST,
  ColumnSpec,
  ConstraintSpec,
  IndexCol,
} from '../script-ast';

// Quote identifier for PostgreSQL
function quoteIdentifier(identifier: string): string {
  // Always quote identifiers to be safe
  return `"${identifier.replace(/"/g, '""')}"`;
}

// Render column type to PostgreSQL
function renderColumnType(type: string): string {
  switch (type) {
    case 'int4':
      return 'INTEGER';
    case 'int8':
      return 'BIGINT';
    case 'text':
      return 'TEXT';
    case 'varchar':
      return 'VARCHAR(255)';
    case 'bool':
      return 'BOOLEAN';
    case 'timestamptz':
      return 'TIMESTAMPTZ';
    case 'timestamp':
      return 'TIMESTAMP';
    case 'float8':
      return 'DOUBLE PRECISION';
    case 'float4':
      return 'REAL';
    case 'uuid':
      return 'UUID';
    case 'json':
      return 'JSON';
    case 'jsonb':
      return 'JSONB';
    default:
      return type.toUpperCase();
  }
}

// Render default value
function renderDefault(defaultValue: ColumnSpec['default']): string {
  if (!defaultValue) return '';

  switch (defaultValue.kind) {
    case 'autoincrement':
      return 'SERIAL';
    case 'now':
      return 'DEFAULT NOW()';
    case 'literal':
      return `DEFAULT '${defaultValue.value}'`;
    default:
      return '';
  }
}

// Render column specification
function renderColumn(column: ColumnSpec): string {
  let sql = `${quoteIdentifier(column.name)} `;

  // Handle autoincrement specially
  if (column.default?.kind === 'autoincrement') {
    sql += renderColumnType(column.type).replace('INTEGER', 'SERIAL');
  } else {
    sql += renderColumnType(column.type);
  }

  if (!column.nullable) {
    sql += ' NOT NULL';
  }

  if (column.default && column.default.kind !== 'autoincrement') {
    sql += ` ${renderDefault(column.default)}`;
  }

  return sql;
}

// Render constraint
function renderConstraint(constraint: ConstraintSpec): string {
  switch (constraint.kind) {
    case 'primaryKey':
      const pkName = constraint.name ? `CONSTRAINT ${quoteIdentifier(constraint.name)} ` : '';
      return `${pkName}PRIMARY KEY (${constraint.columns.map(quoteIdentifier).join(', ')})`;

    case 'unique':
      const uniqueName = constraint.name ? `CONSTRAINT ${quoteIdentifier(constraint.name)} ` : '';
      return `${uniqueName}UNIQUE (${constraint.columns.map(quoteIdentifier).join(', ')})`;

    case 'foreignKey':
      const fkName = constraint.name ? `CONSTRAINT ${quoteIdentifier(constraint.name)} ` : '';
      let fkSql = `${fkName}FOREIGN KEY (${constraint.columns.map(quoteIdentifier).join(', ')}) `;
      fkSql += `REFERENCES ${quoteIdentifier(constraint.ref.table)} (${constraint.ref.columns.map(quoteIdentifier).join(', ')})`;

      if (constraint.onDelete) {
        fkSql += ` ON DELETE ${constraint.onDelete.toUpperCase()}`;
      }
      if (constraint.onUpdate) {
        fkSql += ` ON UPDATE ${constraint.onUpdate.toUpperCase()}`;
      }

      return fkSql;
  }
}

// Render DDL statement
function renderDdlStatement(ddl: DdlAST): string {
  switch (ddl.type) {
    case 'createTable': {
      let sql = 'CREATE TABLE';
      if (ddl.ifNotExists) sql += ' IF NOT EXISTS';
      sql += ` ${quoteIdentifier(ddl.name.name)} (`;

      const parts: string[] = [];

      // Add columns
      for (const column of ddl.columns) {
        parts.push(renderColumn(column));
      }

      // Add constraints
      if (ddl.constraints) {
        for (const constraint of ddl.constraints) {
          parts.push(renderConstraint(constraint));
        }
      }

      sql += parts.join(', ');
      sql += ')';
      return sql;
    }

    case 'dropTable': {
      let sql = 'DROP TABLE';
      if (ddl.ifExists) sql += ' IF EXISTS';
      sql += ` ${quoteIdentifier(ddl.name.name)}`;
      return sql;
    }

    case 'alterTable': {
      const alters = ddl.alters.map((alter) => {
        switch (alter.kind) {
          case 'addColumn':
            return `ADD COLUMN ${renderColumn(alter.column)}`;
          case 'dropColumn':
            return `DROP COLUMN ${quoteIdentifier(alter.name)}`;
          case 'alterColumn': {
            const parts: string[] = [];
            if (alter.setNotNull) parts.push('SET NOT NULL');
            if (alter.dropNotNull) parts.push('DROP NOT NULL');
            if (alter.setType) parts.push(`SET DATA TYPE ${renderColumnType(alter.setType)}`);
            if (alter.setDefault) parts.push(renderDefault(alter.setDefault));
            if (alter.dropDefault) parts.push('DROP DEFAULT');
            return `ALTER COLUMN ${quoteIdentifier(alter.name)} ${parts.join(', ')}`;
          }
        }
      });

      return `ALTER TABLE ${quoteIdentifier(ddl.name.name)} ${alters.join(', ')}`;
    }

    case 'createIndex': {
      let sql = 'CREATE';
      if (ddl.unique) sql += ' UNIQUE';
      sql += ' INDEX';
      if (ddl.concurrently) sql += ' CONCURRENTLY';
      sql += ` ${quoteIdentifier(ddl.name.name)} ON ${quoteIdentifier(ddl.table.name)} (`;

      const indexCols = ddl.columns.map((col) => {
        let colSql = quoteIdentifier(col.name);
        if (col.order) colSql += ` ${col.order.toUpperCase()}`;
        if (col.opclass) colSql += ` ${col.opclass}`;
        return colSql;
      });

      sql += indexCols.join(', ');
      sql += ')';
      return sql;
    }

    case 'dropIndex': {
      let sql = 'DROP INDEX';
      if (ddl.concurrently) sql += ' CONCURRENTLY';
      if (ddl.ifExists) sql += ' IF EXISTS';
      sql += ` ${quoteIdentifier(ddl.name.name)}`;
      return sql;
    }

    case 'addConstraint': {
      return `ALTER TABLE ${quoteIdentifier(ddl.table.name)} ADD ${renderConstraint(ddl.spec)}`;
    }

    case 'dropConstraint': {
      return `ALTER TABLE ${quoteIdentifier(ddl.table.name)} DROP CONSTRAINT ${quoteIdentifier(ddl.name.name)}`;
    }
  }
}

// Render statement
function renderStatement(stmt: StatementAST): string {
  switch (stmt.type) {
    case 'tx': {
      const statements = stmt.statements.map(renderDdlStatement);
      return `BEGIN;\n${statements.join(';\n')};\nCOMMIT;`;
    }

    case 'raw': {
      // Use existing raw SQL compilation
      const { sql } = compileToSQL({
        type: 'raw',
        template: stmt.template,
      });
      return sql;
    }

    default:
      return renderDdlStatement(stmt as DdlAST);
  }
}

// Main render function
export function renderScript(script: ScriptAST): {
  sql: string;
  params: unknown[];
  sqlHash: string;
} {
  const statements = script.statements.map(renderStatement);
  const sql = statements.join(';\n');

  // Compute deterministic hash
  const hash = createHash('sha256');
  hash.update(sql);
  const sqlHash = `sha256:${hash.digest('hex')}`;

  return {
    sql,
    params: [], // DDL doesn't use parameters
    sqlHash,
  };
}
