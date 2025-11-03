import { mapContractMarkerRow, readContractMarker, type ContractMarkerRow } from './marker';
import { evaluateRawGuardrails } from './guardrails/raw';
import { emptyDiagnostics, freezeDiagnostics } from './diagnostics';
import { computeSqlFingerprint } from './fingerprint';
import type { SqlContract, SqlStorage } from '@prisma-next/sql/contract-types';
import type { Adapter, LoweredStatement, SelectAst, Plan, RawPlan } from '@prisma-next/sql/types';

import type { SqlDriver } from '@prisma-next/sql-target';
import type { BudgetSeverity, RuntimeDiagnostics } from './diagnostics';

export interface RuntimeVerifyOptions {
  readonly mode: 'onFirstUse' | 'startup' | 'always';
  readonly requireMarker: boolean;
}

export type TelemetryOutcome = 'success' | 'lint-error' | 'budget-error' | 'runtime-error';

export interface RuntimeTelemetryEvent {
  readonly lane: string;
  readonly target: string;
  readonly fingerprint: string;
  readonly diagnostics: RuntimeDiagnostics;
  readonly outcome: TelemetryOutcome;
  readonly durationMs?: number;
}

export interface RuntimeGuardrailOptions {
  readonly budgets?: {
    readonly unboundedSelectSeverity?: BudgetSeverity;
    readonly explain?: {
      readonly enabled: boolean;
    };
  };
}

import type { Plugin } from './plugins/types';
import type { CodecRegistry } from '@prisma-next/sql-target';
import { composeCodecRegistry } from './codecs/registry';
import { encodeParams } from './codecs/encoding';
import { decodeRow } from './codecs/decoding';
import { validateCodecRegistryCompleteness } from './codecs/validation';

export interface RuntimeCodecOptions {
  /**
   * Per-alias or fully-qualified column override → namespaced codec id.
   * Example: { 'user.createdAt': 'core/iso-datetime@1', 'createdAt': 'core/iso-datetime@1' }
   */
  readonly overrides?: Record<string, string>;
}

export interface RuntimeOptions<
  TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>,
> {
  readonly contract: TContract;
  readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly guardrails?: RuntimeGuardrailOptions;
  readonly plugins?: readonly Plugin[];
  readonly mode?: 'strict' | 'permissive';
  /**
   * Codec configuration for runtime.
   * Allows overriding codec selection per column/alias.
   */
  readonly codecs?: RuntimeCodecOptions;
}

export interface Runtime {
  execute<Row = Record<string, unknown>>(plan: Plan<Row>): AsyncIterable<Row>;
  diagnostics(): RuntimeDiagnostics;
  telemetry(): RuntimeTelemetryEvent | null;
  close(): Promise<void>;
}

interface RuntimeErrorEnvelope extends Error {
  readonly code: string;
  readonly category: 'PLAN' | 'CONTRACT' | 'LINT' | 'BUDGET' | 'RUNTIME';
  readonly severity: 'error';
  readonly details?: Record<string, unknown>;
}

