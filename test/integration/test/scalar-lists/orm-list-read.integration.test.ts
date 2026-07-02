/**
 * Reads a native scalar-list column (`tags String[]`, `scores Int[]`) back
 * through the ORM client. A model authored in PSL emits array storage columns
 * (`pg/text@1`/`pg/int4@1`, `many:true`); after migrating onto a real Postgres
 * database and inserting a row, `orm().<ns>.<model>.select(...).all()` surfaces
 * each list column as a decoded JS array — proving the ORM read path projects
 * and decodes scalar `many` columns element-wise, not just to-many relations.
 */
import postgresAdapter from '@prisma-next/adapter-postgres/control';
import postgresRuntimeAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresControlDriver from '@prisma-next/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@prisma-next/framework-components/control';
import { buildSynthMigrationEdge } from '@prisma-next/migration-tools/aggregate';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { orm } from '@prisma-next/sql-orm-client';
import { InsertAst, ParamRef, TableSource } from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import { createExecutionContext, createSqlExecutionStack } from '@prisma-next/sql-runtime';
import postgres from '@prisma-next/target-postgres/control';
import postgresRuntimeTarget from '@prisma-next/target-postgres/runtime';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@prisma-next/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntimeFromClient } from '../utils';
import {
  authorSqlContractFromPsl,
  findStorageColumn,
  listCodecRefFor,
  postgresFrameworkComponents,
  tableNameForColumn,
} from './psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensionPacks: [],
});
const familyInstance = sql.create(controlStack);

async function migrateContract(
  connectionString: string,
  contract: Contract<SqlStorage>,
): Promise<void> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planner = postgres.createPlanner(postgresAdapter.create(controlStack));
    const planResult = planner.plan({
      contract,
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
          destinationContract: contract,
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

describe.sequential('ORM scalar-list read-back', () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'orm().<model>.select(...).all() surfaces String[]/Int[] columns as arrays',
    async () => {
      if (!database) throw new Error('database not initialised');

      const authored = await authorSqlContractFromPsl(`model Item {
  id     Int      @id
  tags   String[]
  scores Int[]
}`);
      expect(authored.ok).toBe(true);
      const contract = authored.contract;
      if (!contract) throw new Error('authoring produced no contract');

      // Sanity: native array columns (not the jsonb fallback).
      expect(findStorageColumn(contract, 'tags')).toMatchObject({
        codecId: 'pg/text@1',
        many: true,
      });
      expect(findStorageColumn(contract, 'scores')).toMatchObject({
        codecId: 'pg/int4@1',
        many: true,
      });

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString, contract);

      const tableName = tableNameForColumn(contract, 'tags');
      const table = TableSource.named(tableName);
      const tagsRef = listCodecRefFor(contract, 'tags');
      const scoresRef = listCodecRefFor(contract, 'scores');
      const tags = ['a', 'b', 'c'];
      const scores = [1, 2, 3];

      await withClient(database.connectionString, async (client) => {
        const runtime = await createTestRuntimeFromClient(contract, client, {
          verifyMarker: false,
        });

        // Seed via the raw runtime; the ORM read path is what's under test.
        const insert = InsertAst.into(table).withRows([
          {
            id: ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
            tags: ParamRef.of(tags, { codec: tagsRef }),
            scores: ParamRef.of(scores, { codec: scoresRef }),
          },
        ]);
        await runtime.execute(planFromAst(insert, contract)).toArray();

        const context = createExecutionContext<Contract<SqlStorage>>({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensionPacks: [],
          }),
        });
        const db = orm({ runtime, context });

        // The PSL path yields a generic `Contract<SqlStorage>`, so the ORM's
        // namespace/model accessors are index signatures (bracket access). The
        // narrow row-type array inference for `many` columns is proven by the
        // emitted-contract path; here we prove the runtime read: the ORM
        // projects and decodes the scalar `many` columns as JS arrays.
        const publicNamespace = db['public'];
        if (!publicNamespace) throw new Error('public namespace missing from ORM client');
        const items = publicNamespace['Item'];
        if (!items) throw new Error('Item collection missing from ORM client');

        // Single seeded row — result order is trivially deterministic.
        const rows = await items.select('id', 'tags', 'scores').all();

        expect(rows).toEqual([{ id: 1, tags, scores }]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
