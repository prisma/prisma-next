import postgresAdapter from '@prisma-next/adapter-postgres/runtime';
import type { Contract } from '@prisma-next/contract/types';
import ppgDriver, { type PpgBinding } from '@prisma-next/driver-ppg-serverless/runtime';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@prisma-next/sql-contract/types';
import { type OrmClient, orm as ormBuilder } from '@prisma-next/sql-orm-client';
import type { CodecTypesBase, RawSqlTag } from '@prisma-next/sql-relational-core/expression';
import { createRawSql } from '@prisma-next/sql-relational-core/expression';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type {
  BindSiteParams,
  Declaration,
  ExecutionContext,
  ParamsFromDeclaration,
  PreparedStatement,
  Runtime,
  SqlExecutionStackWithDriver,
  SqlMiddleware,
  SqlRuntimeExtensionDescriptor,
  TransactionContext,
  VerifyMarkerOption,
} from '@prisma-next/sql-runtime';
import {
  createExecutionContext,
  createRuntime,
  createSqlExecutionStack,
  withTransaction,
} from '@prisma-next/sql-runtime';
import postgresTarget, { PostgresContractSerializer } from '@prisma-next/target-postgres/runtime';
import { blindCast } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';

export type PpgServerlessTargetId = 'postgres';

export interface PrismaPostgresServerlessTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
}

export interface PrismaPostgresServerlessClient<TContract extends Contract<SqlStorage>> {
  readonly sql: Db<TContract>;
  readonly orm: OrmClient<TContract>;
  readonly raw: RawSqlTag;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<PpgServerlessTargetId>;
  connect(binding?: PpgBinding): Promise<Runtime>;
  runtime(): Runtime;
  transaction<R>(
    fn: (tx: PrismaPostgresServerlessTransactionContext<TContract>) => PromiseLike<R>,
  ): Promise<R>;
  prepare<
    D extends Declaration<CT>,
    Row,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
  >(
    declaration: D,
    callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface PrismaPostgresServerlessOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<PpgServerlessTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}

export interface PrismaPostgresServerlessBindingOptions {
  readonly binding?: PpgBinding;
}

export type PrismaPostgresServerlessOptionsWithContract<TContract extends Contract<SqlStorage>> =
  PrismaPostgresServerlessBindingOptions &
    PrismaPostgresServerlessOptionsBase & {
      readonly contract: TContract;
      readonly contractJson?: never;
    };

export type PrismaPostgresServerlessOptionsWithContractJson<
  TContract extends Contract<SqlStorage>,
> = PrismaPostgresServerlessBindingOptions &
  PrismaPostgresServerlessOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
    readonly _contract?: TContract;
  };

export type PrismaPostgresServerlessOptions<TContract extends Contract<SqlStorage>> =
  | PrismaPostgresServerlessOptionsWithContract<TContract>
  | PrismaPostgresServerlessOptionsWithContractJson<TContract>;

function hasContractJson<TContract extends Contract<SqlStorage>>(
  options: PrismaPostgresServerlessOptions<TContract>,
): options is PrismaPostgresServerlessOptionsWithContractJson<TContract> {
  return 'contractJson' in options;
}

const contractSerializer = new PostgresContractSerializer();

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: PrismaPostgresServerlessOptions<TContract>,
): TContract {
  const contractInput = hasContractJson(options) ? options.contractJson : options.contract;
  return blindCast<
    TContract,
    'the contract serializer returns the generic Contract<SqlStorage> base shape; the caller asserts (via the TContract type parameter) that the deserialised contract matches their literal model schema. The runtime values are unchanged; the cast only widens the public-surface type back to the caller-supplied generic.'
  >(contractSerializer.deserializeContract(contractInput));
}

/**
 * Lazy Prisma Postgres serverless client. The `sql` / `orm` / `context` /
 * `stack` surfaces are available synchronously; the driver and runtime are
 * instantiated on first `runtime()` / `connect()` call.
 */
export default function prismaPostgresServerless<TContract extends Contract<SqlStorage>>(
  options: PrismaPostgresServerlessOptionsWithContract<TContract>,
): PrismaPostgresServerlessClient<TContract>;
export default function prismaPostgresServerless<TContract extends Contract<SqlStorage>>(
  options: PrismaPostgresServerlessOptionsWithContractJson<TContract>,
): PrismaPostgresServerlessClient<TContract>;
export default function prismaPostgresServerless<TContract extends Contract<SqlStorage>>(
  options: PrismaPostgresServerlessOptions<TContract>,
): PrismaPostgresServerlessClient<TContract> {
  const contract = resolveContract(options);
  let binding = options.binding;
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: ppgDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const rawCodecInferer = stack.adapter.rawCodecInferer;
  const rawSqlTag: RawSqlTag = createRawSql(rawCodecInferer);

  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;

  const connectDriver = async (resolvedBinding: PpgBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new Error('Prisma Postgres runtime driver missing');
    if (connectPromise) return connectPromise;
    connectPromise = runtimeDriver
      .connect(resolvedBinding)
      .then(() => {
        driverConnected = true;
      })
      .catch((err) => {
        backgroundConnectError = err;
        connectPromise = undefined;
        throw err;
      });
    return connectPromise;
  };
  const getRuntime = (): Runtime => {
    if (closed) {
      throw new Error('Prisma Postgres serverless client is closed');
    }

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

    const driver = driverDescriptor.create();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = createRuntime({
      stackInstance,
      context,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...ifDefined('middleware', options.middleware),
    });

    return runtimeInstance;
  };
  const orm: OrmClient<TContract> = ormBuilder({
    runtime: {
      execute(plan) {
        return getRuntime().execute(plan);
      },
      connection() {
        return getRuntime().connection();
      },
    },
    context,
  });

  const sql: Db<TContract> = sqlBuilder<TContract>({ context, rawCodecInferer });

  return {
    sql,
    orm,
    raw: rawSqlTag,
    context,
    stack,

    async connect(bindingInput) {
      if (closed) {
        throw new Error('Prisma Postgres serverless client is closed');
      }

      if (driverConnected || connectPromise) {
        throw new Error('Prisma Postgres serverless client already connected');
      }

      if (bindingInput !== undefined) {
        binding = bindingInput;
      }

      if (binding === undefined) {
        throw new Error(
          'Prisma Postgres serverless binding not configured. Pass binding to runtime(...) or call db.connect(binding).',
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

    prepare<
      D extends Declaration<CT>,
      Row,
      CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
    >(
      declaration: D,
      callback: (sql: Db<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    transaction<R>(
      fn: (tx: PrismaPostgresServerlessTransactionContext<TContract>) => PromiseLike<R>,
    ): Promise<R> {
      return withTransaction(getRuntime(), (txCtx) => {
        const txSql: Db<TContract> = sqlBuilder<TContract>({
          context,
          rawCodecInferer,
        });

        const txOrm: OrmClient<TContract> = ormBuilder({
          runtime: {
            execute(plan) {
              return txCtx.execute(plan);
            },
          },
          context,
        });

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: PrismaPostgresServerlessTransactionContext<TContract> = Object.assign(
          blindCast<
            TransactionContext,
            'Object.create(txCtx) returns the prototype-only sibling; the sibling structurally is a TransactionContext (the prototype carries the live accessors) but TS sees it as the wider Object return type'
          >(Object.create(txCtx)),
          { sql: txSql, orm: txOrm },
        );

        return fn(tx);
      });
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // Swallow a still-pending connect failure: the caller has signalled
      // they are done, and the error was either already surfaced via
      // `runtime()` or never observed.
      await connectPromise?.catch(() => undefined);
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
