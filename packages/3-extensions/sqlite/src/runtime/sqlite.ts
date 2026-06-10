import sqliteAdapter from '@prisma-next/adapter-sqlite/runtime';
import { buildNamespacedEnums, type NamespacedEnums } from '@prisma-next/contract/enum-accessor';
import type { Contract } from '@prisma-next/contract/types';
import type { SqliteBinding } from '@prisma-next/driver-sqlite/runtime';
import sqliteDriver from '@prisma-next/driver-sqlite/runtime';
import { SqlContractSerializer } from '@prisma-next/family-sql/ir';
import { instantiateExecutionStack } from '@prisma-next/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@prisma-next/framework-components/ir';
import { sql as sqlBuilder } from '@prisma-next/sql-builder/runtime';
import type { Db } from '@prisma-next/sql-builder/types';
import type { ExtractCodecTypes, SqlStorage } from '@prisma-next/sql-contract/types';
import { orm as ormBuilder } from '@prisma-next/sql-orm-client';
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
import sqliteTarget from '@prisma-next/target-sqlite/runtime';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import { ifDefined } from '@prisma-next/utils/defined';
import { resolveOptionalSqliteBinding, resolveSqliteBinding } from './binding';

export type SqliteTargetId = 'sqlite';
type OrmClient<TContract extends Contract<SqlStorage>> = ReturnType<typeof ormBuilder<TContract>>;

type UnboundSql<TContract extends Contract<SqlStorage>> =
  Db<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundOrm<TContract extends Contract<SqlStorage>> =
  OrmClient<TContract>[typeof UNBOUND_NAMESPACE_ID];
type UnboundEnums<TContract extends Contract<SqlStorage>> =
  NamespacedEnums<TContract>[typeof UNBOUND_NAMESPACE_ID];

function unboundNamespace<T>(builderOutput: { readonly [UNBOUND_NAMESPACE_ID]?: unknown }): T {
  return blindCast<T, 'the unbound namespace always exists on a sqlite builder output'>(
    builderOutput[UNBOUND_NAMESPACE_ID],
  );
}

export interface SqliteTransactionContext<TContract extends Contract<SqlStorage>>
  extends TransactionContext {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: UnboundEnums<TContract>;
}

export interface SqliteClient<TContract extends Contract<SqlStorage>> {
  readonly sql: UnboundSql<TContract>;
  readonly orm: UnboundOrm<TContract>;
  readonly enums: UnboundEnums<TContract>;
  readonly raw: RawSqlTag;
  readonly context: ExecutionContext<TContract>;
  readonly stack: SqlExecutionStackWithDriver<SqliteTargetId>;
  connect(bindingInput?: { readonly path: string }): Promise<Runtime>;
  runtime(): Runtime;
  prepare<
    D extends Declaration<CT>,
    Row,
    CT extends CodecTypesBase = ExtractCodecTypes<TContract> & CodecTypesBase,
  >(
    declaration: D,
    callback: (sql: UnboundSql<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
  ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>>;
  transaction<R>(fn: (tx: SqliteTransactionContext<TContract>) => PromiseLike<R>): Promise<R>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}

export interface SqliteOptionsBase {
  readonly extensions?: readonly SqlRuntimeExtensionDescriptor<SqliteTargetId>[];
  readonly middleware?: readonly SqlMiddleware[];
  readonly verifyMarker?: VerifyMarkerOption;
}

export type SqliteOptionsWithContract<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
} & SqliteOptionsBase & {
    readonly contract: TContract;
    readonly contractJson?: never;
  };

export type SqliteOptionsWithContractJson<TContract extends Contract<SqlStorage>> = {
  readonly path?: string;
  readonly _contract?: TContract;
} & SqliteOptionsBase & {
    readonly contractJson: unknown;
    readonly contract?: never;
  };

export type SqliteOptions<TContract extends Contract<SqlStorage>> =
  | SqliteOptionsWithContract<TContract>
  | SqliteOptionsWithContractJson<TContract>;

function resolveContract<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): TContract {
  const contractInput =
    'contractJson' in options && options.contractJson !== undefined
      ? options.contractJson
      : (options as SqliteOptionsWithContract<TContract>).contract;
  return new SqlContractSerializer().deserializeContract(contractInput) as TContract;
}

