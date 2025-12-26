import type { ExecutionPlan } from '@prisma-next/contract/types';
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
  SelectAst,
  SqlDriver,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { decodeRow } from './codecs/decoding';
import { encodeParams } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import { lowerSqlPlan } from './lower-sql-plan';
import type { RuntimeContext } from './sql-context';
import { SqlFamilyAdapter } from './sql-family-adapter';

export interface RuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly context: RuntimeContext<TContract>;
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
  private readonly context: RuntimeContext<TContract>;
  private readonly codecRegistry: CodecRegistry;
  private codecRegistryValidated: boolean;

  constructor(options: RuntimeOptions<TContract>) {
    const { context, driver, verify, plugins, mode, log } = options;
    this.contract = context.contract;
    this.context = context;
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
      ...(mode !== undefined ? { mode } : {}),
      ...(log !== undefined ? { log } : {}),
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

    // Check if plan is SqlQueryPlan (has ast but no sql)
    const isSqlQueryPlan = (p: ExecutionPlan<Row> | SqlQueryPlan<Row>): p is SqlQueryPlan<Row> => {
      return 'ast' in p && !('sql' in p);
    };

    // Lower SqlQueryPlan to Plan if needed
    const executablePlan: ExecutionPlan<Row> = isSqlQueryPlan(plan)
      ? lowerSqlPlan(this.context, plan)
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

export function createRuntime<TContract extends SqlContract<SqlStorage>>(
  options: RuntimeOptions<TContract>,
): Runtime {
  return new SqlRuntimeImpl(options);
}
