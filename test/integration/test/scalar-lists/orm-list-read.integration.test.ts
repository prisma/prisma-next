/**
 * Strongly-typed ORM write->read round-trip over native scalar-list columns.
 *
 * The model (`Item { id Int @id; tags String[]; scores Int[] }`) is authored in
 * PSL and emitted to a committed contract fixture
 * (`../sql-orm-client/fixtures/scalar-lists/generated`). Its storage columns are
 * native arrays (`pg/text@1` / `pg/int4@1`, `many: true`, not the jsonb
 * fallback) and the generated `contract.d.ts` types each field as
 * `ReadonlyArray<...>`.
 *
 * Because the contract is the precise emitted type (not a widened
 * `Contract<SqlStorage>`), the ORM's namespace/model accessors are fully typed:
 * `db.public.Item` is a real `Item` collection, not an index signature. The test
 * migrates the contract onto a real Postgres database, seeds a row through the
 * typed ORM (`create`), reads it back through dotted, strongly-typed accessors,
 * and asserts both the value round-trip and the `many` -> array type inference.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract as FrameworkContract } from '@prisma-next/contract/types';
import postgresControlDriver from '@prisma-next/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@prisma-next/framework-components/control';
import { buildSynthMigrationEdge } from '@prisma-next/migration-tools/aggregate';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { orm } from '@prisma-next/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
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

// Deserialization runs the full sql contract validation pipeline (structure +
// domain + storage semantics), so a contract that failed to round-trip
// validation would throw here. The result carries the precise emitted `Contract`
// type, which is what makes the ORM accessors below strongly typed.
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

        // Seed through the typed ORM: `tags`/`scores` are typed as
        // `ReadonlyArray<string>` / `ReadonlyArray<number>` on the create input.
        await db.public.Item.create({ id: 1, tags: ['a', 'b', 'c'], scores: [1, 2, 3] });

        const rows = await db.public.Item.select('id', 'tags', 'scores').all();

        expect(rows).toEqual([{ id: 1, tags: ['a', 'b', 'c'], scores: [1, 2, 3] }]);

        // The whole point: `many` list columns infer as arrays at the type level.
        type Row = (typeof rows)[number];
        expectTypeOf<Row['tags']>().toEqualTypeOf<ReadonlyArray<string>>();
        expectTypeOf<Row['scores']>().toEqualTypeOf<ReadonlyArray<number>>();
      });
    },
    timeouts.spinUpPpgDev,
  );
});
