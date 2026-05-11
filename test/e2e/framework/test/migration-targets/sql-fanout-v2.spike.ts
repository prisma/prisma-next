/**
 * SQL fan-out v2 — spike.
 *
 * Differences from the production `sql-fanout.ts`:
 *
 * 1. A typed `sqlTargetRegistry` object is the source of truth for
 *    every per-target config (pack, test target adapter, runtime
 *    builder, defineContract impl). Adding a new SQL target = one
 *    entry. `SqlTargetName` is derived from `keyof typeof sqlTargetRegistry`.
 *
 * 2. Columns are NOT hardcoded into the interface. A `commonSqlCols`
 *    module-level constant carries the shared baseline (int, text, …);
 *    tests that need more columns pass them as an `extras` arg.
 *    Adding a new column type = either extend the module constant
 *    (one place) or pass it inline in the test that needs it.
 *
 * 3. `describeSqlMigration` has two overloads:
 *      describeSqlMigration(name, body)                       // common cols only
 *      describeSqlMigration(name, extras, body)               // common ∪ extras
 *
 * Existing production `sql-fanout.ts` is untouched. If this spike
 * proves out, we replace `sql-fanout.ts` with this shape and migrate
 * the four existing migration test files (mechanical: drop the
 * destructured int/text/integerColumn/textColumn).
 */

