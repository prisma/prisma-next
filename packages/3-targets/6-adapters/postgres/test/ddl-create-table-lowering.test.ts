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
      'create table if not exists prisma_contract.marker (\n    space text not null primary key,\n    core_hash text not null\n  )',
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

    expect(lowered.sql).toContain("a text default 'x'");
    expect(lowered.sql).toContain('b int default 7');
    expect(lowered.sql).toContain('c boolean default true');
    expect(lowered.sql).toContain('d text default null');
    expect(lowered.sql).toContain('e timestamptz default now()');
    expect(lowered.sql).toContain('f uuid default (gen_random_uuid())');
    expect(lowered.sql).toContain('g bigserial');
    expect(lowered.sql).not.toContain('autoincrement');
  });
});
