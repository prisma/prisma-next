import type { Adapter, LoweredStatement, Plan, SelectAst } from '@prisma-next/sql-query/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { computeSqlFingerprint } from './fingerprint';
import { parseContractMarkerRow, readContractMarker } from './marker';

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

import type { CodecRegistry, OperationRegistry } from '@prisma-next/sql-target';
import { decodeRow } from './codecs/decoding';
import { encodeParams } from './codecs/encoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';
import type { RuntimeContext } from './context';
import type { Plugin } from './plugins/types';

export interface RuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly context: RuntimeContext;
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  readonly log?: import('./plugins/types').Log;
}

export interface Runtime {
  execute<Row = Record<string, unknown>>(plan: Plan<Row>): AsyncIterable<Row>;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
  operations(): OperationRegistry;
}

interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'PLAN' | 'CONTRACT' | 'LINT' | 'BUDGET' | 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

class RuntimeImpl<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>
  implements Runtime
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly driver: SqlDriver;
  private readonly plugins: readonly Plugin[];
  private readonly mode: 'strict' | 'permissive';
  private readonly verify: RuntimeVerifyOptions;
  private readonly codecRegistry: CodecRegistry;
  private readonly operationRegistry: OperationRegistry;
  private readonly pluginContext: import('./plugins/types').PluginContext;

  private verified: boolean;
  private startupVerified: boolean;
  private _telemetry: RuntimeTelemetryEvent | null;
  private codecRegistryValidated: boolean;

  constructor(options: RuntimeOptions<TContract>) {
    const { driver, contract, adapter, context } = options;
    this.contract = contract;
    this.adapter = adapter;
    this.driver = driver;
    this.plugins = options.plugins ?? [];
    this.mode = options.mode ?? 'strict';
    this.verify = options.verify;

    this.verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
    this.startupVerified = false;
    this._telemetry = null;
    this.codecRegistryValidated = false;

    // Use registries from context
    this.codecRegistry = context.codecs;
    this.operationRegistry = context.operations;

    this.pluginContext = {
      contract: this.contract,
      adapter: this.adapter,
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

    if (options.verify.mode === 'startup') {
      validateCodecRegistryCompleteness(this.codecRegistry, this.contract);
      this.codecRegistryValidated = true;
    }
  }

  private ensureCodecRegistryValidated(): void {
    if (!this.codecRegistryValidated) {
      validateCodecRegistryCompleteness(this.codecRegistry, this.contract);
      this.codecRegistryValidated = true;
    }
  }

  private async verifyPlanIfNeeded(_plan: Plan): Promise<void> {
    void _plan; // Parameter required by interface but not used in this implementation
    if (this.verify.mode === 'always') {
      this.verified = false;
    }

    if (this.verified) {
      return;
    }

    const readStatement = readContractMarker();
    const result = await this.driver.query(readStatement.sql, readStatement.params);

    if (result.rows.length === 0) {
      if (this.verify.requireMarker) {
        throw runtimeError('CONTRACT.MARKER_MISSING', 'Contract marker not found in database');
      }

      this.verified = true;
      return;
    }

    const marker = parseContractMarkerRow(result.rows[0]);

    if (marker.coreHash !== this.contract.coreHash) {
      throw runtimeError('CONTRACT.MARKER_MISMATCH', 'Database core hash does not match contract', {
        expected: this.contract.coreHash,
        actual: marker.coreHash,
      });
    }

    const expectedProfile = this.contract.profileHash ?? null;
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

  private validatePlan(plan: Plan): void {
    if (plan.meta.target !== this.contract.target) {
      throw runtimeError('PLAN.TARGET_MISMATCH', 'Plan target does not match runtime target', {
        planTarget: plan.meta.target,
        runtimeTarget: this.contract.target,
      });
    }

    if (plan.meta.coreHash !== this.contract.coreHash) {
      throw runtimeError('PLAN.HASH_MISMATCH', 'Plan core hash does not match runtime contract', {
        planCoreHash: plan.meta.coreHash,
        runtimeCoreHash: this.contract.coreHash,
      });
    }
  }

  private recordTelemetry(plan: Plan, outcome: TelemetryOutcome, durationMs?: number): void {
    this._telemetry = Object.freeze({
      lane: plan.meta.lane,
      target: plan.meta.target,
      fingerprint: computeSqlFingerprint(plan.sql),
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  execute<Row = Record<string, unknown>>(plan: Plan<Row>): AsyncIterable<Row> {
    this.ensureCodecRegistryValidated();
    this.validatePlan(plan);
    this._telemetry = null;

    const iterator = async function* (
      self: RuntimeImpl<TContract>,
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

        // Invoke plugin beforeExecute hooks
        for (const plugin of self.plugins) {
          if (plugin.beforeExecute) {
            await plugin.beforeExecute(plan, self.pluginContext);
          }
        }

        // Encode parameters before execution
        const encodedParams = encodeParams(plan, self.codecRegistry);

        // Execute query with streaming row-by-row plugin hooks
        for await (const row of self.driver.execute<Record<string, unknown>>({
          sql: plan.sql,
          params: encodedParams,
        })) {
          // Decode row using codec registry
          const decodedRow = decodeRow(row, plan, self.codecRegistry);

          // Invoke plugin onRow hooks with decoded row
          for (const plugin of self.plugins) {
            if (plugin.onRow) {
              await plugin.onRow(decodedRow, plan, self.pluginContext);
            }
          }
          rowCount++;
          yield decodedRow as Row;
        }

        completed = true;
        self.recordTelemetry(plan, 'success', Date.now() - startedAt);
      } catch (error) {
        if (self._telemetry === null) {
          self.recordTelemetry(plan, 'runtime-error', Date.now() - startedAt);
        }

        // Invoke plugin afterExecute hooks even on error
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

      // Invoke plugin afterExecute hooks on success
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
    return this.driver.close();
  }
}

export function createRuntime<TContract extends SqlContract<SqlStorage>>(
  options: RuntimeOptions<TContract>,
): Runtime {
  return new RuntimeImpl(options);
}

function runtimeError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): RuntimeErrorEnvelope {
  const error = new Error(message) as RuntimeErrorEnvelope;
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });

  return Object.assign(error, {
    code,
    category: resolveCategory(code),
    severity: 'error' as const,
    message,
    details,
  });
}

function resolveCategory(code: string): RuntimeErrorEnvelope['category'] {
  const prefix = code.split('.')[0] ?? 'RUNTIME';
  switch (prefix) {
    case 'PLAN':
    case 'CONTRACT':
    case 'LINT':
    case 'BUDGET':
      return prefix;
    default:
      return 'RUNTIME';
  }
}
