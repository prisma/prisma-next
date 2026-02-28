import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@prisma-next/core-execution-plane/stack';
import postgresDriver from '@prisma-next/driver-postgres/runtime';
import type { KyselifyContract } from '@prisma-next/integration-kysely';
import type {
  ExtractCodecTypes,
  ExtractOperationTypes,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import { buildKyselyPlan, REDACTED_SQL } from '@prisma-next/sql-kysely-lane';
import type { SelectBuilder } from '@prisma-next/sql-lane';
import { sql as sqlBuilder } from '@prisma-next/sql-lane';
import { orm as ormBuilder } from '@prisma-next/sql-orm-client';
import type { SchemaHandle } from '@prisma-next/sql-relational-core/schema';
import { schema as schemaBuilder } from '@prisma-next/sql-relational-core/schema';
import type {
  OperationTypeSignature,
  OperationTypes,
} from '@prisma-next/sql-relational-core/types';
import type {
  ExecutionContext,
  Plugin,
  Runtime,
  RuntimeVerifyOptions,
  SqlExecutionStackWithDriver,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
} from '@prisma-next/sql-runtime';
import postgresTarget from '@prisma-next/target-postgres/runtime';
import type {
  CompiledQuery,
  DatabaseConnection,
  DatabaseIntrospector,
  DatabaseMetadata,
  Dialect,
  Driver,
  Kysely,
  QueryCompiler,
  TransactionSettings,
} from 'kysely';
import { Kysely as KyselyClient, PostgresAdapter, PostgresQueryCompiler } from 'kysely';
import { type Client, Pool } from 'pg';
import {
  type PostgresBinding,
  type PostgresBindingInput,
  resolveOptionalPostgresBinding,
  resolvePostgresBinding,
} from './binding';

type NormalizeOperationTypes<T> = {
  [TypeId in keyof T]: {
    [Method in keyof T[TypeId]]: T[TypeId][Method] extends OperationTypeSignature
      ? T[TypeId][Method]
      : OperationTypeSignature;
  };
};

type ToSchemaOperationTypes<T> = T extends OperationTypes ? T : NormalizeOperationTypes<T>;

export type PostgresTargetId = 'postgres';
type OrmClient<TContract extends SqlContract<SqlStorage>> = ReturnType<
  typeof ormBuilder<TContract>
>;

type ExecutionMethodName =
  | `execute${string}`
  | `stream${string}`
  | 'transaction'
  | 'connection'
  | 'destroy';
type StripKyselyExecutionMethods<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => StripKyselyExecutionMethods<Result>
  : T extends object
    ? {
        [K in keyof T as K extends string
          ? K extends ExecutionMethodName
            ? never
            : K
          : K]: StripKyselyExecutionMethods<T[K]>;
      }
    : T;

export type BuildOnlyKysely<DB> = StripKyselyExecutionMethods<Kysely<DB>> & {
  build<Row>(query: {
    compile(): unknown;
  }): import('@prisma-next/sql-relational-core/plan').SqlQueryPlan<Row>;
  readonly redactedSql: string;
};

const BUILD_ONLY_EXECUTION_MESSAGE =
  'Kysely execution is disabled for db.kysely (build-only surface). Build a plan with db.kysely.build(query) and execute it through runtime.';

class BuildOnlyKyselyDriver implements Driver {
  async init(): Promise<void> {}
  async destroy(): Promise<void> {}
  async acquireConnection(): Promise<DatabaseConnection> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async beginTransaction(
    _connection: DatabaseConnection,
    _settings: TransactionSettings,
  ): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async commitTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async rollbackTransaction(_connection: DatabaseConnection): Promise<void> {
    throw new Error(BUILD_ONLY_EXECUTION_MESSAGE);
  }
  async releaseConnection(_connection: DatabaseConnection): Promise<void> {}
}

class RedactingPostgresQueryCompiler implements QueryCompiler {
  readonly #compiler = new PostgresQueryCompiler();
  compileQuery(
    ...args: Parameters<PostgresQueryCompiler['compileQuery']>
  ): ReturnType<PostgresQueryCompiler['compileQuery']> {
    const [node, queryId] = args;
    const compiled = this.#compiler.compileQuery(node, queryId);
    return {
      ...compiled,
      sql: REDACTED_SQL,
    };
  }
}

class BuildOnlyPostgresDialect implements Dialect {
  createAdapter = () => new PostgresAdapter();
  createDriver = () => new BuildOnlyKyselyDriver();
  createIntrospector = (): DatabaseIntrospector => {
    const msg =
      'Introspection is not supported on the build-only Kysely dialect. Use the runtime schema API instead.';
    return {
      getSchemas: async () => {
        throw new Error(msg);
      },
      getTables: async () => {
        throw new Error(msg);
      },
      getMetadata: async (): Promise<DatabaseMetadata> => {
        throw new Error(msg);
      },
    };
  };
  createQueryCompiler = () => new RedactingPostgresQueryCompiler();
}

function createBuildOnlyKysely<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
): BuildOnlyKysely<KyselifyContract<TContract>> {
  const base = new KyselyClient<KyselifyContract<TContract>>({
    dialect: new BuildOnlyPostgresDialect(),
  });
  const buildOnly = base as unknown as BuildOnlyKysely<KyselifyContract<TContract>>;
  Object.defineProperty(buildOnly, 'build', {
    value: <Row>(query: { compile(): unknown }) =>
      buildKyselyPlan(contract, query.compile() as CompiledQuery<Row>, { lane: 'kysely' }),
    enumerable: false,
    configurable: false,
    writable: false,
  });
  Object.defineProperty(buildOnly, 'redactedSql', {
    value: REDACTED_SQL,
    enumerable: true,
    configurable: false,
    writable: false,
  });
  return buildOnly;
}

