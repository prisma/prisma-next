import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AfterExecuteResult, Plugin, PluginContext } from './types';

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
  plan: ExecutionPlan,
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
  plan: ExecutionPlan,
  tableRows: Record<string, number>,
  defaultTableRows: number,
): number | null {
  const table = plan.meta.refs?.tables?.[0];
  if (!table) {
    return null;
  }

  const tableEstimate = tableRows[table] ?? defaultTableRows;
  const annotations = plan.meta.annotations as { limit?: number; LIMIT?: number } | undefined;
  const limit =
    typeof annotations?.limit === 'number'
      ? annotations.limit
      : typeof annotations?.LIMIT === 'number'
        ? annotations.LIMIT
        : undefined;

  if (typeof limit === 'number') {
    return Math.min(limit, tableEstimate);
  }

  return tableEstimate;
}

function hasDetectableLimit(plan: ExecutionPlan): boolean {
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

    async beforeExecute(plan: ExecutionPlan, ctx: PluginContext<TContract, TAdapter, TDriver>) {
      observedRows = 0;
      void ctx.now();

      const estimated = estimateRows(plan, tableRows, defaultTableRows);
      const isUnbounded = !hasDetectableLimit(plan);
      const sqlUpper = plan.sql.trimStart().toUpperCase();
      const isSelect = sqlUpper.startsWith('SELECT');

      // Check for unbounded queries first - these should always error if they exceed or equal the budget
      if (isSelect && isUnbounded) {
        if (estimated !== null && estimated >= maxRows) {
          const error = budgetError(
            'BUDGET.ROWS_EXCEEDED',
            'Unbounded SELECT query exceeds budget',
            {
              source: 'heuristic',
              estimatedRows: estimated,
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
          return;
        }

        // Even if we can't estimate, unbounded queries should error
        const error = budgetError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
          source: 'heuristic',
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
        return;
      }

      // For bounded queries, check if estimated exceeds budget
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

      // Fallback: if no AST, try EXPLAIN if enabled
      if (!plan.ast) {
        const explainEnabled = options?.explain?.enabled === true;

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
      }
    },

    async onRow(
      _row: Record<string, unknown>,
      _plan: ExecutionPlan,
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
      _plan: ExecutionPlan,
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
