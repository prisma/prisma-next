import type { ExecutionPlan } from '@prisma-next/contract/types';
import { AsyncIterableResult, runtimeError } from '@prisma-next/framework-components/runtime';
import { computeSqlFingerprint } from './fingerprint';
import { parseContractMarkerRow } from './marker';
import type { Log, Middleware, MiddlewareContext } from './middleware/types';
import type { RuntimeFamilyAdapter } from './runtime-spi';

export interface RuntimeVerifyOptions {
  readonly mode: 'onFirstUse' | 'startup' | 'always';
  readonly requireMarker: boolean;
}

export type TelemetryOutcome = 'success' | 'runtime-error';

export interface RuntimeTelemetryEvent {
  readonly lane: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly outcome: TelemetryOutcome;
  readonly durationMs?: number;
}

export interface RuntimeCoreOptions<TContract = unknown, TDriver = unknown> {
  readonly familyAdapter: RuntimeFamilyAdapter<TContract>;
  readonly driver: TDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly middlewares?: readonly Middleware<TContract>[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
}

export interface RuntimeCore<TContract = unknown, TDriver = unknown> extends RuntimeQueryable {
  readonly _typeContract?: TContract;
  readonly _typeDriver?: TDriver;
  connection(): Promise<RuntimeConnection>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
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
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row>;
}

interface DriverWithQuery<_TDriver> {
  query(sql: string, params: readonly unknown[]): Promise<{ rows: ReadonlyArray<unknown> }>;
}

interface DriverWithConnection<_TDriver> {
  acquireConnection(): Promise<DriverConnection>;
}

export interface DriverConnection extends Queryable {
  beginTransaction(): Promise<DriverTransaction>;
  release(): Promise<void>;
}

export interface DriverTransaction extends Queryable {
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

export interface Queryable {
  execute<Row = Record<string, unknown>>(options: {
    sql: string;
    params: readonly unknown[];
  }): AsyncIterable<Row>;
}

interface DriverWithClose<_TDriver> {
  close(): Promise<void>;
}

class RuntimeCoreImpl<TContract = unknown, TDriver = unknown>
  implements RuntimeCore<TContract, TDriver>
{
  readonly _typeContract?: TContract;
  readonly _typeDriver?: TDriver;
  private readonly contract: TContract;
  private readonly familyAdapter: RuntimeFamilyAdapter<TContract>;
  private readonly driver: TDriver;
  private readonly middlewares: readonly Middleware<TContract>[];
  private readonly mode: 'strict' | 'permissive';
  private readonly verify: RuntimeVerifyOptions;
  private readonly middlewareContext: MiddlewareContext<TContract>;

  private verified: boolean;
  private startupVerified: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeCoreOptions<TContract, TDriver>) {
    const { familyAdapter, driver } = options;
    this.contract = familyAdapter.contract;
    this.familyAdapter = familyAdapter;
    this.driver = driver;
    this.middlewares = options.middlewares ?? [];
    this.mode = options.mode ?? 'strict';
    this.verify = options.verify;
    this.verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
    this.startupVerified = false;
    this._telemetry = null;

    this.middlewareContext = {
      contract: this.contract,
      mode: this.mode,
      now: () => Date.now(),
      log: options.log ?? {
        info: () => {},
        warn: () => {},
        error: () => {},
      },
    };
  }

  private async verifyPlanIfNeeded(_plan: ExecutionPlan): Promise<void> {
    void _plan;
    if (this.verify.mode === 'always') {
      this.verified = false;
    }

    if (this.verified) {
      return;
    }

    const readStatement = this.familyAdapter.markerReader.readMarkerStatement();
    const driver = this.driver as unknown as DriverWithQuery<TDriver>;
    const result = await driver.query(readStatement.sql, readStatement.params);

    if (result.rows.length === 0) {
      if (this.verify.requireMarker) {
        throw runtimeError('CONTRACT.MARKER_MISSING', 'Contract marker not found in database');
      }

      this.verified = true;
      return;
    }

    const marker = parseContractMarkerRow(result.rows[0]);

    const contract = this.contract as {
      storage: { storageHash: string };
      execution?: { executionHash?: string | null };
      profileHash?: string | null;
    };
    if (marker.storageHash !== contract.storage.storageHash) {
      throw runtimeError(
        'CONTRACT.MARKER_MISMATCH',
        'Database storage hash does not match contract',
        {
          expected: contract.storage.storageHash,
          actual: marker.storageHash,
        },
      );
    }

    const expectedProfile = contract.profileHash ?? null;
    if (expectedProfile !== null && marker.profileHash !== expectedProfile) {
      throw runtimeError(
        'CONTRACT.MARKER_MISMATCH',
        'Database profile hash does not match contract',
        {
          expectedProfile,
          actualProfile: marker.profileHash,
        },
      );
    }

    this.verified = true;
    this.startupVerified = true;
  }

