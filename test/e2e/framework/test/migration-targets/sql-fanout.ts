import { int4Column, textColumn as pgTextColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import {
  integerColumn,
  textColumn as sqliteTextColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type {
  MigrationOperationPolicy,
  VerifyDatabaseSchemaResult,
} from '@prisma-next/framework-components/control';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  defineContract as baseDefineContract,
  field,
} from '@prisma-next/sql-contract-ts/contract-builder';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  type Runtime,
} from '@prisma-next/sql-runtime';
import type { SqlSchemaIR } from '@prisma-next/sql-schema-ir/types';
import postgresPack from '@prisma-next/target-postgres/pack';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import sqlitePack from '@prisma-next/target-sqlite/pack';
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { describe } from 'vitest';
import { getPostgresBinding, type PostgresTestDriver, postgresTestTarget } from './postgres';
import { getSqlitePath, type SqliteTestDriver, sqliteTestTarget } from './sqlite';

/**
 * Helper for fanning out SQL migration tests across SQLite and Postgres.
 *
 * Each test body runs once per target inside a `describe` block named
 * `${groupName} — sqlite` / `${groupName} — postgres`. The body receives a
 * per-target context: column-type builders (`int`, `text`, raw column
 * descriptors), a `defineContract` pre-bound to the current target's
 * family/target pack, and `runMigration({ origin?, destination, before?,
 * after })` — the harness orchestrates origin apply → optional `before`
 * with a runtime typed against `origin` → destination apply → `after`
 * with a runtime typed against `destination`.
 *
 * `before` and `after` each receive `{ db, runtime, driver }` where `db`
 * is the contract-typed SQL DSL surface (`Db<TOrigin>` / `Db<TDestination>`).
 * `driver` stays available as a raw escape hatch but should be a last
 * resort — the DSL covers the common cases and is target-portable.
 *
 * Sqlite-specific tests (rowid auto-increment, recreate-table internals,
 * datetime() canonicalization) should not use this — keep them as plain
 * `describe` blocks importing from `./sqlite`.
 */

/**
 * Structural common shape over `SqliteTestDriver` and `PostgresTestDriver`.
 * Both targets' test drivers accept `?`-style placeholders in test SQL
 * (postgres translates internally) and expose the standard control-driver
 * query API.
 */
export interface SqlTestDriver {
  readonly familyId: 'sql';
  readonly targetId: 'sqlite' | 'postgres';
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
  close(): Promise<void>;
}

export type SqlTargetName = 'sqlite' | 'postgres';

/**
 * `defineContract` pre-bound to a target's family/target pack. Test
 * authors supply only `models`; the result widens to `Contract<SqlStorage>`
 * structurally while preserving inferred model/column literals via
 * `typeof contract` at the call site.
 */
export type DefineSqlContract = <TModels>(args: { models: TModels }) => Contract<SqlStorage>;

/**
 * Context passed to `before` (typed against the origin contract).
 */
export interface SqlBeforeContext<TOrigin extends Contract<SqlStorage>> {
  readonly db: Db<TOrigin>;
  readonly runtime: Runtime;
  readonly driver: SqlTestDriver;
}

/**
 * Context passed to `after` (typed against the destination contract).
 */
export interface SqlAfterContext<TDestination extends Contract<SqlStorage>> {
  readonly db: Db<TDestination>;
  readonly runtime: Runtime;
  readonly driver: SqlTestDriver;
  readonly schema: SqlSchemaIR;
  readonly operationsExecuted: number;
  readonly plannedOperationIds: readonly string[];
}

export interface RunMigrationOptions<
  TOrigin extends Contract<SqlStorage>,
  TDestination extends Contract<SqlStorage>,
> {
  readonly origin?: TOrigin;
  readonly destination: TDestination;
  readonly policy?: MigrationOperationPolicy;
  /** Optional: runs after origin is applied, typed against origin. */
  readonly before?: (ctx: SqlBeforeContext<TOrigin>) => Promise<void>;
  /** Required: runs after destination is applied + verified, typed against destination. */
  readonly after: (ctx: SqlAfterContext<TDestination>) => Promise<void>;
}

