import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type {
  ForeignKey,
  PostgresEnumStorageEntry,
  ReferentialAction,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { escapeLiteral, quoteIdentifier } from '../sql-utils';
import type { PostgresColumnDefault } from '../types';
import { qualifyTableName } from './planner-sql-checks';
import { resolveColumnTypeMetadata } from './planner-type-resolution';

export function buildCreateTableSql(
  qualifiedTableName: string,
  table: StorageTable,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {},
): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      const parts = [
        quoteIdentifier(columnName),
        buildColumnTypeSql(column, codecHooks, storageTypes),
        buildColumnDefaultSql(column.default),
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
 * Renders the SQL type for a column in DDL context.
 *
 * @param allowPseudoTypes - When true (default), autoincrement integer columns
 *   produce SERIAL/BIGSERIAL/SMALLSERIAL pseudo-types. Set to false for contexts
 *   like ALTER COLUMN TYPE where pseudo-types are invalid.
 */
export function buildColumnTypeSql(
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {},
  allowPseudoTypes = true,
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);

  if (allowPseudoTypes) {
    const columnDefault = column.default;
    if (columnDefault?.kind === 'autoincrement') {
      if (resolved.nativeType === 'int4' || resolved.nativeType === 'integer') {
        return 'SERIAL';
      }
      if (resolved.nativeType === 'int8' || resolved.nativeType === 'bigint') {
        return 'BIGSERIAL';
      }
      if (resolved.nativeType === 'int2' || resolved.nativeType === 'smallint') {
        return 'SMALLSERIAL';
      }
    }
  }

  const expanded = expandParameterizedTypeSql(resolved, codecHooks);
  if (expanded !== null) {
    return expanded;
  }

  if (column.typeRef) {
    return quoteIdentifier(resolved.nativeType);
  }

  assertSafeNativeType(resolved.nativeType);
  return resolved.nativeType;
}

function expandParameterizedTypeSql(
  column: Pick<StorageColumn, 'nativeType' | 'codecId' | 'typeParams'>,
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
    if (hooks?.planTypeOperations) {
      return null;
    }
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

/** Autoincrement columns use SERIAL types, so this returns empty for them. */
export function buildColumnDefaultSql(columnDefault: PostgresColumnDefault | undefined): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'autoincrement':
      return '';
    case 'expression':
      return `DEFAULT (${columnDefault.expression})`;
    case 'sequence':
      return `DEFAULT nextval('${escapeLiteral(quoteIdentifier(columnDefault.name))}'::regclass)`;
  }
}

export function buildAddColumnSql(
  qualifiedTableName: string,
  columnName: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  temporaryDefault?: string | null,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {},
): string {
  const typeSql = buildColumnTypeSql(column, codecHooks, storageTypes);
  const defaultSql =
    buildColumnDefaultSql(column.default) ||
    (temporaryDefault ? `DEFAULT ${temporaryDefault}` : '');
  const parts = [
    `ALTER TABLE ${qualifiedTableName}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeSql}`,
    defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
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
FOREIGN KEY (${foreignKey.source.columns.map(quoteIdentifier).join(', ')})
REFERENCES ${qualifyTableName(schemaName, foreignKey.target.tableName)} (${foreignKey.target.columns
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
