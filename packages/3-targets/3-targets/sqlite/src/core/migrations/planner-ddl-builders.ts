import { escapeLiteral, quoteIdentifier } from '@prisma-next/adapter-sqlite/control';
import type { CodecControlHooks } from '@prisma-next/family-sql/control';
import type {
  ForeignKey,
  ReferentialAction,
  StorageColumn,
  StorageTable,
  StorageTypeInstance,
} from '@prisma-next/sql-contract/types';

type SqliteColumnDefault = StorageColumn['default'];

export function buildCreateTableSql(
  tableName: string,
  table: StorageTable,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const columnDefinitions = Object.entries(table.columns).map(
    ([columnName, column]: [string, StorageColumn]) => {
      const isAutoincrement =
        column.default?.kind === 'function' && column.default.expression === 'autoincrement()';
      const isIntegerPk =
        isAutoincrement &&
        table.primaryKey?.columns.length === 1 &&
        table.primaryKey.columns[0] === columnName;

      const parts = [
        quoteIdentifier(columnName),
        buildColumnTypeSql(column, codecHooks, storageTypes),
      ];

      // SQLite AUTOINCREMENT requires INTEGER PRIMARY KEY on the same column definition
      if (isIntegerPk) {
        parts.push('PRIMARY KEY AUTOINCREMENT');
      } else {
        const defaultSql = buildColumnDefaultSql(column.default, column);
        if (defaultSql) {
          parts.push(defaultSql);
        }
        if (!column.nullable) {
          parts.push('NOT NULL');
        }
      }

      return parts.join(' ');
    },
  );

  const constraintDefinitions: string[] = [];

  // Add PRIMARY KEY constraint unless it's handled inline (INTEGER PRIMARY KEY AUTOINCREMENT)
  if (table.primaryKey) {
    const isInlineAutoincrement =
      table.primaryKey.columns.length === 1 &&
      isAutoincrementColumn(table, table.primaryKey.columns[0] ?? '');
    if (!isInlineAutoincrement) {
      constraintDefinitions.push(
        `PRIMARY KEY (${table.primaryKey.columns.map(quoteIdentifier).join(', ')})`,
      );
    }
  }

  // Inline UNIQUE constraints
  for (const unique of table.uniques) {
    const name = unique.name ? `CONSTRAINT ${quoteIdentifier(unique.name)} ` : '';
    constraintDefinitions.push(`${name}UNIQUE (${unique.columns.map(quoteIdentifier).join(', ')})`);
  }

  // Inline FOREIGN KEY constraints
  for (const fk of table.foreignKeys) {
    if (fk.constraint === false) continue;
    constraintDefinitions.push(buildInlineForeignKeySql(fk));
  }

  const allDefinitions = [...columnDefinitions, ...constraintDefinitions];
  return `CREATE TABLE ${quoteIdentifier(tableName)} (\n  ${allDefinitions.join(',\n  ')}\n)`;
}

function isAutoincrementColumn(table: StorageTable, columnName: string): boolean {
  const column = table.columns[columnName];
  return column?.default?.kind === 'function' && column.default.expression === 'autoincrement()';
}

const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw new Error(
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*$/',
    );
  }
}

function assertSafeDefaultExpression(expression: string): void {
  if (expression.includes(';') || /--|\/\*|\bSELECT\b/i.test(expression)) {
    throw new Error(
      `Unsafe default expression in contract: "${expression}". ` +
        'Default expressions must not contain semicolons, SQL comment tokens, or subqueries.',
    );
  }
}

export function buildColumnTypeSql(
  column: StorageColumn,
  _codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  assertSafeNativeType(resolved.nativeType);
  return resolved.nativeType.toUpperCase();
}

