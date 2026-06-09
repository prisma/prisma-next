import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter();
const ctx = { contract: {} as SqliteContract };

describe('SqliteControlAdapter.lowerToDriverStatement — DDL literal defaults', () => {
  it('inlines a string default with single-quoting (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit('hello') })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"name" TEXT DEFAULT 'hello'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a Date default as ISO string (no cast suffix)', async () => {
    const date = new Date('2025-06-01T00:00:00.000Z');
    const ast = new SqliteCreateTable({
      table: 'events',
      columns: [col('created_at', 'TEXT', { default: lit(date) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"created_at" TEXT DEFAULT '2025-06-01T00:00:00.000Z'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a bigint-equivalent number default as a bare integer string', async () => {
    const ast = new SqliteCreateTable({
      table: 'counters',
      columns: [col('n', 'INTEGER', { default: lit(9007199254740991) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"n" INTEGER DEFAULT 9007199254740991');
    expect(result.params).toEqual([]);
  });

  it('inlines boolean true as 1 and false as 0', async () => {
    const ast = new SqliteCreateTable({
      table: 'flags',
      columns: [
        col('active', 'INTEGER', { default: lit(true) }),
        col('disabled', 'INTEGER', { default: lit(false) }),
      ],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"active" INTEGER DEFAULT 1');
    expect(result.sql).toContain('"disabled" INTEGER DEFAULT 0');
    expect(result.params).toEqual([]);
  });

  it('inlines a JSON-object default as single-quoted JSON (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('meta', 'TEXT', { default: lit({ key: 'val' }) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"meta" TEXT DEFAULT '{"key":"val"}'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a null default as DEFAULT NULL', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('opt', 'TEXT', { default: lit(null) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"opt" TEXT DEFAULT NULL');
    expect(result.params).toEqual([]);
  });

  it('preserves a function default expression unchanged', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [
        col('ts', 'TEXT', { default: fn("datetime('now')") }),
        col('id', 'INTEGER', { default: fn('autoincrement()') }),
      ],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"ts" TEXT DEFAULT (datetime('now'))`);
    expect(result.sql).toContain('"id" INTEGER');
    expect(result.sql).not.toContain('autoincrement');
    expect(result.params).toEqual([]);
  });

  it('escapes single quotes in string defaults', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit("O'Brien") })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"name" TEXT DEFAULT 'O''Brien'`);
    expect(result.params).toEqual([]);
  });
});

describe('SqliteControlAdapter.lower output is unchanged after D1', () => {
  it('produces the same SQL as before for a CREATE TABLE with literal defaults', () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'TEXT', { default: lit('x') }),
        col('b', 'INTEGER', { default: lit(7) }),
        col('c', 'INTEGER', { default: lit(true) }),
        col('d', 'TEXT', { default: lit(null) }),
        col('e', 'TEXT', { default: fn("datetime('now')") }),
      ],
    });
    const lowered = adapter.lower(ast, ctx);
    expect(lowered.sql).toContain(`"a" TEXT DEFAULT 'x'`);
    expect(lowered.sql).toContain('"b" INTEGER DEFAULT 7');
    expect(lowered.sql).toContain('"c" INTEGER DEFAULT 1');
    expect(lowered.sql).toContain('"d" TEXT DEFAULT NULL');
    expect(lowered.sql).toContain(`"e" TEXT DEFAULT (datetime('now'))`);
    expect(lowered.params).toEqual([]);
  });
});
