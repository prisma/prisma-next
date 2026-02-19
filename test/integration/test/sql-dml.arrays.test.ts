import { createPostgresAdapter } from '@prisma-next/adapter-postgres/adapter';
import { int4Column, listOf, textColumn } from '@prisma-next/adapter-postgres/column-types';
import type { ResultType } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { sql } from '@prisma-next/sql-lane/sql';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { createTestContext, executePlanAndCollect } from '@prisma-next/sql-runtime/test/utils';
import { createDevDatabase, teardownTestDatabase, timeouts } from '@prisma-next/test-utils';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestRuntime, setupTestDatabase } from './utils';

const fixtureContractRaw: SqlContract<SqlStorage> = {
  schemaVersion: '1',
  target: 'postgres',
  targetFamily: 'sql',
  storageHash: coreHash('sha256:array-dml-test-core'),
  profileHash: profileHash('sha256:array-dml-test-profile'),
  storage: {
    tables: {
      post: {
        columns: {
          id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
          tags: { ...listOf(textColumn), nullable: false },
          scores: { ...listOf(int4Column), nullable: true },
        },
        primaryKey: {
          columns: ['id'],
          name: 'post_pkey',
        },
        uniques: [],
        indexes: [],
        foreignKeys: [],
      },
    },
  },
  models: {},
  relations: {},
  mappings: {
    codecTypes: {},
    operationTypes: {},
  },
  capabilities: {
    postgres: {
      returning: true,
    },
  },
  extensionPacks: {},
  meta: {},
  sources: {},
};
const fixtureContract = validateContract(fixtureContractRaw);

describe('DML Integration Tests — Array Columns', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let client: Client;
  const adapter = createPostgresAdapter();

  beforeAll(async () => {
    database = await createDevDatabase();
    client = new Client({ connectionString: database.connectionString });
    await client.connect();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    try {
      await client.end();
      await database.close();
    } catch {
      // Ignore cleanup errors
    }
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    await setupTestDatabase(client, fixtureContract, async (c: typeof client) => {
      await c.query('DROP TABLE IF EXISTS "post"');
      await c.query(`
        CREATE TABLE "post" (
          id SERIAL PRIMARY KEY,
          title TEXT NOT NULL,
          tags TEXT[] NOT NULL,
          scores INT4[]
        )
      `);
    });
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    await teardownTestDatabase(client, ['post']);
  }, timeouts.spinUpPpgDev);

  function createRuntime() {
    return createTestRuntime(
      fixtureContract,
      { connect: { client }, cursor: { disabled: true } },
      { verify: { mode: 'onFirstUse', requireMarker: true } },
    );
  }

  function createContext() {
    const context = createTestContext(fixtureContract, adapter);
    const tables = schema(context).tables;
    const postTable = tables['post'];
    if (!postTable) throw new Error('post table not found');
    return { context, postTable, columns: postTable.columns };
  }

  describe('insert', () => {
    it(
      'inserts a row with text array and returns it',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const plan = builder
          .insert(postTable, {
            title: param('title'),
            tags: param('tags'),
          })
          .returning(
            columns['id'] as ColumnBuilder,
            columns['title'] as ColumnBuilder,
            columns['tags'] as ColumnBuilder,
          )
          .build({
            params: {
              title: 'Hello World',
              tags: ['prisma', 'typescript', 'postgres'],
            },
          });

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: expect.any(Number),
          title: 'Hello World',
          tags: ['prisma', 'typescript', 'postgres'],
        });
      },
      timeouts.databaseOperation,
    );

    it(
      'inserts a row with integer array',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const plan = builder
          .insert(postTable, {
            title: param('title'),
            tags: param('tags'),
            scores: param('scores'),
          })
          .returning(columns['id'] as ColumnBuilder, columns['scores'] as ColumnBuilder)
          .build({
            params: {
              title: 'Scored Post',
              tags: ['test'],
              scores: [95, 87, 100],
            },
          });

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.['scores']).toEqual([95, 87, 100]);
      },
      timeouts.databaseOperation,
    );

    it(
      'inserts a row with null array column',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const plan = builder
          .insert(postTable, {
            title: param('title'),
            tags: param('tags'),
            scores: param('scores'),
          })
          .returning(columns['id'] as ColumnBuilder, columns['scores'] as ColumnBuilder)
          .build({
            params: {
              title: 'No Scores',
              tags: ['test'],
              scores: null,
            },
          });

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.['scores']).toBeNull();
      },
      timeouts.databaseOperation,
    );

    it(
      'inserts a row with empty array',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const plan = builder
          .insert(postTable, {
            title: param('title'),
            tags: param('tags'),
          })
          .returning(columns['id'] as ColumnBuilder, columns['tags'] as ColumnBuilder)
          .build({
            params: {
              title: 'Empty Tags',
              tags: [],
            },
          });

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(1);
        expect(rows[0]?.['tags']).toEqual([]);
      },
      timeouts.databaseOperation,
    );
  });

  describe('select', () => {
    beforeEach(async () => {
      await client.query(
        `INSERT INTO "post" (title, tags, scores) VALUES
         ($1, $2, $3),
         ($4, $5, $6)`,
        ['Post A', ['alpha', 'beta'], [10, 20], 'Post B', ['gamma'], null],
      );
    }, timeouts.spinUpPpgDev);

    it(
      'selects rows with array columns',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const plan = builder
          .from(postTable)
          .select({
            title: columns['title'] as ColumnBuilder,
            tags: columns['tags'] as ColumnBuilder,
            scores: columns['scores'] as ColumnBuilder,
          })
          .build();

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(2);

        const postA = rows.find((r) => r.title === 'Post A');
        expect(postA?.tags).toEqual(['alpha', 'beta']);
        expect(postA?.scores).toEqual([10, 20]);

        const postB = rows.find((r) => r.title === 'Post B');
        expect(postB?.tags).toEqual(['gamma']);
        expect(postB?.scores).toBeNull();
      },
      timeouts.databaseOperation,
    );
  });

  describe('update', () => {
    beforeEach(async () => {
      await client.query('INSERT INTO "post" (title, tags, scores) VALUES ($1, $2, $3)', [
        'Original',
        ['old-tag'],
        [1, 2, 3],
      ]);
    }, timeouts.spinUpPpgDev);

    it(
      'updates array columns and returns them',
      async () => {
        const runtime = createRuntime();
        const { context, postTable, columns } = createContext();
        const builder = sql({ context });

        const idCol = columns['id'];
        if (!idCol) throw new Error('id column not found');

        const plan = builder
          .update(postTable, {
            tags: param('tags'),
            scores: param('scores'),
          })
          .where(idCol.eq(param('postId')))
          .returning(
            columns['id'] as ColumnBuilder,
            columns['tags'] as ColumnBuilder,
            columns['scores'] as ColumnBuilder,
          )
          .build({
            params: {
              tags: ['new-tag-1', 'new-tag-2'],
              scores: [99, 100],
              postId: 1,
            },
          });

        type Row = ResultType<typeof plan>;
        const rows: Row[] = await executePlanAndCollect(runtime, plan);

        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
          id: 1,
          tags: ['new-tag-1', 'new-tag-2'],
          scores: [99, 100],
        });

        const verify = await client.query('SELECT tags, scores FROM "post" WHERE id = 1');
        expect(verify.rows[0].tags).toEqual(['new-tag-1', 'new-tag-2']);
        expect(verify.rows[0].scores).toEqual([99, 100]);
      },
      timeouts.databaseOperation,
    );
  });
});
