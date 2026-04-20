import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { integerColumn, textColumn } from '@prisma-next/adapter-sqlite/column-types';
import sqliteAdapterDescriptor, {
  normalizeSqliteNativeType,
  parseSqliteDefault,
  SqliteControlAdapter,
} from '@prisma-next/adapter-sqlite/control';
import type { Contract } from '@prisma-next/contract/types';
import sqliteDriverDescriptor from '@prisma-next/driver-sqlite/control';
import sqlFamilyDescriptor, {
  INIT_ADDITIVE_POLICY,
  type SqlMigrationRunnerFailure,
} from '@prisma-next/family-sql/control';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { verifySqlSchema } from '@prisma-next/family-sql/schema-verify';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import { createControlStack } from '@prisma-next/framework-components/control';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { defineContract, field, model } from '@prisma-next/sql-contract-ts/contract-builder';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import sqliteTargetDescriptor from '@prisma-next/target-sqlite/control';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import { describe, expect, it } from 'vitest';

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

const familyInstance = sqlFamilyDescriptor.create(
  createControlStack({
    family: sqlFamilyDescriptor,
    target: sqliteTargetDescriptor,
    adapter: sqliteAdapterDescriptor,
    driver: sqliteDriverDescriptor,
    extensionPacks: [],
  }),
);

const fw = [sqliteTargetDescriptor, sqliteAdapterDescriptor, sqliteDriverDescriptor] as const;
const pack = { family: sqlFamilyPack, target: sqlitePack } as const;
const int = field.column(integerColumn);
const text = field.column(textColumn);

type Driver = {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
};

