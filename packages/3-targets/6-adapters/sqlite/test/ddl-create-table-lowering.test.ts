import { SqliteCreateTable } from '@prisma-next/target-sqlite/ddl';
import { describe, expect, it } from 'vitest';
import { createSqliteAdapter } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

describe('SqliteCreateTable DDL lowering', () => {
  it('renders IF NOT EXISTS with quoted-style column casing', () => {
    const ast = new SqliteCreateTable({
      table: '_prisma_marker',
      ifNotExists: true,
      columns: [{ name: 'space', type: 'TEXT', notNull: true, primaryKey: true }],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toBe(
      'CREATE TABLE IF NOT EXISTS _prisma_marker (\n    space TEXT NOT NULL PRIMARY KEY\n  )',
    );
    expect(lowered.params).toEqual([]);
  });
});
