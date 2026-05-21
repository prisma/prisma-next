/**
 * Low-level DDL fragment builders for SQLite migrations.
 *
 * These helpers consume `StorageColumn` (the contract shape, possibly with
 * `typeRef`) and produce string fragments. They are called once per column
 * at the call-construction boundary in `issue-planner.ts` / strategies to
 * build flat `SqliteColumnSpec`s; the operation factories themselves never
 * see `StorageColumn` or `storageTypes`.
 */

import {
  isPostgresEnumStorageEntry,
  type PostgresEnumStorageEntry,
  type StorageColumn,
  type StorageTable,
  type StorageTypeInstance,
} from '@prisma-next/sql-contract/types';
import { quoteIdentifier } from '../sql-utils';

type SqliteColumnDefault = StorageColumn['default'];

const SAFE_NATIVE_TYPE_PATTERN = /^[a-zA-Z][a-zA-Z0-9_ ]*$/;

function assertSafeNativeType(nativeType: string): void {
  if (!SAFE_NATIVE_TYPE_PATTERN.test(nativeType)) {
    throw new Error(
      `Unsafe native type name in contract: "${nativeType}". ` +
        'Native type names must match /^[a-zA-Z][a-zA-Z0-9_ ]*$/',
    );
  }
}

/**
 * Renders the column's DDL type token (e.g. `"INTEGER"`, `"TEXT"`).
 * Resolves `typeRef` against `storageTypes` and validates the resulting
 * native type against a safe-identifier pattern.
 */
export function buildColumnTypeSql(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry> = {},
): string {
  const resolved = resolveColumnTypeMetadata(column, storageTypes);
  assertSafeNativeType(resolved.nativeType);
  return resolved.nativeType.toUpperCase();
}

export interface ColumnDefaultContext {
  readonly tableName: string;
  readonly columnName: string;
  readonly isIntegerPrimaryKey: boolean;
}

/**
 * Renders the column's `DEFAULT …` clause. Returns the empty string when
 * there is no default, and also when the default is `autoincrement` on a
 * valid `INTEGER PRIMARY KEY` column — SQLite encodes that as
 * `INTEGER PRIMARY KEY AUTOINCREMENT` inline on the column definition, not
 * as a separate DEFAULT.
 *
 * Throws a diagnostic when `kind: 'autoincrement'` arrives on a column that
 * is not `INTEGER PRIMARY KEY` — SQLite's autoincrement mechanism only
 * operates on the rowid alias column.
 */
export function buildColumnDefaultSql(
  columnDefault: SqliteColumnDefault | undefined,
  context?: ColumnDefaultContext,
): string {
  if (!columnDefault) return '';

  switch (columnDefault.kind) {
    case 'autoincrement': {
      if (!context?.isIntegerPrimaryKey) {
        const columnPath = context ? `${context.tableName}.${context.columnName}` : '<unknown>';
        throw new Error(
          `Column "${columnPath}" has kind 'autoincrement' but is not an INTEGER PRIMARY KEY. ` +
            'SQLite AUTOINCREMENT is only valid on INTEGER PRIMARY KEY columns.',
        );
      }
      return '';
    }
    case 'expression': {
      if (columnDefault.expression === 'now()') return "DEFAULT (datetime('now'))";
      return `DEFAULT (${columnDefault.expression})`;
    }
  }
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

/**
 * True when the column is rendered inline as `INTEGER PRIMARY KEY
 * AUTOINCREMENT`. Requires the column's default to be `autoincrement` and
 * the column to be the sole member of the table's primary key — anything
 * else falls back to a separate PRIMARY KEY constraint with a default
 * AUTOINCREMENT semantics expressed elsewhere.
 */
export function isInlineAutoincrementPrimaryKey(table: StorageTable, columnName: string): boolean {
  if (table.primaryKey?.columns.length !== 1) return false;
  if (table.primaryKey.columns[0] !== columnName) return false;
  const column = table.columns[columnName];
  return column?.default?.kind === 'autoincrement';
}

type ResolvedColumnTypeMetadata = Pick<StorageColumn, 'nativeType' | 'codecId' | 'typeParams'>;

function resolveColumnTypeMetadata(
  column: StorageColumn,
  storageTypes: Record<string, StorageTypeInstance | PostgresEnumStorageEntry>,
): ResolvedColumnTypeMetadata {
  if (!column.typeRef) {
    return column;
  }
  const referencedType = storageTypes[column.typeRef];
  if (!referencedType) {
    throw new Error(
      `Storage type "${column.typeRef}" referenced by column is not defined in storage.types.`,
    );
  }
  if (isPostgresEnumStorageEntry(referencedType)) {
    return {
      codecId: referencedType.codecId,
      nativeType: referencedType.nativeType,
      typeParams: { values: referencedType.values } as Record<string, unknown>,
    };
  }
  return {
    codecId: referencedType.codecId,
    nativeType: referencedType.nativeType,
    typeParams: referencedType.typeParams,
  };
}