  private validatePlan(plan: ExecutionPlan): void {
    this.familyAdapter.validatePlan(plan, this.contract);
  }

  private recordTelemetry(
    plan: ExecutionPlan,
    outcome: TelemetryOutcome,
    durationMs?: number,
  ): void {
    const contract = this.contract as { target: string };
    this._telemetry = Object.freeze({
      lane: plan.meta.lane,
      target: contract.target,
      fingerprint: computeSqlFingerprint(plan.sql),
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row> {
    return this.#executeWith(plan, this.driver as Queryable);
  }

  async connection(): Promise<RuntimeConnection> {
    const driver = this.driver as unknown as DriverWithConnection<TDriver>;
    const driverConn = await driver.acquireConnection();
    const self = this;

    const runtimeConnection: RuntimeConnection = {
      async transaction(): Promise<RuntimeTransaction> {
        const driverTx = await driverConn.beginTransaction();
        const runtimeTx: RuntimeTransaction = {
          async commit(): Promise<void> {
            await driverTx.commit();
          },
          async rollback(): Promise<void> {
            await driverTx.rollback();
          },
          execute<Row = Record<string, unknown>>(
            plan: ExecutionPlan<Row>,
          ): AsyncIterableResult<Row> {
            return self.#executeWith(plan, driverTx);
          },
        };
        return runtimeTx;
      },
      execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterableResult<Row> {
        return self.#executeWith(plan, driverConn);
      },
      async release(): Promise<void> {
        await driverConn.release();
      },
    };

    return runtimeConnection;
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  close(): Promise<void> {
    const driver = this.driver as unknown as DriverWithClose<TDriver>;
    if (typeof driver.close === 'function') {
      return driver.close();
    }
    return Promise.resolve();
  }

  #executeWith<Row = Record<string, unknown>>(
    plan: ExecutionPlan<Row>,
    queryable: Queryable,
  ): AsyncIterableResult<Row> {
    this.validatePlan(plan);
    this._telemetry = null;

    const iterator = async function* (
      self: RuntimeCoreImpl<TContract, TDriver>,
    ): AsyncGenerator<Row, void, unknown> {
      const startedAt = Date.now();
      let rowCount = 0;
      let completed = false;

      if (!self.startupVerified && self.verify.mode === 'startup') {
        await self.verifyPlanIfNeeded(plan);
      }

      if (self.verify.mode === 'onFirstUse') {
        await self.verifyPlanIfNeeded(plan);
      }

      try {
        if (self.verify.mode === 'always') {
          await self.verifyPlanIfNeeded(plan);
        }

        for (const mw of self.middlewares) {
          if (mw.beforeExecute) {
            await mw.beforeExecute(plan, self.middlewareContext);
          }
        }

        const encodedParams = plan.params;

        for await (const row of queryable.execute<Record<string, unknown>>({
          sql: plan.sql,
          params: encodedParams,
        })) {
          for (const mw of self.middlewares) {
            if (mw.onRow) {
              await mw.onRow(row, plan, self.middlewareContext);
            }
          }
          rowCount++;
          yield row as Row;
        }

        completed = true;
        self.recordTelemetry(plan, 'success', Date.now() - startedAt);
      } catch (error) {
        if (self._telemetry === null) {
          self.recordTelemetry(plan, 'runtime-error', Date.now() - startedAt);
        }

        const latencyMs = Date.now() - startedAt;
        for (const mw of self.middlewares) {
          if (mw.afterExecute) {
            try {
              await mw.afterExecute(
                plan,
                { rowCount, latencyMs, completed },
                self.middlewareContext,
              );
            } catch {
              // Ignore errors from afterExecute hooks
            }
          }
        }

        throw error;
      }

      const latencyMs = Date.now() - startedAt;
      for (const mw of self.middlewares) {
        if (mw.afterExecute) {
          await mw.afterExecute(plan, { rowCount, latencyMs, completed }, self.middlewareContext);
        }
      }
    };

    return new AsyncIterableResult(iterator(this));
  }
}

export function createRuntimeCore<TContract = unknown, TDriver = unknown>(
  options: RuntimeCoreOptions<TContract, TDriver>,
): RuntimeCore<TContract, TDriver> {
  return new RuntimeCoreImpl(options);
}