export class Runtime<TContract extends SqlContract<SqlStorage> = SqlContract<SqlStorage>>
  implements Runtime
{
  private readonly contract: TContract;
  private readonly adapter: Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  private readonly driver: SqlDriver;
  private readonly plugins: readonly Plugin[];
  private readonly mode: 'strict' | 'permissive';
  private readonly verify: RuntimeVerifyOptions;
  private readonly guardrails: RuntimeGuardrailOptions | undefined;
  private readonly codecRegistry: CodecRegistry;
  private readonly codecOverrides: Record<string, string> | undefined;
  private readonly pluginContext: import('./plugins/types').PluginContext;

  private verified: boolean;
  private startupVerified: boolean;
  private _diagnostics: RuntimeDiagnostics;
  private _telemetry: RuntimeTelemetryEvent | null;
  private codecRegistryValidated: boolean;

  constructor(options: RuntimeOptions<TContract>) {
    const { driver, contract, adapter } = options;
    this.contract = contract;
    this.adapter = adapter;
    this.driver = driver;
    this.plugins = options.plugins ?? [];
    this.mode = options.mode ?? 'strict';
    this.verify = options.verify;
    this.guardrails = options.guardrails;
    this.codecOverrides = options.codecs?.overrides;

    this.verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
    this.startupVerified = false;
    this._diagnostics = emptyDiagnostics;
    this._telemetry = null;
    this.codecRegistryValidated = false;

    this.codecRegistry = composeCodecRegistry(this.adapter.profile.codecs(), this.codecOverrides);

    this.pluginContext = {
      contract: this.contract,
      adapter: this.adapter,
      driver: this.driver,
      mode: this.mode,
      now: () => Date.now(),
      log: {
        info: (_event) => {
          // No-op in MVP - diagnostics stay out of runtime core
        },
        warn: (_event) => {
          // No-op in MVP - diagnostics stay out of runtime core
        },
        error: (_event) => {
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

    const marker = mapContractMarkerRow(result.rows[0] as unknown as ContractMarkerRow);

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
      diagnostics: this._diagnostics,
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  private async applyGuardrails(plan: Plan): Promise<void> {
    this._diagnostics = emptyDiagnostics;

    if (plan.meta.lane !== 'raw') {
      return;
    }

    const rawPlan = plan as RawPlan;
    const budgetsConfig = this.guardrails?.budgets;
    const unboundedSeverity: BudgetSeverity = budgetsConfig?.unboundedSelectSeverity ?? 'error';

    let evaluation = evaluateRawGuardrails(rawPlan, {
      budgets: { unboundedSelectSeverity: unboundedSeverity },
    });

    this._diagnostics = freezeDiagnostics({ lints: evaluation.lints, budgets: evaluation.budgets });

    const fatalLint = evaluation.lints.find((lint) => lint.severity === 'error');
    if (fatalLint) {
      this.recordTelemetry(plan, 'lint-error');
      throw runtimeError(fatalLint.code, fatalLint.message, fatalLint.details);
    }

    let fatalBudget = evaluation.budgets.find((budget) => budget.severity === 'error');

    const explainEnabled = budgetsConfig?.explain?.enabled === true;
    if (explainEnabled && evaluation.statement === 'select') {
      const estimatedRows = await this.computeEstimatedRows(rawPlan);
      if (estimatedRows !== undefined) {
        evaluation = evaluateRawGuardrails(rawPlan, {
          budgets: {
            unboundedSelectSeverity: unboundedSeverity,
            estimatedRows,
          },
        });

        this._diagnostics = freezeDiagnostics({
          lints: evaluation.lints,
          budgets: evaluation.budgets,
        });
        fatalBudget = evaluation.budgets.find((budget) => budget.severity === 'error');
      }
    }

    if (fatalBudget) {
      this.recordTelemetry(plan, 'budget-error');
      throw runtimeError(fatalBudget.code, fatalBudget.message, fatalBudget.details);
    }
  }

  private async computeEstimatedRows(plan: RawPlan): Promise<number | undefined> {
    if (typeof this.driver.explain !== 'function') {
      return undefined;
    }

    try {
      const result = await this.driver.explain({ sql: plan.sql, params: plan.params });
      return extractEstimatedRows(result.rows);
    } catch {
      return undefined;
    }
  }

  execute<Row = Record<string, unknown>>(plan: Plan<Row>): AsyncIterable<Row> {
    this.ensureCodecRegistryValidated();
    this.validatePlan(plan);
    this._telemetry = null;

    const iterator = async function* (
      self: Runtime<TContract>,
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

        await self.applyGuardrails(plan);

        // Invoke plugin beforeExecute hooks
        for (const plugin of self.plugins) {
          if (plugin.beforeExecute) {
            await plugin.beforeExecute(plan, self.pluginContext);
          }
        }

        // Encode parameters before execution
        const encodedParams = encodeParams(plan, self.codecRegistry, self.codecOverrides);

        // Execute query with streaming row-by-row plugin hooks
        for await (const row of self.driver.execute<Record<string, unknown>>({
          sql: plan.sql,
          params: encodedParams,
        })) {
          // Decode row using codec registry
          const decodedRow = decodeRow(row, plan, self.codecRegistry, self.codecOverrides);

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

  diagnostics(): RuntimeDiagnostics {
    return this._diagnostics;
  }

  telemetry(): RuntimeTelemetryEvent | null {
    return this._telemetry;
  }

  close(): Promise<void> {
    return this.driver.close();
  }
}

export function createRuntime<TContract extends SqlContract<SqlStorage>>(
  options: RuntimeOptions<TContract>,
): Runtime<TContract> {
  return new Runtime(options);
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

function extractEstimatedRows(rows: ReadonlyArray<Record<string, unknown>>): number | undefined {
  for (const row of rows) {
    const estimate = findPlanRows(row);
    if (estimate !== undefined) {
      return estimate;
    }
  }

  return undefined;
}

function findPlanRows(node: unknown): number | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  const planRows = (node as Record<string, unknown>)['Plan Rows'];
  if (typeof planRows === 'number') {
    return planRows;
  }

  if ('Plan' in (node as Record<string, unknown>)) {
    const nested = findPlanRows((node as Record<string, unknown>)['Plan']);
    if (nested !== undefined) {
      return nested;
    }
  }

  if (Array.isArray((node as Record<string, unknown>)['Plans'])) {
    for (const child of (node as Record<string, unknown>)['Plans'] as unknown[]) {
      const nested = findPlanRows(child);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null) {
      const nested = findPlanRows(value);
      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

export * from './marker';
export type { LintFinding, BudgetFinding, RuntimeDiagnostics } from './diagnostics';
export { budgets } from './plugins/budgets';
export type { BudgetsOptions } from './plugins/budgets';
export type { Plugin, PluginContext, Log, AfterExecuteResult } from './plugins/types';
