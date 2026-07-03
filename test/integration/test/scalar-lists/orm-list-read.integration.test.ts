/**
 * Strongly-typed ORM write->read round-trip over native scalar-list columns.
 *
 * The test consumes the precise emitted contract fixture (not a widened
 * `Contract<SqlStorage>`), which is what makes the ORM's namespace/model
 * accessors fully typed: `db.public.Item` is a real `Item` collection rather
 * than an index signature.
 */
import { postgresRawCodecInferer } from '@prisma-next/adapter-postgres/adapter';
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract as FrameworkContract } from '@prisma-next/contract/types';
import postgresControlDriver from '@prisma-next/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@prisma-next/framework-components/control';
import { buildSynthMigrationEdge } from '@prisma-next/migration-tools/aggregate';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { orm } from '@prisma-next/sql-orm-client';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlMiddleware,
} from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import postgresRuntimeTarget, {
  PostgresContractSerializer,
} from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, expectTypeOf, it } from 'vitest';
import type { Contract } from '../sql-orm-client/fixtures/scalar-lists/generated/contract';
import contractJson from '../sql-orm-client/fixtures/scalar-lists/generated/contract.json' with {
  type: 'json',
};
import { createTestRuntimeFromClient } from '../utils';
import { postgresFrameworkComponents } from './psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensionPacks: [],
});
const familyInstance = sql.create(controlStack);

const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;