export interface PostgresClient<TContract extends SqlContract<SqlStorage>> {
  readonly sql: SelectBuilder<
    TContract,
    unknown,
    ExtractCodecTypes<TContract>,
    ExtractOperationTypes<TContract>
  >;
  readonly kysely: BuildOnlyKysely<KyselifyContract<TContract>>;
  readonly schema: SchemaHandle<
    TContract,
    ExtractCodecTypes<TContract>,
    ToSchemaOperationTypes<ExtractOperationTypes<TContract>>
  >;
  readonly orm: OrmClient<TContract>;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PostgresTargetId>;
  connect(bindingInput?: PostgresBindingInput): Promise<Runtime>;
  runtime(): Runtime;
}

export interface PostgresOptionsBase<TContract extends SqlContract<SqlStorage>> {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PostgresTargetId>[];
  readonly plugins?: readonly Plugin<TContract>[];
  readonly verify?: RuntimeVerifyOptions;
  readonly poolOptions?: {
    readonly connectionTimeoutMillis?: number;
    readonly idleTimeoutMillis?: number;
  };
}

export interface PostgresBindingOptions {
  readonly binding?: PostgresBinding;
  readonly url?: string;
  readonly pg?: Pool | Client;
}

export type PostgresOptionsWithContract<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase<TContract> & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PostgresOptionsWithContractJson<TContract extends SqlContract<SqlStorage>> =
  PostgresBindingOptions &
    PostgresOptionsBase<TContract> & {
      readonly contractJson: unknown;
      readonly contract?: never;
    };

export type PostgresOptions<TContract extends SqlContract<SqlStorage>> =
  | PostgresOptionsWithContract<TContract>
  | PostgresOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): options is PostgresOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

function resolveContract<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return validateContract<TContract>(contractInput);
}

function toRuntimeBinding<TContract extends SqlContract<SqlStorage>>(
  binding: PostgresBinding,
  options: PostgresOptions<TContract>,
) {
  if (binding.kind !== 'url') {
    return binding;
  }

  return {
    kind: 'pgPool',
    pool: new Pool({
      connectionString: binding.url,
      connectionTimeoutMillis: options.poolOptions?.connectionTimeoutMillis ?? 20_000,
      idleTimeoutMillis: options.poolOptions?.idleTimeoutMillis ?? 30_000,
    }),
  } as const;
}

/**
 * Creates a lazy Postgres client from either `contractJson` or a TypeScript-authored `contract`.
 * Static query surfaces are available immediately, while `runtime()` instantiates the driver/pool on first call.
 */
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContract<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptionsWithContractJson<TContract>,
): PostgresClient<TContract>;
export default function postgres<TContract extends SqlContract<SqlStorage>>(
  options: PostgresOptions<TContract>,
): PostgresClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalPostgresBinding(options);
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const schema: PostgresClient<TContract>['schema'] = schemaBuilder(context);
  const sql = sqlBuilder({ context });
  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  const connectDriver = async (resolvedBinding: PostgresBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new Error('Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    const runtimeBinding = toRuntimeBinding(resolvedBinding, options);
    connectPromise = runtimeDriver
      .connect(runtimeBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch(async (err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        if (resolvedBinding.kind === 'url' && runtimeBinding.kind === 'pgPool') {
          await runtimeBinding.pool.end().catch(() => undefined);
        }
        throw err;
      });
    return connectPromise;
  };
  const getRuntime = (): Runtime => {
    if (backgroundConnectError !== undefined) {
      throw backgroundConnectError;
    }

    if (runtimeInstance) {
      return runtimeInstance;
    }

    const stackInstance = instantiateExecutionStack(stack);
    const driverDescriptor = stack.driver;
    if (!driverDescriptor) {
      throw new Error('Driver descriptor missing from execution stack');
    }

    const driver = driverDescriptor.create({
      cursor: { disabled: true },
    });
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = createRuntime({
      stackInstance,
      context,
      driver,
      verify: options.verify ?? { mode: 'onFirstUse', requireMarker: false },
      ...(options.plugins ? { plugins: options.plugins } : {}),
    });

    return runtimeInstance;
  };
  const orm: OrmClient<TContract> = ormBuilder({
    contract,
    runtime: {
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
  });

  return {
    sql,
    kysely: createBuildOnlyKysely(contract),
    schema,
    orm,
    context,
    stack,
    async connect(bindingInput) {
      if (driverConnected || connectPromise) {
        throw new Error('Postgres client already connected');
      }

      if (bindingInput !== undefined) {
        binding = resolvePostgresBinding(bindingInput);
      }

      if (binding === undefined) {
        throw new Error(
          'Postgres binding not configured. Pass url/pg/binding to postgres(...) or call db.connect({ ... }).',
        );
      }

      const runtime = getRuntime();
      if (driverConnected) {
        return runtime;
      }

      await connectDriver(binding);
      return runtime;
    },
    runtime() {
      return getRuntime();
    },
  };
}
