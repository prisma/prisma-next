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

  it('renders each column default shape', () => {
    const ast = new SqliteCreateTable({
      table: 'defaults',
      columns: [
        { name: 'a', type: 'TEXT', default: { kind: 'literal', value: 'x' } },
        { name: 'b', type: 'INTEGER', default: { kind: 'literal', value: 7 } },
        { name: 'c', type: 'INTEGER', default: { kind: 'literal', value: true } },
        { name: 'd', type: 'TEXT', default: { kind: 'literal', value: null } },
        { name: 'e', type: 'TEXT', default: { kind: 'function', expression: "datetime('now')" } },
        {
          name: 'g',
          type: 'INTEGER',
          default: { kind: 'function', expression: 'autoincrement()' },
        },
      ],
    });

    const adapter = createSqliteAdapter();
    const lowered = adapter.lower(ast, { contract: {} as SqliteContract });

    expect(lowered.sql).toContain("a TEXT DEFAULT 'x'");
    expect(lowered.sql).toContain('b INTEGER DEFAULT 7');
    expect(lowered.sql).toContain('c INTEGER DEFAULT true');
    expect(lowered.sql).toContain('d TEXT DEFAULT NULL');
    expect(lowered.sql).toContain("e TEXT DEFAULT (datetime('now'))");
    expect(lowered.sql).toContain('g INTEGER');
    expect(lowered.sql).not.toContain('autoincrement');
  });
});
