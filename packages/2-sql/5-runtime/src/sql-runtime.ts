import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { ExecutionStackInstance } from '@prisma-next/core-execution-plane/stack';
import type { RuntimeDriverInstance } from '@prisma-next/core-execution-plane/types';
import type { OperationRegistry } from '@prisma-next/operations';
import type {
  Log,
  Plugin,
  RuntimeCore,
  RuntimeCoreOptions,
  RuntimeTelemetryEvent,
  RuntimeVerifyOptions,
  TelemetryOutcome,
} from '@prisma-next/runtime-executor';
import { AsyncIterableResult, createRuntimeCore } from '@prisma-next/runtime-executor';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  Adapter,
  CodecRegistry,
  LoweredStatement,
  QueryAst,
  SelectAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import { decodeRow } from './codecs/decoding';
import { encodeParams } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { lowerSqlPlan } from './lower-sql-plan';
import type {
  ExecutionContext,
  SqlRuntimeAdapterInstance,
  SqlRuntimeExtensionInstance,
} from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';

export interface RuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver<unknown>;
  readonly verify: RuntimeVerifyOptions;
  readonly plugins?: readonly Plugin<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver<unknown>
  >[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface CreateRuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
  TTargetId extends string = string,
> {
  readonly stackInstance: ExecutionStackInstance<
    'sql',
    TTargetId,
    SqlRuntimeAdapterInstance<TTargetId>,
    RuntimeDriverInstance<'sql', TTargetId>,
    SqlRuntimeExtensionInstance<TTargetId>
  >;
  readonly context: ExecutionContext<TContract>;
  readonly driver: SqlDriver<unknown>;
  readonly verify: RuntimeVerifyOptions;
  readonly plugins?: readonly Plugin<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver<unknown>
  >[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface Runtime extends RuntimeQueryable {
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
  operations(): OperationRegistry;
}

export interface RuntimeConnection extends RuntimeQueryable {
  transaction(): Promise<RuntimeTransaction>;
  release(): Promise<void>;
}

export interface RuntimeTransaction extends RuntimeQueryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface RuntimeQueryable {
  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row>;
}

interface CoreQueryable {
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
}

export type { RuntimeTelemetryEvent, RuntimeVerifyOptions, TelemetryOutcome };

class SqlRuntimeImpl<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>
  implements Runtime
{
  private readonly core: RuntimeCore<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver<unknown>
  >;
  private readonly contract: TContract;
  private readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly codecRegistry: CodecRegistry;
  private codecRegistryValidated: boolean;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, adapter, driver, verify, plugins, mode, log } = options;
    this.contract = context.contract;
    this.adapter = adapter;
    this.codecRegistry = context.codecs;
    this.codecRegistryValidated = false;

    const familyAdapter = new SqlFamilyAdapter(context.contract);

    const coreOptions: RuntimeCoreOptions<
      TContract,
      Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
      SqlDriver<unknown>
    > = {
      familyAdapter,
      driver,
      verify,
      plugins: plugins as readonly Plugin<
        TContract,
        Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
        SqlDriver<unknown>
      >[],
      ...ifDefined('mode', mode),
      ...ifDefined('log', log),
      operationRegistry: context.operations,
    };

    this.core = createRuntimeCore(coreOptions);

    if (verify.mode === 'startup') {
      validateCodecRegistryCompleteness(this.codecRegistry, context.contract);
      this.codecRegistryValidated = true;
    }
  }

  private ensureCodecRegistryValidated(contract: SqlContract<SqlStorage>): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecRegistry, contract);
      this.codecRegistryValidated = true;
    }
  }

  private toExecutionPlan<Row>(plan: ExecutionPlan<Row> | SqlQueryPlan<Row>): ExecutionPlan<Row> {
    const isSqlQueryPlan = (p: ExecutionPlan<Row> | SqlQueryPlan<Row>): p is SqlQueryPlan<Row> => {
      return 'ast' in p && !('sql' in p);
    };

    return isSqlQueryPlan(plan) ? lowerSqlPlan(this.adapter, this.contract, plan) : plan;
  }

  private executeAgainstQueryable<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
    queryable: CoreQueryable,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated(this.contract);
    const executablePlan = this.toExecutionPlan(plan);

    const iterator = async function* (
      self: SqlRuntimeImpl<TContract>,
    ): AsyncGenerator<Row, void, unknown> {
      const encodedParams = encodeParams(executablePlan, self.codecRegistry);
      const planWithEncodedParams: ExecutionPlan<Row> = {
        ...executablePlan,
        params: encodedParams,
      };

      const coreIterator = queryable.execute(planWithEncodedParams);

      for await (const rawRow of coreIterator) {
        const decodedRow = decodeRow(
          rawRow as Record<string, unknown>,
          executablePlan,
          self.codecRegistry,
        );
        yield decodedRow as Row;
      }
    };

    return new AsyncIterableResult(iterator(this));
  }

  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row> {
    return this.executeAgainstQueryable(plan, this.core);
  }

  async connection(): Promise<RuntimeConnection> {
    const coreConn = await this.core.connection();
    const self = this;
    const wrappedConnection: RuntimeConnection = {
      async transaction(): Promise<RuntimeTransaction> {
        const coreTx = await coreConn.transaction();
        return {
          commit: coreTx.commit.bind(coreTx),
          rollback: coreTx.rollback.bind(coreTx),
          execute<Row = Record<string, unknown>>(
            plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
          ): AsyncIterableResult<Row> {
            return self.executeAgainstQueryable(plan, coreTx);
          },
        };
      },
      release: coreConn.release.bind(coreConn),
      execute<Row = Record<string, unknown>>(
        plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
      ): AsyncIterableResult<Row> {
        return self.executeAgainstQueryable(plan, coreConn);
      },
    };
    return wrappedConnection;
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this.core.telemetry();
  }

  operations(): OperationRegistry {
    return this.core.operations();
  }

  close(): Promise<void> {
    return this.core.close();
  }
}

export function createRuntime<TContract extends SqlContract<SqlStorage>, TTargetId extends string>(
  options: CreateRuntimeOptions<TContract, TTargetId>,
): Runtime {
  const { stackInstance, context, driver, verify, plugins, mode, log } = options;

  return new SqlRuntimeImpl({
    context,
    adapter: stackInstance.adapter,
    driver,
    verify,
    ...ifDefined('plugins', plugins),
    ...ifDefined('mode', mode),
    ...ifDefined('log', log),
  });
}
