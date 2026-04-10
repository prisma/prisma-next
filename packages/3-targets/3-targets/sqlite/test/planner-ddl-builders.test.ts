import type { StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  buildAddColumnSql,
  buildColumnDefaultSql,
  buildColumnTypeSql,
  buildCreateIndexSql,
  buildCreateTableSql,
  buildDropIndexSql,
  buildRenameColumnSql,
  renderDefaultLiteral,
} from '../src/core/migrations/planner-ddl-builders';

const emptyCodecHooks = new Map();
const emptyStorageTypes = {};

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  } as StorageColumn;
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    primaryKey: undefined,
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  } as unknown as StorageTable;
}

describe('buildCreateTableSql', () => {
  it('generates CREATE TABLE with columns', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({ nativeType: 'integer', nullable: false }),
        name: makeColumn({ nativeType: 'text', nullable: false }),
        bio: makeColumn({ nativeType: 'text', nullable: true }),
      },
      primaryKey: { columns: ['id'] },
    });
    const sql = buildCreateTableSql('users', table, emptyCodecHooks, emptyStorageTypes);
    expect(sql).toContain('CREATE TABLE "users"');
    expect(sql).toContain('"id" INTEGER');
    expect(sql).toContain('"name" TEXT NOT NULL');
    expect(sql).toContain('"bio" TEXT');
    expect(sql).toContain('PRIMARY KEY ("id")');
  });

  it('generates INTEGER PRIMARY KEY AUTOINCREMENT for autoincrement column', () => {
    const table = makeTable({
      columns: {
        id: makeColumn({
          nativeType: 'integer',
          nullable: false,
          default: { kind: 'function', expression: 'autoincrement()' },
        }),
      },
      primaryKey: { columns: ['id'] },
    });
    const sql = buildCreateTableSql('t', table, emptyCodecHooks, emptyStorageTypes);
    expect(sql).toContain('"id" INTEGER PRIMARY KEY AUTOINCREMENT');
    // Should NOT have a separate PRIMARY KEY constraint
    expect(sql).not.toMatch(/PRIMARY KEY \("id"\)/);
  });

  it('includes inline UNIQUE constraints', () => {
    const table = makeTable({
      columns: {
        email: makeColumn({ nativeType: 'text', nullable: false }),
      },
      uniques: [{ columns: ['email'], name: 'uq_email' }],
    });
    const sql = buildCreateTableSql('users', table, emptyCodecHooks, emptyStorageTypes);
    expect(sql).toContain('CONSTRAINT "uq_email" UNIQUE ("email")');
  });

  it('includes inline FOREIGN KEY constraints', () => {
    const table = makeTable({
      columns: {
        author_id: makeColumn({ nativeType: 'integer', nullable: false }),
      },
      foreignKeys: [
        {
          columns: ['author_id'],
          references: { table: 'authors', columns: ['id'] },
          onDelete: 'cascade',
          constraint: true,
          index: true,
        },
      ],
    });
    const sql = buildCreateTableSql('posts', table, emptyCodecHooks, emptyStorageTypes);
    expect(sql).toContain(
      'FOREIGN KEY ("author_id") REFERENCES "authors" ("id") ON DELETE CASCADE',
    );
  });
});

describe('buildColumnTypeSql', () => {
  it('uppercases native type', () => {
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'text' }), emptyCodecHooks)).toBe('TEXT');
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'integer' }), emptyCodecHooks)).toBe(
      'INTEGER',
    );
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'real' }), emptyCodecHooks)).toBe('REAL');
    expect(buildColumnTypeSql(makeColumn({ nativeType: 'blob' }), emptyCodecHooks)).toBe('BLOB');
  });
});

describe('buildColumnDefaultSql', () => {
  it('returns empty for no default', () => {
    expect(buildColumnDefaultSql(undefined)).toBe('');
  });

  it('renders literal string default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 'hello' })).toBe("DEFAULT 'hello'");
  });

  it('renders literal number default', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: 42 })).toBe('DEFAULT 42');
  });

  it('renders literal boolean as 0/1', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: true })).toBe('DEFAULT 1');
    expect(buildColumnDefaultSql({ kind: 'literal', value: false })).toBe('DEFAULT 0');
  });

  it('renders NULL literal', () => {
    expect(buildColumnDefaultSql({ kind: 'literal', value: null })).toBe('DEFAULT NULL');
  });

  it("renders now() as datetime('now')", () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'now()' })).toBe(
      "DEFAULT (datetime('now'))",
    );
  });

  it('returns empty for autoincrement()', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'autoincrement()' })).toBe('');
  });

  it('renders custom function default', () => {
    expect(buildColumnDefaultSql({ kind: 'function', expression: 'random()' })).toBe(
      'DEFAULT (random())',
    );
  });
});

describe('renderDefaultLiteral', () => {
  it('renders Date as ISO8601 string', () => {
    const d = new Date('2024-01-15T10:30:00.000Z');
    expect(renderDefaultLiteral(d)).toBe("'2024-01-15T10:30:00.000Z'");
  });

  it('renders JSON objects', () => {
    expect(renderDefaultLiteral({ key: 'val' })).toBe('\'{"key":"val"}\'');
  });
});

describe('buildAddColumnSql', () => {
  it('generates ALTER TABLE ADD COLUMN', () => {
    const sql = buildAddColumnSql(
      'users',
      'age',
      makeColumn({ nativeType: 'integer', nullable: true }),
      emptyCodecHooks,
    );
    expect(sql).toBe('ALTER TABLE "users" ADD COLUMN "age" INTEGER');
  });

  it('includes NOT NULL', () => {
    const sql = buildAddColumnSql(
      'users',
      'name',
      makeColumn({ nativeType: 'text', nullable: false }),
      emptyCodecHooks,
    );
    expect(sql).toContain('NOT NULL');
  });

  it('includes default', () => {
    const sql = buildAddColumnSql(
      'users',
      'role',
      makeColumn({
        nativeType: 'text',
        nullable: false,
        default: { kind: 'literal', value: 'user' },
      }),
      emptyCodecHooks,
    );
    expect(sql).toContain("DEFAULT 'user'");
    expect(sql).toContain('NOT NULL');
  });
});

describe('buildRenameColumnSql', () => {
  it('generates ALTER TABLE RENAME COLUMN', () => {
    expect(buildRenameColumnSql('users', 'old_name', 'new_name')).toBe(
      'ALTER TABLE "users" RENAME COLUMN "old_name" TO "new_name"',
    );
  });
});

describe('buildCreateIndexSql', () => {
  it('generates CREATE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'])).toBe(
      'CREATE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('generates CREATE UNIQUE INDEX', () => {
    expect(buildCreateIndexSql('users', 'idx_users_email', ['email'], true)).toBe(
      'CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email")',
    );
  });

  it('handles multi-column index', () => {
    expect(buildCreateIndexSql('t', 'idx_t_a_b', ['a', 'b'])).toBe(
      'CREATE INDEX "idx_t_a_b" ON "t" ("a", "b")',
    );
  });
});

describe('buildDropIndexSql', () => {
  it('generates DROP INDEX IF EXISTS', () => {
    expect(buildDropIndexSql('idx_users_email')).toBe('DROP INDEX IF EXISTS "idx_users_email"');
  });
});
