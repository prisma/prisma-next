import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { OperationRegistry } from '@prisma-next/operations';
import { runtimeError } from './errors';
import { computeSqlFingerprint } from './fingerprint';
import { parseContractMarkerRow } from './marker';
import type { Log, Plugin, PluginContext } from './plugins/types';
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

export interface RuntimeCoreOptions<TContract = unknown, TAdapter = unknown, TDriver = unknown> {
  readonly familyAdapter: RuntimeFamilyAdapter<TContract>;
  readonly driver: TDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly plugins?: readonly Plugin<TContract, TAdapter, TDriver>[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: Log;
  readonly operationRegistry: OperationRegistry;
}

export interface RuntimeCore<TContract = unknown, TAdapter = unknown, TDriver = unknown> {
  // Type parameters are used in the implementation for type safety
  readonly _typeContract?: TContract;
  readonly _typeAdapter?: TAdapter;
  readonly _typeDriver?: TDriver;
  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterable<Row>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
  operations(): OperationRegistry;
}

interface DriverWithQuery<_TDriver> {
  query(sql: string, params: readonly unknown[]): Promise<{ rows: ReadonlyArray<unknown> }>;
}

interface DriverWithExecute<_TDriver> {
  execute<Row = Record<string, unknown>>(options: {
    sql: string;
    params: readonly unknown[];
  }): AsyncIterable<Row>;
}

interface DriverWithClose<_TDriver> {
  close(): Promise<void>;
}

class RuntimeCoreImpl<TContract = unknown, TAdapter = unknown, TDriver = unknown>
  implements RuntimeCore<TContract, TAdapter, TDriver>
{
  readonly _typeContract?: TContract;
  readonly _typeAdapter?: TAdapter;
  readonly _typeDriver?: TDriver;
  private readonly contract: TContract;
  private readonly familyAdapter: RuntimeFamilyAdapter<TContract>;
  private readonly driver: TDriver;
  private readonly plugins: readonly Plugin<TContract, TAdapter, TDriver>[];
  private readonly mode: 'strict' | 'permissive';
  private readonly verify: RuntimeVerifyOptions;
  private readonly operationRegistry: OperationRegistry;
  private readonly pluginContext: PluginContext<TContract, TAdapter, TDriver>;

  private verified: boolean;
  private startupVerified: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;

  constructor(options: RuntimeCoreOptions<TContract, TAdapter, TDriver>) {
    const { familyAdapter, driver } = options;
    this.contract = familyAdapter.contract;
    this.familyAdapter = familyAdapter;
    this.driver = driver;
    this.plugins = options.plugins ?? [];
    this.mode = options.mode ?? 'strict';
    this.verify = options.verify;
    this.operationRegistry = options.operationRegistry;

    this.verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
    this.startupVerified = false;
    this._telemetry = null;

    this.pluginContext = {
      contract: this.contract,
      adapter: options.familyAdapter as unknown as TAdapter,
      driver: this.driver,
      mode: this.mode,
      now: () => Date.now(),
      log: options.log ?? {
        info: () => {
          // No-op in MVP - diagnostics stay out of runtime core
        },
        warn: () => {
          // No-op in MVP - diagnostics stay out of runtime core
        },
        error: () => {
          // No-op in MVP - diagnostics stay out of runtime core
        },
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

    const contract = this.contract as { coreHash: string; profileHash?: string | null };
    if (marker.coreHash !== contract.coreHash) {
      throw runtimeError('CONTRACT.MARKER_MISMATCH', 'Database core hash does not match contract', {
        expected: contract.coreHash,
        actual: marker.coreHash,
      });
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

  execute<Row = Record<string, unknown>>(plan: ExecutionPlan<Row>): AsyncIterable<Row> {
    this.validatePlan(plan);
    this._telemetry = null;

    const iterator = async function* (
      self: RuntimeCoreImpl<TContract, TAdapter, TDriver>,
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

        for (const plugin of self.plugins) {
          if (plugin.beforeExecute) {
            await plugin.beforeExecute(plan, self.pluginContext);
          }
        }

        const driver = self.driver as unknown as DriverWithExecute<TDriver>;
        const encodedParams = plan.params as readonly unknown[];

        for await (const row of driver.execute<Record<string, unknown>>({
          sql: plan.sql,
          params: encodedParams,
        })) {
          for (const plugin of self.plugins) {
            if (plugin.onRow) {
              await plugin.onRow(row, plan, self.pluginContext);
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
        for (const plugin of self.plugins) {
          if (plugin.afterExecute) {
            try {
              await plugin.afterExecute(
                plan,
                { rowCount, latencyMs, completed },
                self.pluginContext,
              );
            } catch {
              // Ignore errors from afterExecute hooks
            }
          }
        }

        throw error;
      }

      const latencyMs = Date.now() - startedAt;
      for (const plugin of self.plugins) {
        if (plugin.afterExecute) {
          await plugin.afterExecute(plan, { rowCount, latencyMs, completed }, self.pluginContext);
        }
      }
    };

    return iterator(this);
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  operations(): OperationRegistry {
    return this.operationRegistry;
  }

  close(): Promise<void> {
    const driver = this.driver as unknown as DriverWithClose<TDriver>;
    if (typeof driver.close === 'function') {
      return driver.close();
    }
    return Promise.resolve();
  }
}

export function createRuntimeCore<TContract = unknown, TAdapter = unknown, TDriver = unknown>(
  options: RuntimeCoreOptions<TContract, TAdapter, TDriver>,
): RuntimeCore<TContract, TAdapter, TDriver> {
  return new RuntimeCoreImpl(options);
}