export interface SqlFanoutContext {
  readonly name: SqlTargetName;
  readonly int: ReturnType<typeof field.column>;
  readonly text: ReturnType<typeof field.column>;
  readonly integerColumn: ColumnTypeDescriptor;
  readonly textColumn: ColumnTypeDescriptor;
  readonly defineContract: DefineSqlContract;
  runMigration<TOrigin extends Contract<SqlStorage>, TDestination extends Contract<SqlStorage>>(
    options: RunMigrationOptions<TOrigin, TDestination>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Per-target runtime construction
// ---------------------------------------------------------------------------

interface RuntimeBundle<TContract extends Contract<SqlStorage>> {
  readonly db: Db<TContract>;
  readonly runtime: Runtime;
  readonly dispose: () => Promise<void>;
}

type BuildRuntime = <TContract extends Contract<SqlStorage>>(
  driver: SqlTestDriver,
  contract: TContract,
) => Promise<RuntimeBundle<TContract>>;

const buildSqliteRuntime: BuildRuntime = async (driver, contract) => {
  const path = getSqlitePath(driver as SqliteTestDriver);
  const validated = validateContract<typeof contract>(contract, emptyCodecLookup);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract: validated, stack });
  const runtimeDriver = stackInstance.driver!;
  await runtimeDriver.connect({ kind: 'path', path });
  const runtime = createRuntime({
    stackInstance,
    context,
    driver: runtimeDriver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
  return {
    db: sqlBuilder({ context }) as Db<typeof contract>,
    runtime,
    dispose: () => runtime.close(),
  };
};

/**
 * Wrap a pg.Client so `end()` is a no-op. The test target owns the real
 * lifecycle of the client (it's shared between the control driver and
 * one or more runtimes); the postgres runtime driver's `close()` calls
 * `client.end()` on its bound client, which would otherwise tear down
 * the shared connection mid-test.
 */
function makeBorrowedPgClient(real: Client): Client {
  return new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'end') {
        return async () => {
          /* borrowed: lifecycle owned by the test target */
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

const buildPostgresRuntime: BuildRuntime = async (driver, contract) => {
  const { client } = getPostgresBinding(driver as PostgresTestDriver);
  const validated = validateContract<typeof contract>(contract, emptyCodecLookup);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: {
      ...postgresDriver,
      create() {
        return postgresDriver.create({ cursor: { disabled: true } });
      },
    },
    extensionPacks: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createExecutionContext({ contract: validated, stack });
  const runtimeDriver = stackInstance.driver!;
  await runtimeDriver.connect({ kind: 'pgClient', client: makeBorrowedPgClient(client) });
  const runtime = createRuntime({
    stackInstance,
    context,
    driver: runtimeDriver,
    verify: { mode: 'onFirstUse', requireMarker: false },
  });
  return {
    db: sqlBuilder({ context }) as Db<typeof contract>,
    runtime,
    dispose: () => runtime.close(),
  };
};

// ---------------------------------------------------------------------------
// Fan-out cases (one per supported SQL target)
// ---------------------------------------------------------------------------

interface CaseSpec {
  readonly name: SqlTargetName;
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous targets dispatched per iteration; helper hides the union
  readonly target: any;
  readonly intCol: ColumnTypeDescriptor;
  readonly textCol: ColumnTypeDescriptor;
  // biome-ignore lint/suspicious/noExplicitAny: pack types differ per target; defineContract is wrapped per-case
  readonly defineContract: (args: { models: any }) => any;
  readonly buildRuntime: BuildRuntime;
}

const cases: readonly CaseSpec[] = [
  {
    name: 'sqlite',
    target: sqliteTestTarget,
    intCol: integerColumn,
    textCol: sqliteTextColumn,
    defineContract: (args) =>
      baseDefineContract({ family: sqlFamilyPack, target: sqlitePack, models: args.models }),
    buildRuntime: buildSqliteRuntime,
  },
  {
    name: 'postgres',
    target: postgresTestTarget,
    intCol: int4Column,
    textCol: pgTextColumn,
    defineContract: (args) =>
      baseDefineContract({ family: sqlFamilyPack, target: postgresPack, models: args.models }),
    buildRuntime: buildPostgresRuntime,
  },
];

// ---------------------------------------------------------------------------
// Manual orchestration (so we can interleave runtime setup with apply steps)
// ---------------------------------------------------------------------------

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);
const emptySqlSchema: SqlSchemaIR = { tables: {}, dependencies: [] };

function stripControlTables(schema: SqlSchemaIR): SqlSchemaIR {
  const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
  for (const [name, tbl] of Object.entries(schema.tables)) {
    if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
  }
  return { ...schema, tables: userTables };
}

function throwIfVerifyFailed(verify: VerifyDatabaseSchemaResult): void {
  if (!verify.ok) {
    const issues = verify.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n');
    throw new Error(`Schema verification failed:\n${issues}`);
  }
}

async function runOneMigration<
  TOrigin extends Contract<SqlStorage>,
  TDestination extends Contract<SqlStorage>,
>(caseSpec: CaseSpec, options: RunMigrationOptions<TOrigin, TDestination>): Promise<void> {
  const { target, buildRuntime } = caseSpec;
  const { driver, cleanup } = await target.setup();
  try {
    let currentSchema = target.emptySchema as SqlSchemaIR;

    if (options.origin !== undefined) {
      await target.applyContract({
        driver,
        currentSchema,
        contract: options.origin,
        fromContract: null,
        policy: undefined,
        isInitial: true,
      });
      currentSchema = (await target.introspect(driver)) as SqlSchemaIR;

      if (options.before !== undefined) {
        const bundle = await buildRuntime(driver, options.origin);
        try {
          await options.before({
            db: bundle.db,
            runtime: bundle.runtime,
            driver: driver as SqlTestDriver,
          });
        } finally {
          await bundle.dispose();
        }
      }
    }

    const applyResult = await target.applyContract({
      driver,
      currentSchema,
      contract: options.destination,
      fromContract: options.origin ?? null,
      policy: options.policy,
      isInitial: false,
    });

    const fresh = (await target.introspect(driver)) as SqlSchemaIR;
    throwIfVerifyFailed(target.verify({ contract: options.destination, schema: fresh }));

    const bundle = await buildRuntime(driver, options.destination);
    try {
      await options.after({
        db: bundle.db,
        runtime: bundle.runtime,
        driver: driver as SqlTestDriver,
        schema: stripControlTables(fresh),
        operationsExecuted: applyResult.operationsExecuted,
        plannedOperationIds: applyResult.plannedOperationIds,
      });
    } finally {
      await bundle.dispose();
    }
  } finally {
    await cleanup();
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fan out a SQL migration scenario across SQLite and Postgres. Generates
 * one `describe` block per target. The body is invoked twice with a
 * per-target context.
 */
export function describeSqlMigration(
  groupName: string,
  body: (ctx: SqlFanoutContext) => void,
): void {
  // Suppress unused-import warning for emptySqlSchema (referenced lazily via
  // target.emptySchema, kept here as a stable fallback if a target ever
  // omits it).
  void emptySqlSchema;
  for (const caseSpec of cases) {
    describe(`${groupName} — ${caseSpec.name}`, () => {
      body({
        name: caseSpec.name,
        int: field.column(caseSpec.intCol),
        text: field.column(caseSpec.textCol),
        integerColumn: caseSpec.intCol,
        textColumn: caseSpec.textCol,
        defineContract: caseSpec.defineContract as DefineSqlContract,
        runMigration: (options) => runOneMigration(caseSpec, options),
      });
    });
  }
}
