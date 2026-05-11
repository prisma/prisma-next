import { int4Column, textColumn as pgTextColumn } from '@prisma-next/adapter-postgres/column-types';
import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import {
  integerColumn as sqliteIntegerColumn,
  textColumn as sqliteTextColumn,
} from '@prisma-next/adapter-sqlite/column-types';
import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import type { Contract } from '@prisma-next/contract/types';
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
  type ContractModelBuilder,
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
import type { Client } from 'pg';
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
 * Any concrete `ContractModelBuilder` instance — what `model('Name', {...})`
 * returns. Used as the constraint on `Models` for the per-target
 * `defineContract` wrappers, so TypeScript can satisfy baseDefineContract's
 * private `Record<string, ModelLike>` constraint without us having to
 * approximate the private type. `ContractModelBuilder` is exported and is
 * structurally a `ModelLike`.
 */
// biome-ignore lint/suspicious/noExplicitAny: ContractModelBuilder is generic over name/fields/relations/attrs/sql — we accept any concrete instance
export type AnyContractModelBuilder = ContractModelBuilder<any, any, any, any, any>;

/**
 * `defineContract` pre-bound to a target's family/target pack. The
 * `const Models` generic preserves the inferred model/column literal
 * types end-to-end (table keys, column keys, scalar JS types), so
 * `db.<ModelName>.<col>` works in test bodies with full type checking.
 *
 * The function below provides the sqlite-flavored canonical typing for
 * `DefineSqlContract`. The postgres case's runtime uses a different
 * target pack at execution time, but the model/storage-tables literal
 * shape produced by both is identical at the type level (only codec /
 * native-type details differ, which migration tests don't probe via
 * the DSL).
 */
function sqliteDefineContractTyping<
  const Models extends Record<string, AnyContractModelBuilder>,
>(args: {
  models: Models;
}): ReturnType<
  typeof baseDefineContract<typeof sqlFamilyPack, typeof sqlitePack, Record<never, never>, Models>
> {
  return baseDefineContract({
    family: sqlFamilyPack,
    target: sqlitePack,
    models: args.models,
  });
}
export type DefineSqlContract = typeof sqliteDefineContractTyping;

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
  origin?: TOrigin;
  destination: TDestination;
  policy?: MigrationOperationPolicy;
  /** Optional: runs after origin is applied, typed against origin. */
  before?: (ctx: SqlBeforeContext<TOrigin>) => Promise<void>;
  /** Required: runs after destination is applied + verified, typed against destination. */
  after: (ctx: SqlAfterContext<TDestination>) => Promise<void>;
}

export interface SqlFanoutContext {
  readonly name: SqlTargetName;
  // Typed against sqlite's canonical column types so the resulting
  // `ScalarFieldBuilder<ScalarFieldState<'<codecId>', ...>>` has a
  // literal codecId — without this, `ReturnType<typeof field.column>`
  // (no generic arg) defaults the codecId to `string`, the codec lookup
  // produces `never`, and downstream `db.<Model>.insert({...})` typing
  // collapses to `never` for every column. The postgres case's runtime
  // values use postgres column types but cast to the canonical sqlite
  // typing here; the JS scalar types (number/string/etc.) coincide
  // across both targets for primitives, which is all the DSL needs.
  readonly int: ReturnType<typeof field.column<typeof sqliteIntegerColumn>>;
  readonly text: ReturnType<typeof field.column<typeof sqliteTextColumn>>;
  readonly integerColumn: typeof sqliteIntegerColumn;
  readonly textColumn: typeof sqliteTextColumn;
  // Declared as a method (not a property) so the `const Models` generic
  // is preserved through call-site inference. As a property, TS would
  // widen Models when reading the property value at the call site.
  defineContract<const Models extends Record<string, AnyContractModelBuilder>>(args: {
    models: Models;
  }): ReturnType<typeof sqliteDefineContractTyping<Models>>;
  runMigration<
    const TOrigin extends Contract<SqlStorage>,
    const TDestination extends Contract<SqlStorage>,
  >(options: RunMigrationOptions<TOrigin, TDestination>): Promise<void>;
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
  // Typed against sqlite's canonical column descriptors so SqlFanoutContext
  // can expose `int` and `text` with literal codecIds (without which the
  // JS scalar lookup at `db.<Model>.insert({...})` collapses to `never`).
  // The postgres case provides its concrete column descriptor at runtime
  // (different codecId) but typed to match the canonical sqlite shape.
  readonly intCol: typeof sqliteIntegerColumn;
  readonly textCol: typeof sqliteTextColumn;
  readonly defineContract: DefineSqlContract;
  readonly buildRuntime: BuildRuntime;
}

// Sqlite's defineContract uses sqlite pack; postgres uses postgres pack
// at runtime. Both share the canonical `DefineSqlContract` signature —
// model/storage-tables literal structure is identical between targets
// at the type level. The postgres impl casts to the canonical type
// because TypeScript treats the two return types as distinct (different
// Target generic instantiation), but they're structurally compatible
// for the DSL surface (table keys, column keys, scalar JS types) which
// is what test bodies use.
const sqliteDefineContract: DefineSqlContract = <
  const Models extends Record<string, AnyContractModelBuilder>,
>(args: {
  models: Models;
}) => baseDefineContract({ family: sqlFamilyPack, target: sqlitePack, models: args.models });

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

const cases: readonly CaseSpec[] = [
  {
    name: 'sqlite',
    target: sqliteTestTarget,
    intCol: sqliteIntegerColumn,
    textCol: sqliteTextColumn,
    defineContract: sqliteDefineContract,
    buildRuntime: buildSqliteRuntime,
  },
  {
    name: 'postgres',
    target: postgresTestTarget,
    // Cast: postgres's int4Column has codecId 'pg/int4@1' but the
    // canonical typing is sqlite's. JS-scalar resolution coincides (both
    // resolve to `number` for the DSL).
    intCol: int4Column as unknown as typeof sqliteIntegerColumn,
    textCol: pgTextColumn as unknown as typeof sqliteTextColumn,
    defineContract: postgresDefineContract,
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
  const TOrigin extends Contract<SqlStorage>,
  const TDestination extends Contract<SqlStorage>,
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
      // Method shorthand (`defineContract(args) { ... }` / `runMigration(opts) { ... }`)
      // is important: the SqlFanoutContext interface declares both as
      // generic methods. If we assigned arrow-function values here
      // instead, TypeScript would erase the `const` generic and the
      // caller would see widened types (Models → Record<string, never>,
      // column JS types → never).
      // Why a generic function expression rather than an arrow or method
      // shorthand: the SqlFanoutContext interface declares `runMigration`
      // with `const TOrigin, const TDestination` generics so the call
      // site preserves inferred contract types (so `db.User.insert(...)`
      // sees real column JS types instead of `never`). An arrow function
      // value assigned to that slot would erase the const generics; a
      // named generic function expression assigned to the slot keeps
      // them.
      const runMigrationForCase = function runMigration<
        const TOrigin extends Contract<SqlStorage>,
        const TDestination extends Contract<SqlStorage>,
      >(options: RunMigrationOptions<TOrigin, TDestination>): Promise<void> {
        return runOneMigration(caseSpec, options);
      };
      const ctx: SqlFanoutContext = {
        name: caseSpec.name,
        int: field.column(caseSpec.intCol),
        text: field.column(caseSpec.textCol),
        integerColumn: caseSpec.intCol,
        textColumn: caseSpec.textCol,
        defineContract: caseSpec.defineContract,
        runMigration: runMigrationForCase,
      };
      body(ctx);
    });
  }
}
