import postgresAdapterControl from '@prisma-next/adapter-postgres/control';
import postgresAdapterRuntime from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriverControl from '@prisma-next/driver-postgres/control';
import postgresDriverRuntime from '@prisma-next/driver-postgres/runtime';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@prisma-next/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@prisma-next/framework-components/control';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import type { AsyncIterableResult } from '@prisma-next/framework-components/runtime';
import { buildFabricatedMigrationEdge } from '@prisma-next/migration-tools/aggregate';
import { PostgresRuntimeImpl } from '@prisma-next/postgres/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { type OrmOptions, orm, type RuntimeQueryable } from '@prisma-next/sql-orm-client';
import type { SqlExecutionPlan, SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import postgresTargetControl from '@prisma-next/target-postgres/control';
import postgresTargetRuntime, {
  PostgresContractSerializer,
} from '@prisma-next/target-postgres/runtime';
import { timeouts, withDevDatabase } from '@prisma-next/test-utils';
import { Client } from 'pg';

/**
 * Generic Postgres harness for ported tests.
 *
 * Each ported suite authors its schema as PSL (`_fixtures/<suite>/contract.prisma`)
 * and emits a `contract.json`/`contract.d.ts`. The harness:
 *   1. spins up a PGlite dev database,
 *   2. **pushes the contract to the database** through prisma-next's own
 *      plan → apply path (the same mechanism `prisma-next db init` uses) — no
 *      hand-written DDL, so the materialised schema can never drift from the
 *      contract under test,
 *   3. yields an `orm()` handle for the query-under-test plus a raw `sql()`
 *      escape hatch for seeding/inspection.
 *
 * `returning` capability is enabled by default so `create/update/delete` read
 * rows back, matching Prisma Client behaviour.
 */

const serializer = new PostgresContractSerializer();

const controlStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  driver: postgresDriverControl,
  extensionPacks: [],
});
const controlFamily = sqlFamilyControl.create(controlStack);
const controlAdapter = postgresAdapterControl.create(controlStack);
const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
] as const;

export interface PortRuntime extends RuntimeQueryable {
  /** Every plan executed through `orm()`, lowered to SQL (for count assertions). */
  readonly executions: readonly SqlExecutionPlan[];
  /** Raw SQL against the same backend — used for seeding and inspection. */
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<readonly Row[]>;
  resetExecutions(): void;
  close(): Promise<void>;
}

export interface PortContext<TContract extends Contract<SqlStorage>> {
  readonly runtime: PortRuntime;
  /** ORM handle: `db.<namespace>.<Model>...`. */
  readonly db: ReturnType<typeof orm<TContract, Record<string, never>>>;
  readonly contract: TContract;
}

export interface WithPostgresPortOptions<TContract extends Contract<SqlStorage>> {
  /** The emitted `contract.json` (imported with `{ type: 'json' }`). */
  readonly contractJson: unknown;
  /** Extra runtime extension packs (e.g. pgvector) if the fixture needs them. */
  readonly extensionPacks?: readonly SqlRuntimeExtensionDescriptor<'postgres'>[];
  /** ORM collection subclasses, forwarded to `orm({ collections })`. */
  readonly collections?: OrmOptions<TContract, Record<string, never>>['collections'];
  /** Enable the `returning` capability (default true). */
  readonly returning?: boolean;
}

function enableReturning<T extends Contract<SqlStorage>>(contract: T): T {
  return {
    ...contract,
    capabilities: { ...contract.capabilities, returning: { enabled: true } },
  } as T;
}

