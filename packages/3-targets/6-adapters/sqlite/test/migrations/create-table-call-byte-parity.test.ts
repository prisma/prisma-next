/**
 * Byte-parity proof: `CreateTableCall.toOp(lowerer).execute[0].sql` produces
 * the same SQL as the pre-slice `createTable` operation from the internal
 * tables module, which uses a different code path (`SqliteTableSpec` →
 * `renderColumnDefinition` / `renderCreateTableSql`). Both paths are given
 * independently-authored representations of the same table shape so a drift
 * in either renderer is visible as a test failure.
 */

import type { DdlColumn, DdlTableConstraint } from '@prisma-next/sql-relational-core/ast';
import {
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  unique,
} from '@prisma-next/sql-relational-core/contract-free';
import { CreateTableCall } from '@prisma-next/target-sqlite/op-factory-call';
import { describe, expect, it } from 'vitest';
import type { SqliteTableSpec } from '../../../../3-targets/sqlite/src/core/migrations/operations/shared';
// Pre-slice oracle: the createTable function and SqliteTableSpec type from the
// internal tables module (kept on disk for Phase 2 recreateTable use).
import { createTable as preSliceCreateTableOp } from '../../../../3-targets/sqlite/src/core/migrations/operations/tables';
import { SqliteControlAdapter } from '../../src/exports/control';

const lowerer = new SqliteControlAdapter();

function oracleSql(tableName: string, spec: SqliteTableSpec): string {
  const op = preSliceCreateTableOp(tableName, spec);
  const sql = op.execute[0]?.sql;
  if (sql === undefined) throw new Error('createTable op produced no execute step');
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

describe('CreateTableCall byte-parity with pre-slice createTable', () => {
  it('simple table: NOT NULL and nullable columns, no constraints', () => {
    const tableName = 'tags';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'name', typeSql: 'TEXT', defaultSql: '', nullable: true },
      ],
    };
    const columns = [col('id', 'INTEGER', { notNull: true }), col('name', 'TEXT')];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('composite primary key: two NOT NULL columns with table-level PK constraint', () => {
    const tableName = 'memberships';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'user_id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
        { name: 'group_id', typeSql: 'INTEGER', defaultSql: '', nullable: false },
      ],
      primaryKey: { columns: ['user_id', 'group_id'] },
    };
    const columns = [
      col('user_id', 'INTEGER', { notNull: true }),
      col('group_id', 'INTEGER', { notNull: true }),
    ];
    const constraints = [primaryKey(['user_id', 'group_id'])];

    expect(newPathSql(tableName, columns, constraints)).toBe(oracleSql(tableName, spec));
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
    };
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

    expect(newPathSql(tableName, columns, constraints)).toBe(oracleSql(tableName, spec));
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
      foreignKeys: [
        {
          columns: ['author_id'],
          references: { table: 'users', columns: ['id'] },
          onDelete: 'cascade',
          constraint: true,
        },
      ],
    };
    const columns = [
      col('id', 'INTEGER', { notNull: true }),
      col('author_id', 'INTEGER', { notNull: true }),
      col('title', 'TEXT', { notNull: true }),
    ];
    const constraints = [
      primaryKey(['id']),
      foreignKey(['author_id'], 'users', ['id'], { onDelete: 'cascade' }),
    ];

    expect(newPathSql(tableName, columns, constraints)).toBe(oracleSql(tableName, spec));
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
    };
    const columns = [col('id', 'INTEGER PRIMARY KEY AUTOINCREMENT'), col('payload', 'TEXT')];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('string literal default', () => {
    const tableName = 'settings';

    const spec: SqliteTableSpec = {
      columns: [{ name: 'theme', typeSql: 'TEXT', defaultSql: "DEFAULT 'light'", nullable: true }],
    };
    const columns = [col('theme', 'TEXT', { default: lit('light') })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('number literal default', () => {
    const tableName = 'limits';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'max_items', typeSql: 'INTEGER', defaultSql: 'DEFAULT 10', nullable: true },
      ],
    };
    const columns = [col('max_items', 'INTEGER', { default: lit(10) })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('boolean literal default emitted as 0/1', () => {
    const tableName = 'flags';

    const spec: SqliteTableSpec = {
      columns: [
        { name: 'enabled', typeSql: 'INTEGER', defaultSql: 'DEFAULT 1', nullable: true },
        { name: 'deleted', typeSql: 'INTEGER', defaultSql: 'DEFAULT 0', nullable: true },
      ],
    };
    const columns = [
      col('enabled', 'INTEGER', { default: lit(true) }),
      col('deleted', 'INTEGER', { default: lit(false) }),
    ];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('null literal default', () => {
    const tableName = 'items';

    const spec: SqliteTableSpec = {
      columns: [{ name: 'notes', typeSql: 'TEXT', defaultSql: 'DEFAULT NULL', nullable: true }],
    };
    const columns = [col('notes', 'TEXT', { default: lit(null) })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('Date literal default emitted as a single-quoted ISO string', () => {
    const tableName = 'logs';
    const date = new Date('2025-01-01T00:00:00.000Z');

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'created_at',
          typeSql: 'TEXT',
          defaultSql: "DEFAULT '2025-01-01T00:00:00.000Z'",
          nullable: true,
        },
      ],
    };
    const columns = [col('created_at', 'TEXT', { default: lit(date) })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('JSON object literal default', () => {
    const tableName = 'configs';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'settings',
          typeSql: 'TEXT',
          defaultSql: 'DEFAULT \'{"retries":3}\'',
          nullable: true,
        },
      ],
    };
    const columns = [col('settings', 'TEXT', { default: lit({ retries: 3 }) })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });

  it('function default (non-autoincrement)', () => {
    const tableName = 'sessions';

    const spec: SqliteTableSpec = {
      columns: [
        {
          name: 'created_at',
          typeSql: 'TEXT',
          defaultSql: "DEFAULT (datetime('now'))",
          nullable: true,
        },
      ],
    };
    const columns = [col('created_at', 'TEXT', { default: fn("datetime('now')") })];

    expect(newPathSql(tableName, columns)).toBe(oracleSql(tableName, spec));
  });
});