import {
  int4Column,
  textColumn as pgTextColumn,
  timestamptzColumn as pgTimestamptzColumn,
} from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import {
  datetimeColumn as sqliteDatetimeColumn,
  integerColumn as sqliteIntegerColumn,
  textColumn as sqliteTextColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
import type { ColumnTypeDescriptor } from '@prisma-next/contract-authoring';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import sqlFamilyPack from '@prisma-next/family-sql/pack';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type { MigrationOperationPolicy } from '@prisma-next/framework-components/control';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  defineContract as baseDefineContract,
  type ContractModelBuilder,
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
import type { VerifyDatabaseSchemaResultLike } from '@prisma-next/test-utils/migration-harness';
import type { Client } from 'pg';
import { describe } from 'vitest';
import { getPostgresBinding, type PostgresTestDriver, postgresTestTarget } from './postgres';
import { getSqlitePath, type SqliteTestDriver, sqliteTestTarget } from './sqlite';

// ---------------------------------------------------------------------------
// 1. Target registry — the source of truth
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: ContractModelBuilder is generic; we accept any concrete instance
export type AnyContractModelBuilder = ContractModelBuilder<any, any, any, any, any>;

/**
 * Structural common shape over SqliteTestDriver and PostgresTestDriver.
 * Both targets' test drivers accept `?`-style placeholders.
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

/**
 * Shape of one target's config. `pack` is the family + target pack used
 * to build contracts. `testTarget` is the migration TestTargetAdapter.
 * `buildRuntime` constructs a contract-typed runtime against the case's
 * live database, for the SQL DSL.
 */
interface SqlTargetConfig {
  readonly pack: { readonly family: typeof sqlFamilyPack; readonly target: unknown };
  // biome-ignore lint/suspicious/noExplicitAny: heterogeneous targets are dispatched per iteration
  readonly testTarget: any;
  readonly buildRuntime: <TContract extends Contract<SqlStorage>>(
    driver: SqlTestDriver,
    contract: TContract,
  ) => Promise<{ db: Db<TContract>; runtime: Runtime; dispose: () => Promise<void> }>;
}

/**
 * Wrap a pg.Client so its `end()` is a no-op. The test target owns the
 * real lifecycle of the client; the postgres runtime driver's close()
 * would otherwise tear down the shared connection mid-test.
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

const buildSqliteRuntime: SqlTargetConfig['buildRuntime'] = async (driver, contract) => {
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

const buildPostgresRuntime: SqlTargetConfig['buildRuntime'] = async (driver, contract) => {
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

/**
 * The registry. Adding `mysql` = one new entry; every cols map across
 * the project then must update or the type checker complains.
 */
export const sqlTargetRegistry = {
  sqlite: {
    pack: { family: sqlFamilyPack, target: sqlitePack },
    testTarget: sqliteTestTarget,
    buildRuntime: buildSqliteRuntime,
  },
  postgres: {
    pack: { family: sqlFamilyPack, target: postgresPack },
    testTarget: postgresTestTarget,
    buildRuntime: buildPostgresRuntime,
  },
} as const satisfies Record<string, SqlTargetConfig>;

export type SqlTargetName = keyof typeof sqlTargetRegistry;

// ---------------------------------------------------------------------------
// 2. defineContract — typed against the union of supported target packs
// ---------------------------------------------------------------------------

type SupportedSqlPack = (typeof sqlTargetRegistry)[SqlTargetName]['pack']['target'];

function defineSqlContractTyping<
  const Models extends Record<string, AnyContractModelBuilder>,
>(args: {
  models: Models;
}): ReturnType<
  typeof baseDefineContract<typeof sqlFamilyPack, SupportedSqlPack, Record<never, never>, Models>
> {
  void args;
  throw new Error('typing-only stub — use a per-case `defineContract` implementation');
}
export type DefineSqlContract = typeof defineSqlContractTyping;

const sqliteDefineContract: DefineSqlContract = (<
  const Models extends Record<string, AnyContractModelBuilder>,
>(args: {
  models: Models;
}) =>
  baseDefineContract({
    family: sqlFamilyPack,
    target: sqlitePack,
    models: args.models,
  })) as unknown as DefineSqlContract;

const postgresDefineContract: DefineSqlContract = (<
  const Models extends Record<string, AnyContractModelBuilder>,
>(args: {
  models: Models;
}) =>
  baseDefineContract({
    family: sqlFamilyPack,
    target: postgresPack,
    models: args.models,
  })) as unknown as DefineSqlContract;

const defineContractByTarget: Record<SqlTargetName, DefineSqlContract> = {
  sqlite: sqliteDefineContract,
  postgres: postgresDefineContract,
};

// ---------------------------------------------------------------------------
// 3. Columns — common baseline + per-test extras
// ---------------------------------------------------------------------------

/**
 * Caller-supplied column declarations: per name, per target.
 * Type-checked against `SqlTargetName` — adding a target to the
 * registry forces every column map (common and per-test) to update.
 */
export type SqlColumnsByTarget = Record<string, Record<SqlTargetName, ColumnTypeDescriptor>>;

/**
 * Shared baseline columns. To add a column for use across many tests,
 * extend this constant. Tests can also pass per-test extras (see the
 * three-arg overload of `describeSqlMigration`).
 */
export const commonSqlCols = {
  int: { sqlite: sqliteIntegerColumn, postgres: int4Column },
  text: { sqlite: sqliteTextColumn, postgres: pgTextColumn },
} as const satisfies SqlColumnsByTarget;

/** Per-target resolution: each named column becomes a union over targets. */
type ResolvedCols<TCols extends SqlColumnsByTarget> = {
  [K in keyof TCols]: TCols[K][SqlTargetName];
};

// Example: an extra column descriptor a test might add inline. Not
// part of `commonSqlCols`; tests pass it via the three-arg overload.
// Exported for the spike test file to import without re-declaring it.
export const spikeExtraDatetimeCol = {
  datetime: { sqlite: sqliteDatetimeColumn, postgres: pgTimestamptzColumn },
} as const satisfies SqlColumnsByTarget;

// ---------------------------------------------------------------------------
// 4. Run-migration shape (unchanged from production sql-fanout)
// ---------------------------------------------------------------------------

export interface SqlBeforeContext<TOrigin extends Contract<SqlStorage>> {
  readonly db: Db<TOrigin>;
  readonly runtime: Runtime;
  readonly driver: SqlTestDriver;
}

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
  origin?: TOrigin;
  destination: TDestination;
  policy?: MigrationOperationPolicy;
  before?: (ctx: SqlBeforeContext<TOrigin>) => Promise<void>;
  after: (ctx: SqlAfterContext<TDestination>) => Promise<void>;
}

// ---------------------------------------------------------------------------
// 5. SqlFanoutContext — parameterized over the resolved column set
// ---------------------------------------------------------------------------

export interface SqlFanoutContext<TCols extends SqlColumnsByTarget> {
  readonly name: SqlTargetName;
  readonly cols: ResolvedCols<TCols>;
  defineContract<const Models extends Record<string, AnyContractModelBuilder>>(args: {
    models: Models;
  }): ReturnType<typeof defineSqlContractTyping<Models>>;
  runMigration<
    const TOrigin extends Contract<SqlStorage>,
    const TDestination extends Contract<SqlStorage>,
  >(options: RunMigrationOptions<TOrigin, TDestination>): Promise<void>;
}

