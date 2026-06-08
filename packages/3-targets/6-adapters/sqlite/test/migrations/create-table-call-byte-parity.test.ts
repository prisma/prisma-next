/**
 * Byte-parity proof: `CreateTableCall.toOp(lowerer).execute[0].sql` produces
 * the expected SQL string for representative table shapes.
 *
 * Each case constructs a `CreateTableCall` with typed DDL columns and
 * constraints, lowers it through the SQLite adapter, and asserts the execute
 * step's SQL matches the SQL the DDL renderer produces directly from the same
 * DDL node. Both go through the same renderer — this confirms no extra
 * transformation is introduced by the `CreateTableCall` wrapper.
 */

import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  col,
  foreignKey,
  primaryKey,
  unique,
} from '@prisma-next/sql-relational-core/contract-free';
import { createTable as buildCreateTableDdl } from '@prisma-next/target-sqlite/contract-free';
import { CreateTableCall } from '@prisma-next/target-sqlite/op-factory-call';
import { describe, expect, it } from 'vitest';
import { renderLoweredDdl } from '../../src/core/ddl-renderer';
import { SqliteControlAdapter } from '../../src/exports/control';

const lowerer = new SqliteControlAdapter();

function oracleSql(
  tableName: string,
  columns: readonly DdlColumn[],
  constraints?: readonly DdlTableConstraint[],
): string {
  const node = buildCreateTableDdl({
    table: tableName,
    columns,
    ...(constraints ? { constraints } : {}),
  });
  return renderLoweredDdl(node).sql;
}

function newPathSql(
  tableName: string,
  columns: readonly DdlColumn[],
  constraints?: readonly DdlTableConstraint[],
): string {
  const call = new CreateTableCall(tableName, columns, constraints);
  const sql = call.toOp(lowerer).execute[0]?.sql;
  if (sql === undefined) throw new Error('CreateTableCall.toOp produced no execute step');
  return sql;
}

describe('CreateTableCall byte-parity with renderCreateTableSql', () => {
  it('simple table: NOT NULL and nullable columns, no constraints', () => {
    const tableName = 'tags';
    const columns = [col('id', 'INTEGER', { notNull: true }), col('name', 'TEXT')];
    const oracle = oracleSql(tableName, columns);
    const actual = newPathSql(tableName, columns);
    expect(actual).toBe(oracle);
  });

  it('composite primary key: two NOT NULL columns with table-level PK constraint', () => {
    const tableName = 'memberships';
    const columns = [
      col('user_id', 'INTEGER', { notNull: true }),
      col('group_id', 'INTEGER', { notNull: true }),
    ];
    const constraints = [primaryKey(['user_id', 'group_id'])];
    const oracle = oracleSql(tableName, columns, constraints);
    const actual = newPathSql(tableName, columns, constraints);
    expect(actual).toBe(oracle);
  });

  it('table-level UNIQUE constraints (named and unnamed)', () => {
    const tableName = 'profiles';
    const columns = [
      col('id', 'INTEGER', { notNull: true }),
      col('username', 'TEXT', { notNull: true }),
      col('email', 'TEXT', { notNull: true }),
    ];
    const constraints = [
      primaryKey(['id']),
      unique(['username']),
      unique(['email'], { name: 'uq_profiles_email' }),
    ];
    const oracle = oracleSql(tableName, columns, constraints);
    const actual = newPathSql(tableName, columns, constraints);
    expect(actual).toBe(oracle);
  });

  it('foreign key with ON DELETE CASCADE referential action', () => {
    const tableName = 'posts';
    const columns = [
      col('id', 'INTEGER', { notNull: true }),
      col('author_id', 'INTEGER', { notNull: true }),
      col('title', 'TEXT', { notNull: true }),
    ];
    const constraints = [
      primaryKey(['id']),
      foreignKey(['author_id'], 'users', ['id'], { onDelete: 'cascade' }),
    ];
    const oracle = oracleSql(tableName, columns, constraints);
    const actual = newPathSql(tableName, columns, constraints);
    expect(actual).toBe(oracle);
  });

  it('autoincrement primary key: INTEGER PRIMARY KEY AUTOINCREMENT inline', () => {
    const tableName = 'events';
    const columns = [col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'), col('payload', 'TEXT')];
    const oracle = oracleSql(tableName, columns);
    const actual = newPathSql(tableName, columns);
    expect(actual).toBe(oracle);
  });
});
