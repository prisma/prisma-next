import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../src/core/control-adapter';
import type { SqliteContract } from '../src/core/types';

const adapter = new SqliteControlAdapter();
const ctx = { contract: {} as SqliteContract };

/**
 * A codec whose `encode` transforms its input. The raw value never appears
 * in correct output, so this distinguishes codec routing (walker calls
 * `encode`, inlines the wire result) from the type-branching fallback.
 */
const transformingCodec = {
  id: 'test/transform@1',
  encode: async (value: unknown) => `ENC:${String(value).toUpperCase()}`,
  decode: async (wire: unknown) => wire,
} as unknown as Codec;

const transformingLookup: CodecLookup = {
  ...emptyCodecLookup,
  get: (id) => (id === 'test/transform@1' ? transformingCodec : undefined),
};

describe('SqliteControlAdapter.lowerToExecuteRequest — DDL literal defaults', () => {
  it('inlines a string default with single-quoting (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit('hello') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
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
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"created_at" TEXT DEFAULT '2025-06-01T00:00:00.000Z'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a bigint-equivalent number default as a bare integer string', async () => {
    const ast = new SqliteCreateTable({
      table: 'counters',
      columns: [col('n', 'INTEGER', { default: lit(9007199254740991) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
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
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain('"active" INTEGER DEFAULT 1');
    expect(result.sql).toContain('"disabled" INTEGER DEFAULT 0');
    expect(result.params).toEqual([]);
  });

  it('inlines a JSON-object default as single-quoted JSON (no cast suffix)', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('meta', 'TEXT', { default: lit({ key: 'val' }) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"meta" TEXT DEFAULT '{"key":"val"}'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a null default as DEFAULT NULL', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('opt', 'TEXT', { default: lit(null) })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
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
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"ts" TEXT DEFAULT (datetime('now'))`);
    expect(result.sql).toContain('"id" INTEGER');
    expect(result.sql).not.toContain('autoincrement');
  });

  it("maps the canonical now() function default to SQLite's datetime('now')", async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('created_at', 'TEXT', { default: fn('now()') })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    // SQLite has no now(); the contract canonicalizes CURRENT_TIMESTAMP to
    // now(), which must map back to a valid SQLite expression at apply time.
    expect(result.sql).toContain(`"created_at" TEXT DEFAULT (datetime('now'))`);
    expect(result.sql).not.toContain('(now())');
    expect(result.params).toEqual([]);
  });

  it('escapes single quotes in string defaults', async () => {
    const ast = new SqliteCreateTable({
      table: 't',
      columns: [col('name', 'TEXT', { default: lit("O'Brien") })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`"name" TEXT DEFAULT 'O''Brien'`);
    expect(result.params).toEqual([]);
  });
});

describe('SqliteControlAdapter.lowerToExecuteRequest — guards', () => {
  it('throws when a numeric literal default is non-finite (NaN / ±Infinity)', async () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const ast = new SqliteCreateTable({
        table: 'defaults',
        columns: [col('x', 'INTEGER', { default: lit(value) })],
      });
      await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(
        /non-finite number wire value/,
      );
    }
  });

  it('throws when a Date literal default is invalid', async () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [col('x', 'TEXT', { default: lit(new Date('not-a-date')) })],
    });
    await expect(adapter.lowerToExecuteRequest(ast, ctx)).rejects.toThrow(/invalid Date/);
  });
});

describe('SqliteControlAdapter.lowerToExecuteRequest — codec routing + DDL shape', () => {
  it('routes a codec-bearing literal default through codec.encode (not raw type-branching)', async () => {
    const codecAdapter = new SqliteControlAdapter(transformingLookup);
    const ast = new SqliteCreateTable({
      table: 'secrets',
      columns: [
        col('token', 'TEXT', {
          default: lit('plaintext'),
          codecRef: { codecId: 'test/transform@1' },
        }),
      ],
    });
    const result = await codecAdapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toContain(`DEFAULT 'ENC:PLAINTEXT'`);
    expect(result.sql).not.toContain('plaintext');
  });

  it('renders IF NOT EXISTS with quoted identifiers (bootstrap control-table shape)', async () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: [col('space', 'TEXT', { notNull: true, primaryKey: true })],
    });
    const result = await adapter.lowerToExecuteRequest(ast, ctx);
    expect(result.sql).toBe(
      'CREATE TABLE IF NOT EXISTS "_prisma_marker" (\n  "space" TEXT NOT NULL PRIMARY KEY\n)',
    );
    expect(result.params).toEqual([]);
  });
});
