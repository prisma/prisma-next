import type { Plan } from '@prisma-next/contract/types';
import type { SelectAst } from '@prisma-next/sql-target';
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

/**
 * Computes estimated rows for a raw plan using driver.explain if available.
 * Returns undefined if explain is not available or fails.
 */
async function computeEstimatedRows(
  plan: Plan,
  driver: PluginContext['driver'],
): Promise<number | undefined> {
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

export function budgets(options?: BudgetsOptions): Plugin {
  const maxRows = options?.maxRows ?? 10_000;
  const defaultTableRows = options?.defaultTableRows ?? 10_000;
  const tableRows = options?.tableRows ?? {};
  const maxLatencyMs = options?.maxLatencyMs ?? 1_000;
  const rowSeverity = options?.severities?.rowCount ?? 'error';
  const latencySeverity = options?.severities?.latency ?? 'warn';

  // Per-execution state (reset on each beforeExecute)
  let observedRows = 0;

  /**
   * Estimate rows for DSL lane SELECT queries
   * Returns null for non-DSL lanes or if unable to estimate
   */
  function estimateRows(plan: Plan): number | null {
    // Only plans with AST can provide LIMIT information
    if (!plan.ast) {
      return null;
    }

    const table = plan.meta.refs?.tables?.[0];
    if (!table) {
      return null;
    }

    const tableEstimate = tableRows[table] ?? defaultTableRows;

    // Check if there's a LIMIT in the AST (only SELECT has limit)
    if (plan.ast && typeof plan.ast === 'object' && 'kind' in plan.ast && plan.ast.kind === 'select') {
      const selectAst = plan.ast as SelectAst;
      if (typeof selectAst.limit === 'number') {
        // Bounded: use min of LIMIT and table estimate
        return Math.min(selectAst.limit, tableEstimate);
      }
    }

    // Unbounded SELECT - treat as full table estimate
    return tableEstimate;
  }

  /**
   * Check if a SELECT plan has a detectable LIMIT
   * For DSL lane: check AST limit property
   * For raw lane: check meta.annotations or refs hints (if provided)
   */
  function hasDetectableLimit(plan: Plan): boolean {
    // Check AST limit if available (only SELECT has limit)
    if (plan.ast && typeof plan.ast === 'object' && 'kind' in plan.ast && plan.ast.kind === 'select') {
      const selectAst = plan.ast as SelectAst;
      if (typeof selectAst.limit === 'number') {
        return true;
      }
    }

    // Check if annotations provide limit hint
    // MVP: no SQL parsing, so rely on lane-provided hints only
    const annotations = plan.meta.annotations as { limit?: number; LIMIT?: number } | undefined;
    return typeof annotations?.limit === 'number' || typeof annotations?.LIMIT === 'number';
  }

  return Object.freeze({
    name: 'budgets',

    async beforeExecute(plan: Plan, ctx: PluginContext) {
      // Reset per-execution state
      observedRows = 0;
      void ctx.now(); // Track start time for potential future use

      // Pre-exec heuristic: check estimated rows for DSL lane
      const estimated = estimateRows(plan);
      if (estimated !== null) {
        // DSL lane with estimable rows
        if (estimated > maxRows) {
          const error = budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          });

          // Block if severity is error or mode is strict
          const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';
          if (shouldBlock) {
            throw error;
          }
          // Otherwise warn
          ctx.log.warn({
            code: error.code,
            message: error.message,
            details: error.details,
          });
        }
        return;
      }

      // For plans without AST: try explain if enabled, otherwise fall back to heuristic
      if (!plan.ast) {
        const explainEnabled = options?.explain?.enabled === true;
        const sqlUpper = plan.sql.trimStart().toUpperCase();
        const isSelect = sqlUpper.startsWith('SELECT');

        if (explainEnabled && isSelect) {
          const estimatedRows = await computeEstimatedRows(plan, ctx.driver);
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
          // Fall through to heuristic check if explain failed or unavailable
        }

        // For raw lane without explain or when explain unavailable: check if SELECT without detectable LIMIT
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

    async onRow(_row: Record<string, unknown>, _plan: Plan, _ctx: PluginContext) {
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
      result: import('./types').AfterExecuteResult,
      ctx: PluginContext,
    ) {
      const latencyMs = result.latencyMs;
      if (latencyMs > maxLatencyMs) {
        const error = budgetError('BUDGET.TIME_EXCEEDED', 'Query latency exceeds budget', {
          latencyMs,
          maxLatencyMs,
        });

        // Latency defaults to warn (advisory)
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
