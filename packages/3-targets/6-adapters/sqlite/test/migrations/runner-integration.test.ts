import { DatabaseSync } from 'node:sqlite';
import { type Contract, coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlStorage, StorageColumn, StorageTable } from '@prisma-next/sql-contract/types';
// `createSqliteMigrationPlanner` is target-side; reach into the target source
// directly rather than through a `target-sqlite` subpath export — this test is
// integration-flavoured (full target↔adapter↔driver wiring) and lives here
// because the adapter is the package that pulls everything together.
import { createSqliteMigrationPlanner } from '@prisma-next/target-sqlite/planner';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    db,
  };
}

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

function makeContract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('sha256:test'),
    storage: {
      tables,
      storageHash: coreHash(`sha256:test-${Date.now()}`),
    },
    roots: {},
    models: {},
    capabilities: {},
    extensionPacks: {},
    meta: {},
  };
}

const emptySchema = { tables: {}, dependencies: [] };

describe('SQLite migration planner', () => {
  const planner = createSqliteMigrationPlanner();

  it('plans CREATE TABLE for new table', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    expect(ops.length).toBeGreaterThanOrEqual(1);
    const tableOp = ops.find((op) => op.id === 'table.users');
    expect(tableOp).toBeDefined();
    expect(tableOp!.execute[0]!.sql).toContain('CREATE TABLE');
    expect(tableOp!.execute[0]!.sql).toContain('"users"');
  });

  it('plans ADD COLUMN for existing table', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          name: makeColumn({ nativeType: 'text', nullable: false }),
          bio: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const existingSchema = {
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'integer', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      dependencies: [],
    };

    const result = planner.plan({
      contract,
      schema: existingSchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    const colOp = ops.find((op) => op.id === 'column.users.bio');
    expect(colOp).toBeDefined();
    expect(colOp!.execute[0]!.sql).toContain('ADD COLUMN "bio"');
  });

  it('plans CREATE INDEX', () => {
    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          email: makeColumn({ nativeType: 'text', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
        indexes: [{ columns: ['email'], name: 'idx_users_email' }],
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;
    const ops = result.plan.operations;
    const indexOp = ops.find((op) => op.id === 'index.users.idx_users_email');
    expect(indexOp).toBeDefined();
    expect(indexOp!.execute[0]!.sql).toContain('CREATE INDEX');
  });

  it('fails without additive policy', () => {
    const contract = makeContract({});
    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: [] },
      frameworkComponents: [],
    });
    expect(result.kind).toBe('failure');
  });
});

describe('SQLite planner + introspection round-trip', () => {
  it('executes planned DDL and verifies via introspection', async () => {
    const driver = createMemoryDriver();
    const adapter = new SqliteControlAdapter();
    const planner = createSqliteMigrationPlanner();

    const contract = makeContract({
      users: makeTable({
        columns: {
          id: makeColumn({
            nativeType: 'integer',
            nullable: false,
            default: { kind: 'function', expression: 'autoincrement()' },
          }),
          email: makeColumn({ nativeType: 'text', nullable: false }),
          active: makeColumn({
            nativeType: 'integer',
            nullable: false,
            default: { kind: 'literal', value: 1 },
          }),
        },
        primaryKey: { columns: ['id'] },
        indexes: [{ columns: ['email'], name: 'idx_users_email' }],
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Execute all operations
    for (const op of result.plan.operations) {
      for (const step of op.execute) {
        await driver.query(step.sql);
      }
    }

    // Introspect and verify
    const schema = await adapter.introspect(driver);
    expect(schema.tables['users']).toBeDefined();
    expect(schema.tables['users']!.columns['id']).toBeDefined();
    expect(schema.tables['users']!.columns['email']).toBeDefined();
    expect(schema.tables['users']!.columns['active']).toBeDefined();
    expect(schema.tables['users']!.primaryKey).toEqual({ columns: ['id'] });

    const idx = schema.tables['users']!.indexes.find((i) => i.name === 'idx_users_email');
    expect(idx).toBeDefined();
    expect(idx!.columns).toEqual(['email']);

    // Verify actual data round-trip works
    await driver.query('INSERT INTO users (email, active) VALUES (?, ?)', ['test@example.com', 1]);
    const rows = await driver.query<{ id: number; email: string; active: number }>(
      'SELECT * FROM users',
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.id).toBe(1);
    expect(rows.rows[0]!.email).toBe('test@example.com');

    await driver.close();
  });

  it('handles AUTOINCREMENT with INTEGER PRIMARY KEY', async () => {
    const driver = createMemoryDriver();
    const planner = createSqliteMigrationPlanner();

    const contract = makeContract({
      items: makeTable({
        columns: {
          id: makeColumn({
            nativeType: 'integer',
            nullable: false,
            default: { kind: 'function', expression: 'autoincrement()' },
          }),
          value: makeColumn({ nativeType: 'text', nullable: true }),
        },
        primaryKey: { columns: ['id'] },
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    for (const op of result.plan.operations) {
      for (const step of op.execute) {
        await driver.query(step.sql);
      }
    }

    // Insert without specifying id
    await driver.query('INSERT INTO items (value) VALUES (?)', ['first']);
    await driver.query('INSERT INTO items (value) VALUES (?)', ['second']);
    const rows = await driver.query<{ id: number; value: string }>(
      'SELECT * FROM items ORDER BY id',
    );
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0]!.id).toBe(1);
    expect(rows.rows[1]!.id).toBe(2);

    await driver.close();
  });

  it('handles foreign key constraints in CREATE TABLE', async () => {
    const driver = createMemoryDriver();
    const planner = createSqliteMigrationPlanner();

    const contract = makeContract({
      authors: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
      }),
      posts: makeTable({
        columns: {
          id: makeColumn({ nativeType: 'integer', nullable: false }),
          author_id: makeColumn({ nativeType: 'integer', nullable: false }),
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [
          {
            columns: ['author_id'],
            references: { table: 'authors', columns: ['id'] },
            onDelete: 'cascade',
            constraint: true,
            index: true,
          },
        ],
      }),
    });

    const result = planner.plan({
      contract,
      schema: emptySchema,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
    });

    expect(result.kind).toBe('success');
    if (result.kind !== 'success') return;

    // Execute all operations (tables are sorted, authors comes first)
    for (const op of result.plan.operations) {
      for (const step of op.execute) {
        await driver.query(step.sql);
      }
    }

    // FK should be enforced
    await driver.query('INSERT INTO authors (id) VALUES (?)', [1]);
    await driver.query('INSERT INTO posts (id, author_id) VALUES (?, ?)', [1, 1]);

    // Cascade delete
    await driver.query('DELETE FROM authors WHERE id = ?', [1]);
    const remaining = await driver.query('SELECT * FROM posts');
    expect(remaining.rows).toHaveLength(0);

    await driver.close();
  });
});
