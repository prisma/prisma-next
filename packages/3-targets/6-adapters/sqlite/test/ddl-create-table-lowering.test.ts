import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

describe('SqliteCreateTable DDL lowering', () => {
  it('renders CREATE TABLE with quoted identifiers', () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      columns: [{ name: 'space', type: 'TEXT', notNull: true, primaryKey: true }],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toBe('CREATE TABLE "_prisma_marker" ("space" TEXT NOT NULL PRIMARY KEY)');
    expect(lowered.params).toEqual([]);
  });
});