function createTestDb() {
  const dir = mkdtempSync(join(tmpdir(), 'prisma-sqlite-mig-e2e-'));
  const db = new DatabaseSync(join(dir, 'test.db'));
  db.exec('PRAGMA foreign_keys = ON');
  const driver: Driver = {
    familyId: 'sql',
    targetId: 'sqlite',
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      return {
        rows: db.prepare(sql).all(...((params ?? []) as Array<string | number | null>)) as Row[],
      };
    },
    async close() {
      db.close();
    },
  };
  return {
    driver,
    cleanup() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Migration helper
// ---------------------------------------------------------------------------

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySchema: SqlSchemaIR = { tables: {}, dependencies: [] };

interface MigrationResult {
  readonly driver: Driver;
  readonly schema: SqlSchemaIR;
  readonly operationsExecuted: number;
}

function formatFailure(f: SqlMigrationRunnerFailure): string {
  const parts = [`[${f.code}] ${f.summary}`];
  if (f.why) parts.push(`  why: ${f.why}`);
  const issues = f.meta?.['issues'];
  if (Array.isArray(issues)) for (const i of issues) parts.push(`  - ${JSON.stringify(i)}`);
  return parts.join('\n');
}

async function applyMigration(
  options: {
    origin?: Contract<SqlStorage>;
    destination: Contract<SqlStorage>;
    policy?: MigrationOperationPolicy;
    seed?: (driver: Driver) => Promise<void>;
  },
  runAssertions: (result: MigrationResult) => Promise<void>,
): Promise<void> {
  const testDb = createTestDb();
  const { driver } = testDb;
  try {
    const planner = sqliteTargetDescriptor.createPlanner(familyInstance);
    const runner = sqliteTargetDescriptor.createRunner(familyInstance);
    const adapter = new SqliteControlAdapter();
    const policy = options.policy ?? INIT_ADDITIVE_POLICY;

    let currentSchema: SqlSchemaIR = emptySchema;
    if (options.origin) {
      const r = planner.plan({
        contract: options.origin,
        schema: emptySchema,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: fw,
      });
      if (r.kind !== 'success') throw new Error('Origin planner failed');
      const run = await runner.execute({
        plan: r.plan,
        driver,
        destinationContract: options.origin,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents: fw,
        strictVerification: false,
      });
      if (!run.ok) throw new Error(`Origin runner failed: ${formatFailure(run.failure)}`);
      currentSchema = await adapter.introspect(driver);
    }
    if (options.seed) await options.seed(driver);

    const planResult = planner.plan({
      contract: options.destination,
      schema: currentSchema,
      policy,
      frameworkComponents: fw,
    });
    if (planResult.kind !== 'success') {
      throw new Error(
        `Destination planner failed: ${planResult.conflicts?.map((cf) => cf.summary).join('; ') ?? 'unknown'}`,
      );
    }
    const runResult = await runner.execute({
      plan: planResult.plan,
      driver,
      destinationContract: options.destination,
      policy,
      frameworkComponents: fw,
      strictVerification: false,
    });
    if (!runResult.ok)
      throw new Error(`Destination runner failed: ${formatFailure(runResult.failure)}`);

    const freshSchema = await adapter.introspect(driver);
    const vr = verifySqlSchema({
      contract: options.destination,
      schema: freshSchema,
      strict: false,
      typeMetadataRegistry: familyInstance.typeMetadataRegistry,
      frameworkComponents: fw,
      normalizeDefault: parseSqliteDefault,
      normalizeNativeType: normalizeSqliteNativeType,
    });
    if (!vr.ok) {
      throw new Error(
        `Schema verification failed:\n${vr.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n')}`,
      );
    }

    // Strip _prisma_marker / _prisma_ledger so tests only see user tables
    const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
    for (const [name, tbl] of Object.entries(freshSchema.tables)) {
      if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
    }
    await runAssertions({
      driver,
      schema: { ...freshSchema, tables: userTables },
      operationsExecuted: runResult.value.operationsExecuted,
    });
  } finally {
    testDb.cleanup();
  }
}

// ---------------------------------------------------------------------------
// From empty schema
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - From empty schema', () => {
  it('creates a single table with PK and NOT NULL', async () => {
    await applyMigration(
      {
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
      },
    );
  });

  it('creates a table with INTEGER PRIMARY KEY (auto-assigned rowid)', async () => {
    await applyMigration(
      {
        destination: defineContract({
          ...pack,
          models: { Item: model('Item', { fields: { id: int.id(), value: text.optional() } }) },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Item" (value) VALUES (?)', ['first']);
        await driver.query('INSERT INTO "Item" (value) VALUES (?)', ['second']);
        const rows = await driver.query<{ id: number }>('SELECT id FROM "Item" ORDER BY id');
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]!.id).toBe(1);
        expect(rows.rows[1]!.id).toBe(2);
      },
    );
  });

  it('creates a table with default values', async () => {
    await applyMigration(
      {
        destination: defineContract({
          ...pack,
          models: {
            Setting: model('Setting', {
              fields: {
                id: int.id(),
                label: text.default('untitled'),
                priority: field.column(integerColumn).default('0'),
                isActive: field.column(integerColumn).default('1').column('is_active'),
                createdAt: text.defaultSql('now()').column('created_at'),
              },
            }),
          },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        const rows = await driver.query<{
          label: string;
          priority: number;
          is_active: number;
          created_at: string;
        }>('SELECT * FROM "Setting" WHERE id = ?', [1]);
        expect(rows.rows[0]!.label).toBe('untitled');
        expect(rows.rows[0]!.priority).toBe(0);
        expect(rows.rows[0]!.is_active).toBe(1);
        expect(rows.rows[0]!.created_at).toBeTruthy();
      },
    );
  });

  it('creates a table with unique constraints', async () => {
    await applyMigration(
      {
        destination: defineContract({
          ...pack,
          models: {
            Account: model('Account', {
              fields: { id: int.id(), email: text.unique(), username: text.unique() },
            }),
          },
        }),
      },
      async ({ schema }) => {
        const cols = schema.tables['Account']!.uniques.map((u) => [...u.columns]);
        expect(cols).toContainEqual(['email']);
        expect(cols).toContainEqual(['username']);
      },
    );
  });

  it('creates tables with FK ON DELETE CASCADE', async () => {
    const Author = model('Author', { fields: { id: int.id(), name: text } });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, authorId: int.column('author_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.authorId, ctx.constraints.ref('Author', 'id'), {
          onDelete: 'cascade',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      { destination: defineContract({ ...pack, models: { Author, Post } }) },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Author" (id, name) VALUES (?, ?)', [1, 'Alice']);
        await driver.query('INSERT INTO "Post" (id, title, author_id) VALUES (?, ?, ?)', [
          1,
          'Post 1',
          1,
        ]);
        await driver.query('DELETE FROM "Author" WHERE id = ?', [1]);
        expect((await driver.query('SELECT * FROM "Post"')).rows).toHaveLength(0);
      },
    );
  });

  it('creates tables with FK ON DELETE SET NULL', async () => {
    const Category = model('Category', { fields: { id: int.id(), name: text } });
    const Post = model('Post', {
      fields: { id: int.id(), title: text, categoryId: int.optional().column('category_id') },
    }).sql((ctx) => ({
      foreignKeys: [
        ctx.constraints.foreignKey(ctx.cols.categoryId, ctx.constraints.ref('Category', 'id'), {
          onDelete: 'setNull',
          index: true,
        }),
      ],
    }));

    await applyMigration(
      { destination: defineContract({ ...pack, models: { Category, Post } }) },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Category" (id, name) VALUES (?, ?)', [1, 'Tech']);
        await driver.query('INSERT INTO "Post" (id, title, category_id) VALUES (?, ?, ?)', [
          1,
          'Post 1',
          1,
        ]);
        await driver.query('DELETE FROM "Category" WHERE id = ?', [1]);
        const rows = await driver.query<{ category_id: number | null }>(
          'SELECT category_id FROM "Post" WHERE id = ?',
          [1],
        );
        expect(rows.rows[0]!.category_id).toBeNull();
      },
    );
  });

  it('creates a table with indexes', async () => {
    await applyMigration(
      {
        destination: defineContract({
          ...pack,
          models: {
            Event: model('Event', {
              fields: { id: int.id(), name: text, date: text, location: text.optional() },
            }).sql((ctx) => ({
              indexes: [
                ctx.constraints.index(ctx.cols.date, { name: 'idx_events_date' }),
                ctx.constraints.index([ctx.cols.name, ctx.cols.date], {
                  name: 'idx_events_name_date',
                }),
              ],
            })),
          },
        }),
      },
      async ({ schema }) => {
        const cols = schema.tables['Event']!.indexes.map((i) => [...i.columns]);
        expect(cols).toContainEqual(['date']);
        expect(cols).toContainEqual(['name', 'date']);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Schema evolution
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Schema evolution', () => {
  it('adds a new nullable column', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, bio: text.optional() } }),
          },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['bio']).toBeDefined();
      },
    );
  });

  it('adds a new column with a default value', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', {
              fields: { id: int.id(), name: text, status: text.default('active') },
            }),
          },
        }),
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "User" (id, name) VALUES (?, ?)', [1, 'Alice']);
        expect(
          (await driver.query<{ status: string }>('SELECT status FROM "User" WHERE id = ?', [1]))
            .rows[0]!.status,
        ).toBe('active');
      },
    );
  });

  it('adds a new table alongside existing tables', async () => {
    const UserModel = model('User', { fields: { id: int.id(), name: text } });
    const PostModel = model('Post', {
      fields: { id: int.id(), title: text, userId: int.column('user_id') },
    }).sql((ctx) => ({
      foreignKeys: [ctx.constraints.foreignKey(ctx.cols.userId, ctx.constraints.ref('User', 'id'))],
    }));

    await applyMigration(
      {
        origin: defineContract({ ...pack, models: { User: UserModel } }),
        destination: defineContract({ ...pack, models: { User: UserModel, Post: PostModel } }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
        expect(schema.tables['Post']).toBeDefined();
      },
    );
  });

  it('adds an index to an existing table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), email: text } }).sql((ctx) => ({
              indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_users_email' })],
            })),
          },
        }),
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.indexes.map((i) => [...i.columns])).toContainEqual(['email']);
      },
    );
  });

  it('applies a multi-step migration: new columns, indexes, and table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                email: text,
                bio: text.optional(),
                status: text.default('active'),
              },
            }).sql((ctx) => ({
              indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_users_email' })],
            })),
            Post: model('Post', {
              fields: { id: int.id(), title: text, userId: int.column('user_id') },
            }).sql((ctx) => ({
              foreignKeys: [
                ctx.constraints.foreignKey(ctx.cols.userId, ctx.constraints.ref('User', 'id')),
              ],
            })),
          },
        }),
      },
      async ({ schema, operationsExecuted }) => {
        expect(schema.tables['User']!.columns['bio']).toBeDefined();
        expect(schema.tables['User']!.columns['status']).toBeDefined();
        expect(schema.tables['Post']).toBeDefined();
        expect(operationsExecuted).toBeGreaterThanOrEqual(4);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Destructive operations
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Destructive operations', () => {
  const DESTRUCTIVE = { allowedOperationClasses: ['additive', 'destructive'] } as const;

  it('drops a table removed from the contract', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text } }),
            Legacy: model('Legacy', { fields: { id: int.id(), data: text } }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: DESTRUCTIVE,
      },
      async ({ schema }) => {
        expect(schema.tables['User']).toBeDefined();
        expect(schema.tables['Legacy']).toBeUndefined();
      },
    );
  });

  it('drops an index removed from the contract', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), email: text } }).sql((ctx) => ({
              indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_users_email' })],
            })),
          },
        }),
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), email: text } }) },
        }),
        policy: DESTRUCTIVE,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.indexes).toHaveLength(0);
      },
    );
  });

  it('replaces an index (drop old + create new)', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({
                indexes: [ctx.constraints.index(ctx.cols.email, { name: 'idx_email' })],
              }),
            ),
          },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), email: text, name: text } }).sql(
              (ctx) => ({ indexes: [ctx.constraints.index(ctx.cols.name, { name: 'idx_name' })] }),
            ),
          },
        }),
        policy: DESTRUCTIVE,
      },
      async ({ schema }) => {
        const cols = schema.tables['User']!.indexes.map((i) => [...i.columns]);
        expect(cols).toContainEqual(['name']);
        expect(cols).not.toContainEqual(['email']);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Widening operations (recreate-table)
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Widening operations (recreate-table)', () => {
  const WIDENING = { allowedOperationClasses: ['additive', 'widening'] } as const;

  it('relaxes NOT NULL to nullable', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text, bio: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, bio: text.optional() } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ schema, driver }) => {
        expect(schema.tables['User']!.columns['bio']!.nullable).toBe(true);
        await driver.query('INSERT INTO "User" (id, name, bio) VALUES (?, ?, ?)', [
          1,
          'Alice',
          null,
        ]);
        expect(
          (await driver.query<{ bio: string | null }>('SELECT bio FROM "User" WHERE id = ?', [1]))
            .rows[0]!.bio,
        ).toBeNull();
      },
    );
  });

  it('changes a column default', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('draft') } }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: {
            Setting: model('Setting', { fields: { id: int.id(), status: text.default('active') } }),
          },
        }),
        policy: WIDENING,
      },
      async ({ driver }) => {
        await driver.query('INSERT INTO "Setting" (id) VALUES (?)', [1]);
        expect(
          (await driver.query<{ status: string }>('SELECT status FROM "Setting" WHERE id = ?', [1]))
            .rows[0]!.status,
        ).toBe('active');
      },
    );
  });

  it('preserves existing data through recreate-table', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text, email: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, email: text.optional() } }),
          },
        }),
        policy: WIDENING,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'alice@example.com',
          ]);
          await driver.query('INSERT INTO "User" (id, name, email) VALUES (?, ?, ?)', [
            2,
            'Bob',
            'bob@example.com',
          ]);
        },
      },
      async ({ driver }) => {
        const rows = await driver.query<{ id: number; name: string; email: string }>(
          'SELECT * FROM "User" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({ id: 1, name: 'Alice', email: 'alice@example.com' });
        expect(rows.rows[1]).toMatchObject({ id: 2, name: 'Bob', email: 'bob@example.com' });
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Destructive column/constraint changes
// ---------------------------------------------------------------------------

describe('SQLite Migration E2E - Destructive column changes', () => {
  const ALL = { allowedOperationClasses: ['additive', 'widening', 'destructive'] } as const;

  it('drops a column', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            User: model('User', {
              fields: {
                id: int.id(),
                name: text,
                legacyField: text.optional().column('legacy_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['legacy_field']).toBeUndefined();
        expect(schema.tables['User']!.columns['name']).toBeDefined();
      },
    );
  });

  it('changes a column type', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['Item']!.columns['value']!.nativeType).toBe('integer');
      },
    );
  });

  it('tightens nullability (nullable to NOT NULL)', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text.optional() } }) },
        }),
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['User']!.columns['name']!.nullable).toBe(false);
      },
    );
  });

  it('drops a column and preserves remaining data', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            User: model('User', { fields: { id: int.id(), name: text, temp: text.optional() } }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: { User: model('User', { fields: { id: int.id(), name: text } }) },
        }),
        policy: ALL,
        seed: async (driver) => {
          await driver.query('INSERT INTO "User" (id, name, temp) VALUES (?, ?, ?)', [
            1,
            'Alice',
            'remove-me',
          ]);
        },
      },
      async ({ driver }) => {
        const rows = await driver.query<{ id: number; name: string }>(
          'SELECT * FROM "User" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(1);
        expect(rows.rows[0]).toMatchObject({ id: 1, name: 'Alice' });
      },
    );
  });

  it('changes a column type and preserves data', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: { Item: model('Item', { fields: { id: int.id(), value: text } }) },
        }),
        destination: defineContract({
          ...pack,
          models: { Item: model('Item', { fields: { id: int.id(), value: int.optional() } }) },
        }),
        policy: ALL,
        seed: async (driver) => {
          await driver.query('INSERT INTO "Item" (id, value) VALUES (?, ?)', [1, '42']);
          await driver.query('INSERT INTO "Item" (id, value) VALUES (?, ?)', [2, '0']);
        },
      },
      async ({ driver, schema }) => {
        expect(schema.tables['Item']!.columns['value']!.nativeType).toBe('integer');
        const rows = await driver.query<{ id: number; value: number }>(
          'SELECT * FROM "Item" ORDER BY id',
        );
        expect(rows.rows).toHaveLength(2);
        expect(rows.rows[0]).toMatchObject({ id: 1, value: 42 });
        expect(rows.rows[1]).toMatchObject({ id: 2, value: 0 });
      },
    );
  });

  it('combined: drop column + change type + tighten nullability', async () => {
    await applyMigration(
      {
        origin: defineContract({
          ...pack,
          models: {
            Record: model('Record', {
              fields: {
                id: int.id(),
                value: text.optional(),
                oldField: text.optional().column('old_field'),
              },
            }),
          },
        }),
        destination: defineContract({
          ...pack,
          models: { Record: model('Record', { fields: { id: int.id(), value: int } }) },
        }),
        policy: ALL,
      },
      async ({ schema }) => {
        expect(schema.tables['Record']!.columns['old_field']).toBeUndefined();
        expect(schema.tables['Record']!.columns['value']!.nativeType).toBe('integer');
        expect(schema.tables['Record']!.columns['value']!.nullable).toBe(false);
      },
    );
  });
});
