import type { Plan } from '@prisma-next/contract/types';
import type { AfterExecuteResult } from './types';
import type { Plugin, PluginContext } from './types';

export interface BudgetsOptions {
  readonly maxRows?: number;
  readonly defaultTableRows?: number;
  readonly tableRows?: Record<string, number>;
  readonly maxLatencyMs?: number;
  readonly severities?: {
    readonly rowCount?: 'warn' | 'error';
    readonly latency?: 'warn' | 'error';
  };
  readonly explain?: {
    readonly enabled?: boolean;
  };
}

interface DriverWithExplain {
  explain?(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;
}

async function computeEstimatedRows(
  plan: Plan,
  driver: DriverWithExplain,
): Promise<number | undefined> {
  if (typeof driver.explain !== 'function') {
    return undefined;
  }

  try {
    const result = await driver.explain(plan.sql, [...plan.params]);
    return extractEstimatedRows(result.rows);
  } catch {
    return undefined;
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

type ExplainNode = {
  Plan?: unknown;
  Plans?: unknown[];
  'Plan Rows'?: number;
  [key: string]: unknown;
};

function findPlanRows(node: unknown): number | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  const explainNode = node as ExplainNode;
  const planRows = explainNode['Plan Rows'];
  if (typeof planRows === 'number') {
    return planRows;
  }

  if ('Plan' in explainNode && explainNode.Plan !== undefined) {
    const nested = findPlanRows(explainNode.Plan);
    if (nested !== undefined) {
      return nested;
    }
  }

  if (Array.isArray(explainNode.Plans)) {
    for (const child of explainNode.Plans) {
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

function budgetError(code: string, message: string, details?: Record<string, unknown>) {
  const error = new Error(message) as Error & {
    code: string;
    category: 'BUDGET';
    severity: 'error';
    details?: Record<string, unknown>;
  };
  Object.defineProperty(error, 'name', {
    value: 'RuntimeError',
    configurable: true,
  });
  return Object.assign(error, {
    code,
    category: 'BUDGET' as const,
    severity: 'error' as const,
    details,
  });
}

function estimateRows(
  plan: Plan,
  tableRows: Record<string, number>,
  defaultTableRows: number,
): number | null {
  if (!plan.ast) {
    return null;
  }

  const table = plan.meta.refs?.tables?.[0];
  if (!table) {
    return null;
  }

  const tableEstimate = tableRows[table] ?? defaultTableRows;

  if (
    plan.ast &&
    typeof plan.ast === 'object' &&
    'kind' in plan.ast &&
    plan.ast.kind === 'select' &&
    'limit' in plan.ast &&
    typeof plan.ast.limit === 'number'
  ) {
    return Math.min(plan.ast.limit, tableEstimate);
  }

  return tableEstimate;
}

function hasDetectableLimit(plan: Plan): boolean {
  if (
    plan.ast &&
    typeof plan.ast === 'object' &&
    'kind' in plan.ast &&
    plan.ast.kind === 'select' &&
    'limit' in plan.ast &&
    typeof plan.ast.limit === 'number'
  ) {
    return true;
  }

  const annotations = plan.meta.annotations as { limit?: number; LIMIT?: number } | undefined;
  return typeof annotations?.limit === 'number' || typeof annotations?.LIMIT === 'number';
}

export function budgets<TContract = unknown, TAdapter = unknown, TDriver = unknown>(
  options?: BudgetsOptions,
): Plugin<TContract, TAdapter, TDriver> {
  const maxRows = options?.maxRows ?? 10_000;
  const defaultTableRows = options?.defaultTableRows ?? 10_000;
  const tableRows = options?.tableRows ?? {};
  const maxLatencyMs = options?.maxLatencyMs ?? 1_000;
  const rowSeverity = options?.severities?.rowCount ?? 'error';
  const latencySeverity = options?.severities?.latency ?? 'warn';

  let observedRows = 0;

  return Object.freeze({
    name: 'budgets',

    async beforeExecute(plan: Plan, ctx: PluginContext<TContract, TAdapter, TDriver>) {
      observedRows = 0;
      void ctx.now();

      const estimated = estimateRows(plan, tableRows, defaultTableRows);
      if (estimated !== null) {
        if (estimated > maxRows) {
          const error = budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          });

          const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';
          if (shouldBlock) {
            throw error;
          }
          ctx.log.warn({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        return;
      }

      if (!plan.ast) {
        const explainEnabled = options?.explain?.enabled === true;
        const sqlUpper = plan.sql.trimStart().toUpperCase();
        const isSelect = sqlUpper.startsWith('SELECT');

        if (explainEnabled && isSelect && typeof ctx.driver === 'object' && ctx.driver !== null) {
          const estimatedRows = await computeEstimatedRows(plan, ctx.driver as DriverWithExplain);
          if (estimatedRows !== undefined) {
            if (estimatedRows > maxRows) {
              const error = budgetError(
                'BUDGET.ROWS_EXCEEDED',
                'Estimated row count exceeds budget',
                {
                  source: 'explain',
                  estimatedRows,
                  maxRows,
                },
              );

              const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';
              if (shouldBlock) {
                throw error;
              }
              ctx.log.warn({
                code: error.code,
                message: error.message,
                details: error.details,
              });
            }
            return;
          }
        }

        if (isSelect && !hasDetectableLimit(plan)) {
          const error = budgetError(
            'BUDGET.ROWS_EXCEEDED',
            'Unbounded SELECT query exceeds budget',
            {
              source: 'heuristic',
              maxRows,
            },
          );

          const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';
          if (shouldBlock) {
            throw error;
          }
          ctx.log.warn({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        return;
      }
    },

    async onRow(
      _row: Record<string, unknown>,
      _plan: Plan,
      _ctx: PluginContext<TContract, TAdapter, TDriver>,
    ) {
      void _row;
      void _plan;
      void _ctx;
      observedRows += 1;
      if (observedRows > maxRows) {
        throw budgetError('BUDGET.ROWS_EXCEEDED', 'Observed row count exceeds budget', {
          source: 'observed',
          observedRows,
          maxRows,
        });
      }
    },

    async afterExecute(
      _plan: Plan,
      result: AfterExecuteResult,
      ctx: PluginContext<TContract, TAdapter, TDriver>,
    ) {
      const latencyMs = result.latencyMs;
      if (latencyMs > maxLatencyMs) {
        const error = budgetError('BUDGET.TIME_EXCEEDED', 'Query latency exceeds budget', {
          latencyMs,
          maxLatencyMs,
        });

        const shouldBlock = latencySeverity === 'error' && ctx.mode === 'strict';
        if (shouldBlock) {
          throw error;
        }
        ctx.log.warn({
          code: error.code,
          message: error.message,
          details: error.details,
        });
      }
    },
  });
}
