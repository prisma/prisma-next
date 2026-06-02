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
        { name: 'space', type: 'text', notNull: true, primaryKey: true },
        { name: 'core_hash', type: 'text', notNull: true },
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
        { name: 'a', type: 'text', default: { kind: 'literal', value: 'x' } },
        { name: 'b', type: 'int', default: { kind: 'literal', value: 7 } },
        { name: 'c', type: 'boolean', default: { kind: 'literal', value: true } },
        { name: 'd', type: 'text', default: { kind: 'literal', value: null } },
        { name: 'e', type: 'timestamptz', default: { kind: 'function', expression: 'now()' } },
        {
          name: 'f',
          type: 'uuid',
          default: { kind: 'function', expression: 'gen_random_uuid()' },
        },
        {
          name: 'g',
          type: 'bigserial',
          default: { kind: 'function', expression: 'autoincrement()' },
        },
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
