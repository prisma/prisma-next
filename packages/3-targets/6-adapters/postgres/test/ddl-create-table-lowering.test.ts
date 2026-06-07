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

  it('escapes single quotes in JSON-object literal defaults', () => {
    const ast = new PostgresCreateTable({
      table: 'defaults',
      columns: [col('meta', 'jsonb', { default: lit({ a: "x'y" }) })],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toContain(`"meta" jsonb DEFAULT '{"a":"x''y"}'`);
  });
});