export function buildColumnDefaultSql(
  columnDefault: SqliteColumnDefault | undefined,
  _column?: StorageColumn,
): string {
  if (!columnDefault) {
    return '';
  }

  switch (columnDefault.kind) {
    case 'literal':
      return `DEFAULT ${renderDefaultLiteral(columnDefault.value)}`;
    case 'function': {
      if (columnDefault.expression === 'autoincrement()') {
        return '';
      }
      if (columnDefault.expression === 'now()') {
        return "DEFAULT (datetime('now'))";
      }
      assertSafeDefaultExpression(columnDefault.expression);
      return `DEFAULT (${columnDefault.expression})`;
    }
  }
}

export function renderDefaultLiteral(value: unknown): string {
  if (value instanceof Date) {
    return `'${escapeLiteral(value.toISOString())}'`;
  }
  if (typeof value === 'string') {
    return `'${escapeLiteral(value)}'`;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value === null) {
    return 'NULL';
  }
  return `'${escapeLiteral(JSON.stringify(value))}'`;
}

export function buildAddColumnSql(
  tableName: string,
  columnName: string,
  column: StorageColumn,
  codecHooks: Map<string, CodecControlHooks>,
  storageTypes: Record<string, StorageTypeInstance> = {},
): string {
  const typeSql = buildColumnTypeSql(column, codecHooks, storageTypes);
  const defaultSql = buildColumnDefaultSql(column.default, column);
  const parts = [
    `ALTER TABLE ${quoteIdentifier(tableName)}`,
    `ADD COLUMN ${quoteIdentifier(columnName)} ${typeSql}`,
    defaultSql,
    column.nullable ? '' : 'NOT NULL',
  ].filter(Boolean);
  return parts.join(' ');
}

export function buildRenameColumnSql(tableName: string, oldName: string, newName: string): string {
  return `ALTER TABLE ${quoteIdentifier(tableName)} RENAME COLUMN ${quoteIdentifier(oldName)} TO ${quoteIdentifier(newName)}`;
}

const REFERENTIAL_ACTION_SQL: Record<ReferentialAction, string> = {
  noAction: 'NO ACTION',
  restrict: 'RESTRICT',
  cascade: 'CASCADE',
  setNull: 'SET NULL',
  setDefault: 'SET DEFAULT',
};

function buildInlineForeignKeySql(foreignKey: ForeignKey): string {
  const fkName = foreignKey.name ? `CONSTRAINT ${quoteIdentifier(foreignKey.name)} ` : '';
  let sql = `${fkName}FOREIGN KEY (${foreignKey.columns.map(quoteIdentifier).join(', ')}) REFERENCES ${quoteIdentifier(foreignKey.references.table)} (${foreignKey.references.columns.map(quoteIdentifier).join(', ')})`;

  if (foreignKey.onDelete !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[foreignKey.onDelete];
    if (!action) {
      throw new Error(`Unknown referential action for onDelete: ${String(foreignKey.onDelete)}`);
    }
    sql += ` ON DELETE ${action}`;
  }
  if (foreignKey.onUpdate !== undefined) {
    const action = REFERENTIAL_ACTION_SQL[foreignKey.onUpdate];
    if (!action) {
      throw new Error(`Unknown referential action for onUpdate: ${String(foreignKey.onUpdate)}`);
    }
    sql += ` ON UPDATE ${action}`;
  }

  return sql;
}

export function buildCreateIndexSql(
  tableName: string,
  indexName: string,
  columns: readonly string[],
  unique = false,
): string {
  const uniqueKeyword = unique ? 'UNIQUE ' : '';
  return `CREATE ${uniqueKeyword}INDEX ${quoteIdentifier(indexName)} ON ${quoteIdentifier(tableName)} (${columns.map(quoteIdentifier).join(', ')})`;
}

export function buildDropIndexSql(indexName: string): string {
  return `DROP INDEX IF EXISTS ${quoteIdentifier(indexName)}`;
}

type ResolvedColumnTypeMetadata = Pick<StorageColumn, 'nativeType' | 'codecId' | 'typeParams'>;

function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }
  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    return column;
  }
  return {
    codecId: referencedType.codecId,
    nativeType: referencedType.nativeType,
    typeParams: referencedType.typeParams,
  };
}
