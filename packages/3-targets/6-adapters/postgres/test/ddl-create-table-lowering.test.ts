import { col, fn, lit } from '@prisma-next/sql-relational-core/contract-free';
import { PostgresCreateTable } from '@prisma-next/target-postgres/ddl';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

describe('PostgresCreateTable DDL lowering', () => {
  it('renders IF NOT EXISTS on schema-qualified create table', () => {
    const ast = new PostgresCreateTable({
      schema: 'prisma_contract',
      table: 'marker',
      ifNotExists: true,
      columns: [
        col('space', 'text', { notNull: true, primaryKey: true }),
        col('core_hash', 'text', { notNull: true }),
      ],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE IF NOT EXISTS "prisma_contract"."marker" (\n  "space" text NOT NULL PRIMARY KEY,\n  "core_hash" text NOT NULL\n)',
    );
    expect(lowered.params).toEqual([]);
  });

  it('renders each column default shape', () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [
        col('a', 'text', { default: lit('x') }),
        col('b', 'int', { default: lit(7) }),
        col('c', 'boolean', { default: lit(true) }),
        col('d', 'text', { default: lit(null) }),
        col('e', 'timestamptz', { default: fn('now()') }),
        col('f', 'uuid', { default: fn('gen_random_uuid()') }),
        col('g', 'bigserial', { default: fn('autoincrement()') }),
      ],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"a" text DEFAULT 'x'`);
    expect(lowered.sql).toContain('"b" int DEFAULT 7');
    expect(lowered.sql).toContain('"c" boolean DEFAULT true');
    expect(lowered.sql).toContain('"d" text DEFAULT NULL');
    expect(lowered.sql).toContain('"e" timestamptz DEFAULT (now())');
    expect(lowered.sql).toContain('"f" uuid DEFAULT (gen_random_uuid())');
    expect(lowered.sql).toContain('"g" bigserial');
    expect(lowered.sql).not.toContain('autoincrement');
  });

  it('escapes single quotes in string-literal defaults', () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('name', 'text', { default: lit("O'Reilly") })],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"name" text DEFAULT 'O''Reilly'`);
  });

  it('escapes single quotes in JSON-object literal defaults on jsonb columns and adds the ::jsonb cast', () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('meta', 'jsonb', { default: lit({ a: "x'y" }) })],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT '{"a":"x''y"}'::jsonb`);
  });

  // TML-2861: the renderer must emit `::jsonb` / `::json` casts on JSON
  // literal defaults so the emitted DDL matches the column type without
  // relying on Postgres's implicit text → jsonb coercion at
  // default-evaluation time. Matches the pre-#751 planner-side
  // `renderDefaultLiteral` behaviour. The visitor takes a
  // `DdlColumnRenderContext` carrying the parent column's nativeType so
  // the literal renderer can decide; non-JSON column types stay
  // cast-free.
  it('emits ::jsonb cast on jsonb-column literal defaults (TML-2861)', () => {
    const ast = new PostgresCreateTable({
      table: 'casts',
      columns: [col('meta', 'jsonb', { default: lit({ key: 'default' }) })],
    });
    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT '{"key":"default"}'::jsonb`);
  });

  it('emits ::json cast on json-column literal defaults (TML-2861)', () => {
    const ast = new PostgresCreateTable({
      table: 'casts',
      columns: [col('payload', 'json', { default: lit({ a: 1 }) })],
    });
    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(`"payload" json DEFAULT '{"a":1}'::json`);
  });

  it('does NOT add a cast on non-JSON column types — only jsonb/json get the cast (TML-2861)', () => {
    const ast = new PostgresCreateTable({
      table: 'no_cast',
      columns: [
        // text/int/bool/null stay cast-free
        col('a_text', 'text', { default: lit('hello') }),
        col('a_int', 'int', { default: lit(42) }),
        col('a_bool', 'boolean', { default: lit(true) }),
        col('a_null', 'text', { default: lit(null) }),
        // an array-shaped value on a non-JSON column also stays
        // cast-free — the renderer keys off the column's nativeType,
        // not the value shape; if the user picked a non-JSON column
        // type, that's the type they get.
        col('a_array_on_text', 'text', { default: lit([1, 2, 3]) }),
      ],
    });
    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).not.toContain('::jsonb');
    expect(lowered.sql).not.toContain('::json');
    expect(lowered.sql).toContain(`"a_text" text DEFAULT 'hello'`);
    expect(lowered.sql).toContain('"a_int" int DEFAULT 42');
    expect(lowered.sql).toContain('"a_bool" boolean DEFAULT true');
    expect(lowered.sql).toContain('"a_null" text DEFAULT NULL');
    expect(lowered.sql).toContain(`"a_array_on_text" text DEFAULT '[1,2,3]'`);
  });

  it('does NOT add a cast on jsonb-column FUNCTION defaults — only literal defaults get the cast (TML-2861)', () => {
    // `DEFAULT (jsonb_build_object(...))` already returns a jsonb value;
    // the cast is only relevant for string-shaped JSON literals.
    const ast = new PostgresCreateTable({
      table: 'fn_default',
      columns: [col('meta', 'jsonb', { default: fn(`jsonb_build_object('k', 1)`) })],
    });
    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });
    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT (jsonb_build_object('k', 1))`);
    expect(lowered.sql).not.toContain('::jsonb');
  });
});
