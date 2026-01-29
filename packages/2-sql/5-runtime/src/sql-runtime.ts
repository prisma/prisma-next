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
import {
  AsyncIterableResult,
  createRuntimeCore,
  runtimeError,
} from '@prisma-next/runtime-executor';
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
import { assertExecutionStackContractRequirements, createExecutionContext } from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';

export interface RuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly context: ExecutionContext<TContract>;
  readonly adapter: Adapter<QueryAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly plugins?: readonly Plugin<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver
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
  readonly contract: TContract;
  readonly context?: ExecutionContext<TContract>;
  readonly driverOptions?: unknown;
  readonly verify: RuntimeVerifyOptions;
  readonly plugins?: readonly Plugin<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver
  >[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface Runtime {
  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
  operations(): OperationRegistry;
}

export type { RuntimeTelemetryEvent, RuntimeVerifyOptions, TelemetryOutcome };

class SqlRuntimeImpl<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>
  implements Runtime
{
  private readonly core: RuntimeCore<
    TContract,
    Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
    SqlDriver
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
      SqlDriver
    > = {
      familyAdapter,
      driver,
      verify,
      plugins: plugins as readonly Plugin<
        TContract,
        Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>,
        SqlDriver
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

  execute<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row> | SqlQueryPlan<Row>,
  ): AsyncIterableResult<Row> {
    this.ensureCodecRegistryValidated(this.contract);

    const isSqlQueryPlan = (p: ExecutionPlan<Row> | SqlQueryPlan<Row>): p is SqlQueryPlan<Row> => {
      return 'ast' in p && !('sql' in p);
    };

    const executablePlan: ExecutionPlan<Row> = isSqlQueryPlan(plan)
      ? lowerSqlPlan(this.adapter, this.contract, plan)
      : plan;

    const iterator = async function* (
      self: SqlRuntimeImpl<TContract>,
    ): AsyncGenerator<Row, void, unknown> {
      const encodedParams = encodeParams(executablePlan, self.codecRegistry);
      const planWithEncodedParams: ExecutionPlan<Row> = {
        ...executablePlan,
        params: encodedParams,
      };

      const coreIterator = self.core.execute(planWithEncodedParams);

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

function createOfflineDriver(): SqlDriver {
  const missingDriver = () =>
    runtimeError(
      'RUNTIME.DRIVER_MISSING',
      'Runtime created without driver options. Provide driver options to execute queries.',
    );

  return {
    async connect() {
      throw missingDriver();
    },
    async *execute() {
      yield* [];
      throw missingDriver();
    },
    async query() {
      throw missingDriver();
    },
    async close() {},
  };
}

function isSqlDriver(driver: unknown): driver is SqlDriver {
  if (!driver || typeof driver !== 'object') {
    return false;
  }
  const candidate = driver as SqlDriver;
  return (
    typeof candidate.connect === 'function' &&
    typeof candidate.execute === 'function' &&
    typeof candidate.query === 'function' &&
    typeof candidate.close === 'function'
  );
}

export function createRuntime<TContract extends SqlContract<SqlStorage>, TTargetId extends string>(
  options: CreateRuntimeOptions<TContract, TTargetId>,
): Runtime {
  const { stackInstance, contract, context, driverOptions, verify, plugins, mode, log } = options;

  assertExecutionStackContractRequirements(contract, stackInstance.stack);

  const resolvedContext =
    context ??
    createExecutionContext({
      contract,
      stackInstance,
    });

  // NOTE: Driver instantiation is handled here (instead of in instantiateExecutionStack) because
  // runtime drivers currently receive connection information at construction time (need driverOptions).
  //
  // That makes it impossible to instantiate the stack in instantiateExecutionStack() which is a
  // framework domain utility and unaware of the driver connection data structure.
  //
  // That forces this function to juggle offline mode + driverOptions/descriptor mismatches +
  // runtime-shape validation. This will get simpler in TML-1837 once drivers can be instantiated
  // unbound and connected later.
  if (driverOptions !== undefined && !stackInstance.stack.driver) {
    throw runtimeError(
      'RUNTIME.DRIVER_OPTIONS_WITHOUT_DESCRIPTOR',
      'Driver options provided, but the execution stack has no driver descriptor.',
    );
  }

  let driver: SqlDriver;
  if (stackInstance.stack.driver && driverOptions !== undefined) {
    const driverInstance = stackInstance.stack.driver.create(driverOptions);
    if (!isSqlDriver(driverInstance)) {
      throw runtimeError(
        'RUNTIME.INVALID_DRIVER_INSTANCE',
        'Execution stack driver does not implement SqlDriver interface.',
      );
    }
    driver = driverInstance;
  } else {
    driver = createOfflineDriver();
  }

  return new SqlRuntimeImpl({
    context: resolvedContext,
    adapter: stackInstance.adapter,
    driver,
    verify,
    ...ifDefined('plugins', plugins),
    ...ifDefined('mode', mode),
    ...ifDefined('log', log),
  });
}
