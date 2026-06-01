import { CreateTable } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

describe('CreateTable DDL lowering', () => {
  it('renders schema-qualified CREATE TABLE with quoted identifiers', () => {
    const ast = new CreateTable({
      schema: 'prisma_contract',
      table: 'marker',
      columns: [
        { name: 'space', type: 'text', notNull: true, primaryKey: true },
        { name: 'core_hash', type: 'text', notNull: true },
      ],
    });

    const adapter = createPostgresAdapter();
    const lowered = adapter.lower(ast, { contract: {} as PostgresContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE "prisma_contract"."marker" ("space" text NOT NULL PRIMARY KEY, "core_hash" text NOT NULL)',
    );
    expect(lowered.params).toEqual([]);
  });
});
