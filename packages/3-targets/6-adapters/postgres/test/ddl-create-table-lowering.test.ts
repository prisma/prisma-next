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
});