export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContract<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptionsWithContractJson<TContract>,
): SqliteClient<TContract>;
export default function sqlite<TContract extends Contract<SqlStorage>>(
  options: SqliteOptions<TContract>,
): SqliteClient<TContract> {
  const contract = resolveContract(options);
  let binding = resolveOptionalSqliteBinding(options);
  const stack = createSqlExecutionStack({
    target: sqliteTarget,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensionPacks: options.extensions ?? [],
  });

  const context = createExecutionContext({
    contract,
    stack,
  });

  const rawCodecInferer = stack.adapter.rawCodecInferer;
  const rawSqlTag: RawSqlTag = createRawSql(rawCodecInferer);

  const sql: UnboundSql<TContract> = unboundNamespace(
    sqlBuilder<TContract>({ context, rawCodecInferer }),
  );
  const enums: UnboundEnums<TContract> = unboundNamespace(
    Object.freeze(buildNamespacedEnums(contract.domain)),
  );
  let runtimeInstance: Runtime | undefined;
  let runtimeDriver: { connect(binding: unknown): Promise<void> } | undefined;
  let driverConnected = false;
  let connectPromise: Promise<void> | undefined;
  let closePromise: Promise<void> | undefined;
  let backgroundConnectError: unknown;
  let closed = false;
  let ownedDispose: (() => Promise<void>) | undefined;

  const connectDriver = async (resolvedBinding: SqliteBinding): Promise<void> => {
    if (driverConnected) return;
    if (!runtimeDriver) throw new Error('SQLite runtime driver missing');
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
      throw new Error('SQLite client is closed');
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
    ownedDispose = () => driver.close();
    runtimeDriver = driver;
    if (binding !== undefined) {
      void connectDriver(binding).catch(() => undefined);
    }

    runtimeInstance = createRuntime({
      stackInstance,
      context,
      driver,
      ...ifDefined('verifyMarker', options.verifyMarker),
      ...(options.middleware ? { middleware: options.middleware } : {}),
    });

    return runtimeInstance;
  };

  const orm: UnboundOrm<TContract> = unboundNamespace(
    ormBuilder({
      context,
      runtime: {
        execute(plan) {
          return getRuntime().execute(plan);
        },
        connection() {
          return getRuntime().connection();
        },
      },
    }),
  );

  return {
    sql,
    orm,
    enums,
    raw: rawSqlTag,
    context,
    stack,
    async connect(bindingInput) {
      if (closed) {
        throw new Error('SQLite client is closed');
      }

      if (driverConnected || connectPromise) {
        throw new Error('SQLite client already connected');
      }

      backgroundConnectError = undefined;

      if (bindingInput !== undefined) {
        binding = resolveSqliteBinding(bindingInput);
      }

      if (binding === undefined) {
        throw new Error(
          'SQLite binding not configured. Pass path to sqlite(...) or call db.connect({ path }).',
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
      callback: (sql: UnboundSql<TContract>, params: BindSiteParams<D>) => SqlQueryPlan<Row>,
    ): Promise<PreparedStatement<ParamsFromDeclaration<D, CT>, Row>> {
      return getRuntime().prepare<D, Row, CT>(declaration, (params) => callback(sql, params));
    },

    transaction<R>(fn: (tx: SqliteTransactionContext<TContract>) => PromiseLike<R>): Promise<R> {
      let runtime: ReturnType<typeof getRuntime>;
      try {
        runtime = getRuntime();
      } catch (err) {
        return Promise.reject(err);
      }
      return withTransaction(runtime, (txCtx) => {
        const txSql: UnboundSql<TContract> = unboundNamespace(
          sqlBuilder<TContract>({
            context,
            rawCodecInferer,
          }),
        );

        const txOrm: UnboundOrm<TContract> = unboundNamespace(
          ormBuilder({
            runtime: {
              execute(plan) {
                return txCtx.execute(plan);
              },
            },
            context,
          }),
        );

        // Use `txCtx` as the prototype instead of spreading it so that live
        // accessors (notably the `invalidated` getter, which reads a closure
        // variable in `withTransaction`) remain wired to the original object.
        // Spreading would evaluate the getter once and freeze its value.
        const tx: SqliteTransactionContext<TContract> = Object.assign(
          castAs<TransactionContext>(Object.create(txCtx)),
          { sql: txSql, orm: txOrm, enums },
        );

        return fn(tx);
      });
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = (async () => {
        await connectPromise?.catch(() => undefined);
        await ownedDispose?.();
      })();
      return closePromise;
    },

    [Symbol.asyncDispose](): Promise<void> {
      return this.close();
    },
  };
}
