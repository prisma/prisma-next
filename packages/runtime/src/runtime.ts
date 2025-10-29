import { mapContractMarkerRow, readContractMarker } from './marker';
import { evaluateRawGuardrails } from './guardrails/raw';
import { emptyDiagnostics, freezeDiagnostics } from './diagnostics';
import { computeSqlFingerprint } from './fingerprint';
import type {
  Adapter,
  DataContract,
  LoweredStatement,
  SelectAst,
  Plan,
  RawPlan,
} from '@prisma-next/sql/types';

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

export interface RuntimeOptions {
  readonly contract: DataContract;
  readonly adapter: Adapter<SelectAst, DataContract, LoweredStatement>;
  readonly driver: SqlDriver;
  readonly verify: RuntimeVerifyOptions;
  readonly guardrails?: RuntimeGuardrailOptions;
}

export interface Runtime {
  execute(plan: Plan): AsyncIterable<Record<string, any>>;
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

export function createRuntime(options: RuntimeOptions): Runtime {
  const { driver, contract } = options;
  let verified = options.verify.mode === 'startup' ? false : options.verify.mode === 'always';
  let startupVerified = false;
  let diagnostics: RuntimeDiagnostics = emptyDiagnostics;
  let telemetry: RuntimeTelemetryEvent | null = null;

  async function verifyPlanIfNeeded(plan: Plan) {
    if (options.verify.mode === 'always') {
      verified = false;
    }

    if (verified) {
      return;
    }

    const readStatement = readContractMarker();
    const result = await driver.query(readStatement.sql, readStatement.params);

    if (result.rows.length === 0) {
      if (options.verify.requireMarker) {
        throw runtimeError('CONTRACT.MARKER_MISSING', 'Contract marker not found in database');
      }

      verified = true;
      return;
    }

    const marker = mapContractMarkerRow(result.rows[0] as any);

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

    verified = true;
    startupVerified = true;
  }

  function validatePlan(plan: Plan) {
    if (plan.meta.target !== contract.target) {
      throw runtimeError('PLAN.TARGET_MISMATCH', 'Plan target does not match runtime target', {
        planTarget: plan.meta.target,
        runtimeTarget: contract.target,
      });
    }

    if (plan.meta.coreHash !== contract.coreHash) {
      throw runtimeError('PLAN.HASH_MISMATCH', 'Plan core hash does not match runtime contract', {
        planCoreHash: plan.meta.coreHash,
        runtimeCoreHash: contract.coreHash,
      });
    }
  }

  function recordTelemetry(plan: Plan, outcome: TelemetryOutcome, durationMs?: number) {
    telemetry = Object.freeze({
      lane: plan.meta.lane,
      target: plan.meta.target,
      fingerprint: computeSqlFingerprint(plan.sql),
      diagnostics,
      outcome,
      ...(durationMs !== undefined ? { durationMs } : {}),
    });
  }

  async function applyGuardrails(plan: Plan): Promise<void> {
    diagnostics = emptyDiagnostics;

    if (plan.meta.lane !== 'raw') {
      return;
    }

    const rawPlan = plan as RawPlan;
    const budgetsConfig = options.guardrails?.budgets;
    const unboundedSeverity: BudgetSeverity = budgetsConfig?.unboundedSelectSeverity ?? 'error';

    let evaluation = evaluateRawGuardrails(rawPlan, {
      budgets: { unboundedSelectSeverity: unboundedSeverity },
    });

    diagnostics = freezeDiagnostics({ lints: evaluation.lints, budgets: evaluation.budgets });

    const fatalLint = evaluation.lints.find((lint) => lint.severity === 'error');
    if (fatalLint) {
      recordTelemetry(plan, 'lint-error');
      throw runtimeError(fatalLint.code, fatalLint.message, fatalLint.details);
    }

    let fatalBudget = evaluation.budgets.find((budget) => budget.severity === 'error');

    const explainEnabled = budgetsConfig?.explain?.enabled === true;
    if (explainEnabled && evaluation.statement === 'select') {
      const estimatedRows = await computeEstimatedRows(rawPlan);
      if (estimatedRows !== undefined) {
        evaluation = evaluateRawGuardrails(rawPlan, {
          budgets: {
            unboundedSelectSeverity: unboundedSeverity,
            estimatedRows,
          },
        });

        diagnostics = freezeDiagnostics({ lints: evaluation.lints, budgets: evaluation.budgets });
        fatalBudget = evaluation.budgets.find((budget) => budget.severity === 'error');
      }
    }

    if (fatalBudget) {
      recordTelemetry(plan, 'budget-error');
      throw runtimeError(fatalBudget.code, fatalBudget.message, fatalBudget.details);
    }
  }

  async function computeEstimatedRows(plan: RawPlan): Promise<number | undefined> {
    if (typeof driver.explain !== 'function') {
      return undefined;
    }

    try {
      const result = await driver.explain({ sql: plan.sql, params: plan.params });
      return extractEstimatedRows(result.rows);
    } catch {
      return undefined;
    }
  }

  const runtime: Runtime = {
    execute(plan: Plan): AsyncIterable<Record<string, any>> {
      validatePlan(plan);
      telemetry = null;

      const iterator = async function* () {
        const startedAt = Date.now();

        if (!startupVerified && options.verify.mode === 'startup') {
          await verifyPlanIfNeeded(plan);
        }

        if (options.verify.mode === 'onFirstUse') {
          await verifyPlanIfNeeded(plan);
        }

        try {
          if (options.verify.mode === 'always') {
            await verifyPlanIfNeeded(plan);
          }

          await applyGuardrails(plan);

          for await (const row of driver.execute<Record<string, any>>({
            sql: plan.sql,
            params: plan.params,
          })) {
            yield row;
          }

          recordTelemetry(plan, 'success', Date.now() - startedAt);
        } catch (error) {
          if (telemetry === null) {
            recordTelemetry(plan, 'runtime-error', Date.now() - startedAt);
          }

          throw error;
        }
      };

      return iterator();
    },

    diagnostics() {
      return diagnostics;
    },

    telemetry() {
      return telemetry;
    },

    close() {
      return driver.close();
    },
  };

  return runtime;
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
    const nested = findPlanRows((node as Record<string, unknown>).Plan);
    if (nested !== undefined) {
      return nested;
    }
  }

  if (Array.isArray((node as Record<string, unknown>).Plans)) {
    for (const child of (node as Record<string, unknown>).Plans as unknown[]) {
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
