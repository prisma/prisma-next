/**
 * Byte-parity proof: `CreateTableCall.toOp(lowerer).execute[0].sql` produces
 * the same SQL string as the free `createTable(tableName, spec).execute[0].sql`
 * for representative table shapes.
 *
 * Both paths must agree byte-for-byte so the DDL lowering path produces no
 * regression in the SQL emitted to the database.
 */

import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  col,
  foreignKey,
  primaryKey,
  unique,
} from '@prisma-next/sql-relational-core/contract-free';
import { createTable } from '@prisma-next/target-sqlite/migration';
import { CreateTableCall } from '@prisma-next/target-sqlite/op-factory-call';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../../src/core/adapter';

const lowerer = createSqliteAdapter();

type SqliteTableSpec = Parameters<typeof createTable>[1];

function oracleSql(tableName: string, spec: SqliteTableSpec): string {
  const op = createTable(tableName, spec);
  const sql = op.execute[0]?.sql;
  if (sql === undefined) throw new Error('createTable produced no execute step');
  return sql;
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
    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'name', typeSql: 'TEXT', defaultSql: '', nullable: true },
      ],
      uniques: [],
      foreignKeys: [],
    };
    const oracle = oracleSql(tableName, spec);
    const actual = newPathSql(tableName, [
      col('id', 'INTEGER', { notNull: true }),
      col('name', 'TEXT'),
    ]);
    expect(actual).toBe(oracle);
  });

  it('composite primary key: two NOT NULL columns with table-level PK constraint', () => {
    const tableName = 'memberships';
    const spec: SqliteTableSpec = {
      columns: [
        { name: 'user_id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'group_id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
      ],
      primaryKey: { columns: ['user_id', 'group_id'] },
      uniques: [],
      foreignKeys: [],
    };
    const oracle = oracleSql(tableName, spec);
    const actual = newPathSql(
      tableName,
      [col('user_id', 'INTEGER', { notNull: true }), col('group_id', 'INTEGER', { notNull: true })],
      [primaryKey(['user_id', 'group_id'])],
    );
    expect(actual).toBe(oracle);
  });

  it('table-level UNIQUE constraints (named and unnamed)', () => {
    const tableName = 'profiles';
    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'username', typeSql: 'TEXT', defaultSql: '', nullable: false },
        { name: 'email', typeSql: 'TEXT', defaultSql: '', nullable: false },
      ],
      primaryKey: { columns: ['id'] },
      uniques: [{ columns: ['username'] }, { columns: ['email'], name: 'uq_profiles_email' }],
      foreignKeys: [],
    };
    const oracle = oracleSql(tableName, spec);
    const actual = newPathSql(
      tableName,
      [
        col('id', 'INTEGER', { notNull: true }),
        col('username', 'TEXT', { notNull: true }),
        col('email', 'TEXT', { notNull: true }),
      ],
      [primaryKey(['id']), unique(['username']), unique(['email'], { name: 'uq_profiles_email' })],
    );
    expect(actual).toBe(oracle);
  });

  it('foreign key with ON DELETE CASCADE referential action', () => {
    const tableName = 'posts';
    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'author_id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'title', typeSql: 'TEXT', defaultSql: '', nullable: false },
      ],
      primaryKey: { columns: ['id'] },
      uniques: [],
      foreignKeys: [
        {
          columns: ['author_id'],
          references: { table: 'users', columns: ['id'] },
          constraint: true,
          onDelete: 'cascade',
        },
      ],
    };
    const oracle = oracleSql(tableName, spec);
    const actual = newPathSql(
      tableName,
      [
        col('id', 'INTEGER', { notNull: true }),
        col('author_id', 'INTEGER', { notNull: true }),
        col('title', 'TEXT', { notNull: true }),
      ],
      [primaryKey(['id']), foreignKey(['author_id'], 'users', ['id'], { onDelete: 'cascade' })],
    );
    expect(actual).toBe(oracle);
  });

  it('autoincrement primary key: INTEGER PRIMARY KEY AUTOINCREMENT inline', () => {
    const tableName = 'events';
    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'id',
          typeSql: 'INTEGER',
          defaultSql: '',
          nullable: false,
          inlineAutoincrementPrimaryKey: true,
        },
        { name: 'payload', typeSql: 'TEXT', defaultSql: '', nullable: true },
      ],
      uniques: [],
      foreignKeys: [],
    };
    const oracle = oracleSql(tableName, spec);
    const actual = newPathSql(tableName, [
      col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'),
      col('payload', 'TEXT'),
    ]);
    expect(actual).toBe(oracle);
  });
});
