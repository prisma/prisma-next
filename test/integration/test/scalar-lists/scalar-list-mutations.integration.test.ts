/**
 * End-to-end proof of the native list update mutators (`arrayAppend`,
 * `arrayRemove`, and whole-array replacement) on real Postgres.
 *
 * An update that appends to and removes from a `tags String[]` column executes
 * the corresponding Postgres array mutation (`array_append` / `array_remove`)
 * and the subsequent read returns the mutated list decoded element-wise (AC7).
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

describe.sequential('ORM scalar-list update mutators', () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'appends to and removes from a list column via array_append/array_remove, reading back the mutated list',
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

        const builder = sqlBuilder({ context, rawCodecInferer: postgresRawCodecInferer });

        await runtime.execute(
          builder.public.item.insert([{ id: 1, tags: ['a', 'b'], scores: [1, 2] }]).build(),
        );

        await runtime.execute(
          builder.public.item
            .update((f, fns) => ({ tags: fns.arrayRemove(fns.arrayAppend(f.tags, 'c'), 'a') }))
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );

        expect(capturedSql.some((s) => s.includes('array_append('))).toBe(true);
        expect(capturedSql.some((s) => s.includes('array_remove('))).toBe(true);

        const rows = await runtime.execute(
          builder.public.item
            .select('id', 'tags')
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );
        expect(rows).toEqual([{ id: 1, tags: ['b', 'c'] }]);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'replaces the whole list column with a raw array literal',
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

        const builder = sqlBuilder({ context, rawCodecInferer: postgresRawCodecInferer });

        await runtime.execute(
          builder.public.item.insert([{ id: 1, tags: ['a', 'b'], scores: [1] }]).build(),
        );

        await runtime.execute(
          builder.public.item
            .update({ tags: ['x', 'y'] })
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );

        const rows = await runtime.execute(
          builder.public.item
            .select('id', 'tags')
            .where((f, fns) => fns.eq(f.id, 1))
            .build(),
        );
        expect(rows).toEqual([{ id: 1, tags: ['x', 'y'] }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
