import { DdlColumn, LiteralColumnDefault } from '@prisma-next/sql-relational-core/ast';
import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../src/core/adapter';
import { renderLoweredDdl } from '../src/core/ddl-renderer';
import type { SqliteContract } from '../src/core/types';

// bigint is excluded from ColumnDefaultLiteralInputValue, so it cannot be
// constructed through lit(). Bypass the constructor validation to exercise
// the renderer's defensive branch directly.
function bigintLiteralDefault(value: bigint): LiteralColumnDefault {
  const instance = Object.create(LiteralColumnDefault.prototype) as LiteralColumnDefault;
  // Cast needed to assign bigint where ColumnDefaultLiteralInputValue is expected;
  // test files are exempt from the no-bare-cast rule.
  Object.assign(instance, { kind: 'literal', value: value as unknown as number });
  return instance;
}

describe('SqliteCreateTable DDL lowering', () => {
  it('renders IF NOT EXISTS with quoted-style column casing', () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: [col('space', 'TEXT', { notNull: true, primaryKey: true })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE IF NOT EXISTS "_prisma_marker" (\n  "space" TEXT NOT NULL PRIMARY KEY\n)',
    );
    expect(lowered.params).toEqual([]);
  });

  it('renders each column default shape', () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'TEXT', { default: lit('x') }),
        col('b', 'INTEGER', { default: lit(7) }),
        col('c', 'INTEGER', { default: lit(true) }),
        col('d', 'TEXT', { default: lit(null) }),
        col('e', 'TEXT', { default: fn("datetime('now')") }),
        col('g', 'INTEGER', { default: fn('autoincrement()') }),
      ],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain('"a" TEXT DEFAULT \'x\'');
    expect(lowered.sql).toContain('"b" INTEGER DEFAULT 7');
    expect(lowered.sql).toContain('"c" INTEGER DEFAULT 1');
    expect(lowered.sql).toContain('"d" TEXT DEFAULT NULL');
    expect(lowered.sql).toContain('"e" TEXT DEFAULT (datetime(\'now\'))');
    expect(lowered.sql).toContain('"g" INTEGER');
    expect(lowered.sql).not.toContain('autoincrement');
  });

  it('escapes single quotes in string-literal defaults', () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [col('name', 'TEXT', { default: lit("O'Reilly") })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain("\"name\" TEXT DEFAULT 'O''Reilly'");
  });

  it('renders a Date literal default as a single-quoted ISO string', () => {
    const date = new Date('2025-03-15T12:00:00.000Z');
    const ast = new SqliteCreateTable({
      table: 'events',
      columns: [col('created_at', 'TEXT', { default: lit(date) })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain('"created_at" TEXT DEFAULT \'2025-03-15T12:00:00.000Z\'');
  });

  it('renders a boolean false literal default as 0', () => {
    const ast = new SqliteCreateTable({
      table: 'flags',
      columns: [col('active', 'INTEGER', { default: lit(false) })],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain('"active" INTEGER DEFAULT 0');
  });

  it('renders a bigint literal default as a bare integer string (defensive path)', () => {
    // bigint is not in ColumnDefaultLiteralInputValue, so it cannot be
    // constructed through lit(). Bypass the constructor validation to
    // exercise the renderer's defensive branch directly.
    const bigDefault = bigintLiteralDefault(9007199254740993n);
    const column = new DdlColumn({ name: 'big', type: 'INTEGER', default: bigDefault });
    const ast = new SqliteCreateTable({ table: 'nums', columns: [column] });
    const lowered = renderLoweredDdl(ast);

    expect(lowered.sql).toContain('"big" INTEGER DEFAULT 9007199254740993');
  });
});
