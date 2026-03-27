import { escapeLiteral, quoteIdentifier } from '@prisma-next/adapter-postgres/control';
import { isTaggedBigInt } from '@prisma-next/contract/types';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type {
  ForeignKey,
  ReferentialAction,
  StorageColumn,
  StorageTable,
} from '@prisma-next/sql-contract/types';
import type { PostgresColumnDefault } from '../types';
import { qualifyTableName } from './planner-sql-checks';

export function buildCreateTableSql(
  qualifiedTableName: string,
  table: StorageTable,
  codecHooks: Map<string, CodecControlHooks>,
): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      const parts = [
        quoteIdentifier(columnName),
        buildColumnTypeSql(column, codecHooks),
        buildColumnDefaultSql(column.default, column),
        column.nullable ? '' : 'NOT NULL',
      ].filter(Boolean);
      return parts.join(' ');
    },
  );

  const constraintDefinitions: string[] = [];
  if (table.primaryKey) {
    constraintDefinitions.push(
      `PRIMARY KEY (${table.primaryKey.columns.map(quoteIdentifier).join(', ')})`,
    );
  }

  const allDefinitions = [...columnDefinitions, ...constraintDefinitions];
  return `CREATE TABLE ${qualifiedTableName} (\n  ${allDefinitions.join(',\n  ')}\n)`;
}

/**
 * Pattern for safe PostgreSQL type names.
 * Allows letters, digits, underscores, spaces (for "double precision", "character varying"),
 * and trailing [] for array types.
 */
const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*(\[\])?$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw new Error(
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*(\\[\\])?$/',
    );
  }
}

/**
 * Sanity check against accidental SQL injection from malformed contract files.
 * Rejects semicolons, SQL comment tokens, and dollar-quoting.
 * Not a comprehensive security boundary — the contract is developer-authored.
 */
function assertSafeDefaultExpression(expression: string): void {
  if (expression.includes(';') || /--|\/\*|\$\$|\bSELECT\b/i.test(expression)) {
    throw new Error(
      `Unsafe default expression in contract: "${expression}". ` +
        'Default expressions must not contain semicolons, SQL comment tokens, dollar-quoting, or subqueries.',
    );
  }
}

export function buildColumnTypeSql(
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
): string {
  const columnDefault = column.default;

  if (columnDefault?.kind === 'function' && columnDefault.expression === 'autoincrement()') {
    if (column.nativeType === 'int4' || column.nativeType === 'integer') {
      return 'SERIAL';
    }
    if (column.nativeType === 'int8' || column.nativeType === 'bigint') {
      return 'BIGSERIAL';
    }
    if (column.nativeType === 'int2' || column.nativeType === 'smallint') {
      return 'SMALLSERIAL';
    }
  }

  if (column.typeRef) {
    return quoteIdentifier(column.nativeType);
  }

  assertSafeNativeType(column.nativeType);
  return renderParameterizedTypeSql(column, codecHooks) ?? column.nativeType;
}

function renderParameterizedTypeSql(
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
): string | null {
  if (!column.typeParams) {
    return null;
  }

  if (!column.codecId) {
    throw new Error(
      `Column declares typeParams for nativeType "${column.nativeType}" but has no codecId. ` +
        'Ensure the column is associated with a codec.',
    );
  }

  const hooks = codecHooks.get(column.codecId);
  if (!hooks?.expandNativeType) {
    throw new Error(
      `Column declares typeParams for nativeType "${column.nativeType}" ` +
        `but no expandNativeType hook is registered for codecId "${column.codecId}". ` +
        'Ensure the extension providing this codec is included in extensionPacks.',
    );
  }

  const expanded = hooks.expandNativeType({
    nativeType: column.nativeType,
    codecId: column.codecId,
    typeParams: column.typeParams,
  });

  return expanded !== column.nativeType ? expanded : null;
}

/**
 * Builds the DEFAULT clause for a column definition.
 * Returns empty string if no default is defined.
 *
 * Note: autoincrement is handled specially via SERIAL types, so we skip it here.
 */
export function buildColumnDefaultSql(
  columnDefault: PostgresColumnDefault | undefined,
  column?: StorageColumn,
): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${renderDefaultLiteral(columnDefault.value, column)}`;
    case 'function': {
      // autoincrement is handled by SERIAL type, no explicit DEFAULT needed
      if (columnDefault.expression === 'autoincrement()') {
        return '';
      }
      assertSafeDefaultExpression(columnDefault.expression);
      return `DEFAULT (${columnDefault.expression})`;
    }
    case 'sequence':
      // Sequence names use quoteIdentifier for safe identifier handling
      return `DEFAULT nextval(${quoteIdentifier(columnDefault.name)}::regclass)`;
  }
}

export function renderDefaultLiteral(value: unknown, column?: StorageColumn): string {
  const isJsonColumn = column?.nativeType === 'json' || column?.nativeType === 'jsonb';

  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  if (!isJsonColumn && isTaggedBigInt(value)) {
    if (!/^-?\d+$/.test(value.value)) {
      throw new Error(`Invalid tagged bigint value: "${value.value}" is not a valid integer`);
    }
    return value.value;
  }
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (value === null) {
    return 'NULL';
  }
  const json = JSON.stringify(value);
  if (isJsonColumn) {
    return `'${escapeLiteral(json)}'::${column.nativeType}`;
  }
  return `'${escapeLiteral(json)}'`;
}

export function buildAddColumnSql(
  qualifiedTableName: string,
  columnName: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  temporaryDefault?: string | null,
): string {
  const typeSql = buildColumnTypeSql(column, codecHooks);
  const defaultSql =
    buildColumnDefaultSql(column.default, column) ||
    (temporaryDefault ? `DEFAULT ${temporaryDefault}` : '');
  const parts = [
    `ALTER TABLE ${qualifiedTableName}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeSql}`,
    defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

export const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};

export function buildForeignKeySql(
  schemaName: string,
  tableName: string,
  fkName: string,
  foreignKey: ForeignKey,
): string {
  let sql = `ALTER TABLE ${qualifyTableName(schemaName, tableName)}
ADD CONSTRAINT ${quoteIdentifier(fkName)}
FOREIGN KEY (${foreignKey.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(schemaName, foreignKey.references.table)} (${foreignKey.references.columns
    .map(quoteIdentifier)
    .join(', ')})`;

  if (foreignKey.onDelete !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[foreignKey.onDelete];
    if (!action) {
      throw new Error(`Unknown referential action for onDelete: ${String(foreignKey.onDelete)}`);
    }
    sql += `\nON DELETE ${action}`;
  }
  if (foreignKey.onUpdate !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[foreignKey.onUpdate];
    if (!action) {
      throw new Error(`Unknown referential action for onUpdate: ${String(foreignKey.onUpdate)}`);
    }
    sql += `\nON UPDATE ${action}`;
  }

  return sql;
}
