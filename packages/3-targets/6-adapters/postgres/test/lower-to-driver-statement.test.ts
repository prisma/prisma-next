import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { PostgresCreateTable } from '@prisma-next/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';
import type { PostgresContract } from '../src/core/types';

const adapter = new PostgresControlAdapter();
const ctx = { contract: {} as PostgresContract };

describe('PostgresControlAdapter.lowerToDriverStatement — DDL literal defaults', () => {
  it('inlines a string default with single-quoting and ::nativeType cast on non-text columns', async () => {
    const ast = new PostgresCreateTable({
      table: 'events',
      columns: [col('status', 'my_enum', { default: lit('active') })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"status" my_enum DEFAULT 'active'::my_enum`);
    expect(result.params).toEqual([]);
  });

  it('inlines a string default without cast on text columns', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('note', 'text', { default: lit('hello') })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"note" text DEFAULT 'hello'`);
    expect(result.sql).not.toContain('::');
    expect(result.params).toEqual([]);
  });

  it('inlines a Date default as ISO string with ::nativeType cast', async () => {
    const date = new Date('2025-06-01T00:00:00.000Z');
    const ast = new PostgresCreateTable({
      table: 'events',
      columns: [col('created_at', 'timestamptz', { default: lit(date) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(
      `"created_at" timestamptz DEFAULT '2025-06-01T00:00:00.000Z'::timestamptz`,
    );
    expect(result.params).toEqual([]);
  });

  it('inlines a bigint default as a bare numeric string', async () => {
    // Use a large integer stored as a number (ColumnDefaultLiteralInputValue includes number)
    const ast = new PostgresCreateTable({
      table: 'counters',
      columns: [col('big', 'int8', { default: lit(9007199254740991) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"big" int8 DEFAULT 9007199254740991');
    expect(result.params).toEqual([]);
  });

  it('inlines a boolean default as bare true/false', async () => {
    const ast = new PostgresCreateTable({
      table: 'flags',
      columns: [
        col('active', 'boolean', { default: lit(true) }),
        col('disabled', 'boolean', { default: lit(false) }),
      ],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"active" boolean DEFAULT true');
    expect(result.sql).toContain('"disabled" boolean DEFAULT false');
    expect(result.params).toEqual([]);
  });

  it('inlines a JSON-object default with ::jsonb cast', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('meta', 'jsonb', { default: lit({ key: 'val' }) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"meta" jsonb DEFAULT '{"key":"val"}'::jsonb`);
    expect(result.params).toEqual([]);
  });

  it('inlines a null default as DEFAULT NULL', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('opt', 'uuid', { default: lit(null) })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"opt" uuid DEFAULT NULL');
    expect(result.params).toEqual([]);
  });

  it('preserves a function default expression unchanged', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [
        col('id', 'uuid', { default: fn('gen_random_uuid()') }),
        col('ts', 'timestamptz', { default: fn('now()') }),
      ],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain('"id" uuid DEFAULT (gen_random_uuid())');
    expect(result.sql).toContain('"ts" timestamptz DEFAULT (now())');
    expect(result.params).toEqual([]);
  });

  it('escapes single quotes in string defaults', async () => {
    const ast = new PostgresCreateTable({
      table: 't',
      columns: [col('name', 'text', { default: lit("O'Brien") })],
    });
    const result = await adapter.lowerToDriverStatement(ast, ctx);
    expect(result.sql).toContain(`"name" text DEFAULT 'O''Brien'`);
    expect(result.params).toEqual([]);
  });
});

describe('PostgresControlAdapter.lower output is unchanged after D1', () => {
  it('produces the same SQL as before for a CREATE TABLE with literal defaults', () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'text', { default: lit('x') }),
        col('b', 'int', { default: lit(7) }),
        col('c', 'boolean', { default: lit(true) }),
        col('d', 'text', { default: lit(null) }),
        col('e', 'timestamptz', { default: fn('now()') }),
        col('f', 'uuid', { default: fn('gen_random_uuid()') }),
      ],
    });
    const lowered = adapter.lower(ast, ctx);
    expect(lowered.sql).toContain(`"a" text DEFAULT 'x'`);
    expect(lowered.sql).toContain('"b" int DEFAULT 7');
    expect(lowered.sql).toContain('"c" boolean DEFAULT true');
    expect(lowered.sql).toContain('"d" text DEFAULT NULL');
    expect(lowered.sql).toContain('"e" timestamptz DEFAULT (now())');
    expect(lowered.sql).toContain('"f" uuid DEFAULT (gen_random_uuid())');
    expect(lowered.params).toEqual([]);
  });
});