async function migrateContract(connectionString: string): Promise<void> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planner = postgres.createPlanner(postgresAdapter.create(controlStack));
    const planResult = planner.plan({
      contract: contract as FrameworkContract<SqlStorage>,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }

    const runner = postgres.createRunner(familyInstance);
    const runResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildSynthMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract as FrameworkContract<SqlStorage>,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: postgresFrameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed: ${JSON.stringify(runResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe.sequential('ORM scalar-list round-trip', () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'writes and reads String[]/Int[] columns through the typed ORM, inferring arrays',
    async () => {
      if (!database) throw new Error('database not initialised');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString);

      await withClient(database.connectionString, async (client) => {
        const runtime = await createTestRuntimeFromClient(
          contract as FrameworkContract<SqlStorage>,
          client,
          { verifyMarker: false },
        );

        const context = createExecutionContext<Contract>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensionPacks: [],
          }),
        });
        const db = orm({ runtime, context });

        await db.public.Item.create({ id: 1, tags: ['a', 'b', 'c'], scores: [1, 2, 3] });

        const rows = await db.public.Item.select('id', 'tags', 'scores').all();

        expect(rows).toEqual([{ id: 1, tags: ['a', 'b', 'c'], scores: [1, 2, 3] }]);

        type Row = (typeof rows)[number];
        expectTypeOf<Row['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
        expectTypeOf<Row['scores']>().toEqualTypeOf<ReadonlyArray<number>>();
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'filters rows through the native `has` membership op, lowering to `= ANY(...)`',
    async () => {
      if (!database) throw new Error('database not initialised');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString);

      await withClient(database.connectionString, async (client) => {
        const capturedSql: string[] = [];
        const captureMiddleware: SqlMiddleware = {
          name: 'capture-sql',
          beforeExecute(plan) {
            capturedSql.push(plan.sql);
          },
        };
        const runtime = await createTestRuntimeFromClient(
          contract as FrameworkContract<SqlStorage>,
          client,
          { verifyMarker: false, middleware: [captureMiddleware] },
        );

        const context = createExecutionContext<Contract>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensionPacks: [],
          }),
        });

        const db = orm({ runtime, context });
        await db.public.Item.create({ id: 1, tags: ['react', 'vue'], scores: [1] });
        await db.public.Item.create({ id: 2, tags: ['vue', 'svelte'], scores: [2] });
        await db.public.Item.create({ id: 3, tags: ['svelte'], scores: [3] });

        const builder = sqlBuilder({ context, rawCodecInferer: postgresRawCodecInferer });
        const rows = await runtime.execute(
          builder.public.item
            .select('id')
            .where((f, fns) => fns.has(f.tags, 'vue'))
            .orderBy((f) => f.id)
            .build(),
        );

        expect(capturedSql.some((s) => /= ANY\(/.test(s))).toBe(true);
        expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'filters rows through native array ops (arrayContains @>, containedBy <@, overlaps &&)',
    async () => {
      if (!database) throw new Error('database not initialised');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString);

      await withClient(database.connectionString, async (client) => {
        const capturedSql: string[] = [];
        const captureMiddleware: SqlMiddleware = {
          name: 'capture-sql',
          beforeExecute(plan) {
            capturedSql.push(plan.sql);
          },
        };
        const runtime = await createTestRuntimeFromClient(
          contract as FrameworkContract<SqlStorage>,
          client,
          { verifyMarker: false, middleware: [captureMiddleware] },
        );

        const context = createExecutionContext<Contract>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensionPacks: [],
          }),
        });

        const db = orm({ runtime, context });
        await db.public.Item.create({ id: 1, tags: ['react', 'vue'], scores: [1] });
        await db.public.Item.create({ id: 2, tags: ['vue', 'svelte'], scores: [2] });
        await db.public.Item.create({ id: 3, tags: ['svelte'], scores: [3] });

        const builder = sqlBuilder({ context, rawCodecInferer: postgresRawCodecInferer });

        const within = await runtime.execute(
          builder.public.item
            .select('id')
            .where((f, fns) => fns.containedBy(f.tags, ['vue', 'svelte']))
            .orderBy((f) => f.id)
            .build(),
        );
        expect(capturedSql.some((s) => s.includes('<@'))).toBe(true);
        expect(capturedSql.some((s) => s.includes('ARRAY['))).toBe(true);
        expect(within).toEqual([{ id: 2 }, { id: 3 }]);

        const overlapping = await runtime.execute(
          builder.public.item
            .select('id')
            .where((f, fns) => fns.overlaps(f.tags, ['react']))
            .orderBy((f) => f.id)
            .build(),
        );
        expect(capturedSql.some((s) => s.includes('&&'))).toBe(true);
        expect(overlapping).toEqual([{ id: 1 }]);

        const superset = await runtime.execute(
          builder.public.item
            .select('id')
            .where((f, fns) => fns.arrayContains(f.tags, ['svelte']))
            .orderBy((f) => f.id)
            .build(),
        );
        expect(capturedSql.some((s) => s.includes('@>'))).toBe(true);
        expect(capturedSql.some((s) => s.includes('ARRAY['))).toBe(true);
        expect(superset).toEqual([{ id: 2 }, { id: 3 }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'computes list length (cardinality) and 1-based nullable element access',
    async () => {
      if (!database) throw new Error('database not initialised');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString);

      await withClient(database.connectionString, async (client) => {
        const capturedSql: string[] = [];
        const captureMiddleware: SqlMiddleware = {
          name: 'capture-sql',
          beforeExecute(plan) {
            capturedSql.push(plan.sql);
          },
        };
        const runtime = await createTestRuntimeFromClient(
          contract as FrameworkContract<SqlStorage>,
          client,
          { verifyMarker: false, middleware: [captureMiddleware] },
        );

        const context = createExecutionContext<Contract>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensionPacks: [],
          }),
        });

        const db = orm({ runtime, context });
        await db.public.Item.create({ id: 1, tags: ['react', 'vue'], scores: [10, 20] });
        await db.public.Item.create({ id: 2, tags: ['svelte'], scores: [30] });

        const builder = sqlBuilder({ context, rawCodecInferer: postgresRawCodecInferer });
        const rows = await runtime.execute(
          builder.public.item
            .select((f, fns) => ({
              id: f.id,
              len: fns.length(f.tags),
              firstTag: fns.index(f.tags, 1),
              secondScore: fns.index(f.scores, 2),
            }))
            .orderBy((f) => f.id)
            .build(),
        );

        expect(capturedSql.some((s) => s.includes('cardinality('))).toBe(true);
        expect(capturedSql.some((s) => /\[\$\d+/.test(s))).toBe(true);
        expect(rows).toEqual([
          { id: 1, len: 2, firstTag: 'react', secondScore: 20 },
          { id: 2, len: 1, firstTag: 'svelte', secondScore: null },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