// ---------------------------------------------------------------------------
// 6. Manual orchestration
// ---------------------------------------------------------------------------

const CONTROL_TABLES = new Set(['_prisma_marker', '_prisma_ledger']);

function stripControlTables(schema: SqlSchemaIR): SqlSchemaIR {
  const userTables: Record<string, SqlSchemaIR['tables'][string]> = {};
  for (const [name, tbl] of Object.entries(schema.tables)) {
    if (!CONTROL_TABLES.has(name)) userTables[name] = tbl;
  }
  return { ...schema, tables: userTables };
}

function throwIfVerifyFailed(verify: VerifyDatabaseSchemaResultLike): void {
  if (!verify.ok) {
    const issues = verify.schema.issues.map((i) => `  - [${i.kind}] ${i.message}`).join('\n');
    throw new Error(`Schema verification failed:\n${issues}`);
  }
}

async function runOneMigration<
  const TOrigin extends Contract<SqlStorage>,
  const TDestination extends Contract<SqlStorage>,
>(targetName: SqlTargetName, options: RunMigrationOptions<TOrigin, TDestination>): Promise<void> {
  const config = sqlTargetRegistry[targetName];
  // testTarget at this point has the union of sqlite/postgres TestTargetAdapter
  // instantiations (because targetName is the SqlTargetName union); methods
  // on the union narrow incompatible parameter types to `never`. Cast at the
  // boundary — the runtime dispatch by targetName ensures the correct one runs.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const testTarget = config.testTarget as any;
  const { buildRuntime } = config;
  const { driver, cleanup } = await testTarget.setup();
  try {
    let currentSchema = testTarget.emptySchema as SqlSchemaIR;

    if (options.origin !== undefined) {
      await testTarget.applyContract({
        driver,
        currentSchema,
        contract: options.origin,
        fromContract: null,
        policy: undefined,
        isInitial: true,
      });
      currentSchema = (await testTarget.introspect(driver)) as SqlSchemaIR;

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

    const applyResult = await testTarget.applyContract({
      driver,
      currentSchema,
      contract: options.destination,
      fromContract: options.origin ?? null,
      policy: options.policy,
      isInitial: false,
    });

    const fresh = (await testTarget.introspect(driver)) as SqlSchemaIR;
    throwIfVerifyFailed(testTarget.verify({ contract: options.destination, schema: fresh }));

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
// 7. Public API — describeSqlMigration with two overloads
// ---------------------------------------------------------------------------

export function describeSqlMigration(
  groupName: string,
  body: (ctx: SqlFanoutContext<typeof commonSqlCols>) => void,
): void;
export function describeSqlMigration<const TExtra extends SqlColumnsByTarget>(
  groupName: string,
  extras: TExtra,
  body: (ctx: SqlFanoutContext<typeof commonSqlCols & TExtra>) => void,
): void;
export function describeSqlMigration(
  groupName: string,
  // biome-ignore lint/suspicious/noExplicitAny: implementation signature — the public overloads above are the type-safe surface
  bodyOrExtras: any,
  // biome-ignore lint/suspicious/noExplicitAny: implementation signature — the public overloads above are the type-safe surface
  maybeBody?: any,
): void {
  const [extras, body] =
    typeof bodyOrExtras === 'function' ? [{}, bodyOrExtras] : [bodyOrExtras, maybeBody!];

  const cols: SqlColumnsByTarget = { ...commonSqlCols, ...extras };

  for (const targetName of Object.keys(sqlTargetRegistry) as SqlTargetName[]) {
    describe(`${groupName} — ${targetName}`, () => {
      const resolvedCols: Record<string, ColumnTypeDescriptor> = {};
      for (const [colName, byTarget] of Object.entries(cols)) {
        resolvedCols[colName] = byTarget[targetName];
      }
      const ctx: SqlFanoutContext<SqlColumnsByTarget> = {
        name: targetName,
        cols: resolvedCols as ResolvedCols<SqlColumnsByTarget>,
        defineContract: defineContractByTarget[
          targetName
        ] as SqlFanoutContext<SqlColumnsByTarget>['defineContract'],
        runMigration: function runMigration<
          const TOrigin extends Contract<SqlStorage>,
          const TDestination extends Contract<SqlStorage>,
        >(options: RunMigrationOptions<TOrigin, TDestination>): Promise<void> {
          return runOneMigration(targetName, options);
        },
      };
      body(ctx);
    });
  }
}