/** Pushes `contract` into a fresh database via plan → apply (greenfield init). */
async function pushContract(connectionString: string, contractJson: unknown): Promise<void> {
  const contract = controlFamily.deserializeContract(contractJson) as Contract<SqlStorage>;
  const driver = await postgresDriverControl.create(connectionString);
  try {
    const schema = await controlFamily.introspect({ driver, contract });
    const planner = postgresTargetControl.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planResult)}`);
    }
    const plan = planResult.plan;
    const runner = postgresTargetControl.createRunner(controlFamily);
    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(executeResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

async function createPortRuntime<TContract extends Contract<SqlStorage>>(
  connectionString: string,
  contract: TContract,
  extensionPacks: readonly SqlRuntimeExtensionDescriptor<'postgres'>[],
): Promise<PortRuntime> {
  const client = new Client({ connectionString });
  await client.connect();

  const setup = await (async () => {
    try {
      await client.query('select 1');
      const stack = createSqlExecutionStack({
        target: postgresTargetRuntime,
        adapter: postgresAdapterRuntime,
        driver: postgresDriverRuntime,
        extensionPacks,
      });
      const context = createExecutionContext<Contract<SqlStorage>>({ contract, stack });
      const stackInstance = instantiateExecutionStack(stack);
      const adapter = stackInstance.adapter;
      if (!adapter) throw new Error('Adapter descriptor missing from execution stack');
      const driver = stackInstance.driver;
      if (!driver) throw new Error('Driver descriptor missing from execution stack');
      await driver.connect({ kind: 'pgClient', client });
      const realRuntime = new PostgresRuntimeImpl({ context, adapter, driver });
      return { adapter, realRuntime };
    } catch (err) {
      await client.end();
      throw err;
    }
  })();
  const { adapter, realRuntime } = setup;

  const executions: SqlExecutionPlan[] = [];
  const toLoweredPlan = <Row>(
    plan: SqlExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): SqlExecutionPlan<Row> => {
    if ('sql' in plan) return plan;
    const lowered = adapter.lower(plan.ast, { contract, params: plan.params });
    return {
      sql: lowered.sql,
      params: lowered.params ?? plan.params,
      ast: plan.ast,
      meta: plan.meta,
    };
  };

  const recordAndDelegate = <Row>(
    delegate: (
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    ) => AsyncIterableResult<Row>,
    plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
  ): AsyncIterableResult<Row> => {
    executions.push(toLoweredPlan(plan));
    return delegate(plan);
  };

  return {
    executions,
    async query<Row extends Record<string, unknown> = Record<string, unknown>>(
      text: string,
      params: readonly unknown[] = [],
    ): Promise<readonly Row[]> {
      const result = await client.query<Row>(text, [...params]);
      return result.rows;
    },
    resetExecutions() {
      executions.length = 0;
    },
    async close() {
      await realRuntime.close();
    },
    execute<Row>(
      plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row },
    ): AsyncIterableResult<Row> {
      return recordAndDelegate((p) => realRuntime.execute(p), plan);
    },
    async connection() {
      const conn = await realRuntime.connection();
      type PgConnection = Awaited<ReturnType<typeof realRuntime.connection>>;
      type PgTransaction = Awaited<ReturnType<PgConnection['transaction']>>;
      const recordingConnection: PgConnection = {
        ...conn,
        execute: <Row>(plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row }) =>
          recordAndDelegate((p) => conn.execute(p), plan),
        transaction: async (): Promise<PgTransaction> => {
          const tx = await conn.transaction();
          const recordingTransaction: PgTransaction = {
            ...tx,
            execute: <Row>(plan: (SqlExecutionPlan | SqlQueryPlan) & { readonly _row?: Row }) =>
              recordAndDelegate((p) => tx.execute(p), plan),
          };
          return recordingTransaction;
        },
      };
      return recordingConnection;
    },
  };
}

export async function withPostgresPort<TContract extends Contract<SqlStorage>>(
  options: WithPostgresPortOptions<TContract>,
  fn: (ctx: PortContext<TContract>) => Promise<void>,
): Promise<void> {
  const base = serializer.deserializeContract(
    JSON.parse(JSON.stringify(options.contractJson)),
  ) as TContract;
  const contract = options.returning === false ? base : enableReturning(base);
  const extensionPacks = options.extensionPacks ?? [];

  await withDevDatabase(
    async ({ connectionString }) => {
      // Push the schema the way prisma-next itself does, then reconnect the
      // runtime (PGlite allows a single connection; the dev-db server persists
      // the pushed schema across the reconnect).
      await pushContract(connectionString, options.contractJson);
      const runtime = await createPortRuntime(connectionString, contract, extensionPacks);
      try {
        const db = orm<TContract, Record<string, never>>({
          runtime,
          context: createExecutionContext<TContract>({
            contract,
            stack: createSqlExecutionStack({
              target: postgresTargetRuntime,
              adapter: postgresAdapterRuntime,
              extensionPacks,
            }),
          }),
          ...(options.collections ? { collections: options.collections } : {}),
        });
        await fn({ runtime, db, contract });
      } finally {
        await runtime.close();
      }
    },
    { databaseIdleTimeoutMillis: 30_000 },
  );
}

export { timeouts };
