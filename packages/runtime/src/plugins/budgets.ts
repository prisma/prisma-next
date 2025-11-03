import type { Plugin, PluginContext } from './types';
import type { DslPlan, Plan, RawPlan } from '@prisma-next/sql/types';

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
    // Only DSL lane has AST we can trust for LIMIT in MVP
    if (plan.meta.lane !== 'dsl') {
      return null;
    }

    const dslPlan = plan as DslPlan;
    const table = dslPlan.meta.refs?.tables?.[0];
    if (!table) {
      return null;
    }

    const tableEstimate = tableRows[table] ?? defaultTableRows;

    // Check if there's a LIMIT in the AST
    if (typeof dslPlan.ast.limit === 'number') {
      // Bounded: use min of LIMIT and table estimate
      return Math.min(dslPlan.ast.limit, tableEstimate);
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
    if (plan.meta.lane === 'dsl') {
      const dslPlan = plan as DslPlan;
      return typeof dslPlan.ast.limit === 'number';
    }

    // For raw lane, check if annotations provide limit hint
    // MVP: no SQL parsing, so rely on lane-provided hints only
    const rawPlan = plan as RawPlan;
    return (
      typeof rawPlan.meta.annotations?.['limit'] === 'number' ||
      typeof rawPlan.meta.annotations?.['LIMIT'] === 'number'
    );
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

      // For non-DSL lanes or unestimable plans, check if SELECT without detectable LIMIT
      // Per spec: "Any SELECT without a detectable LIMIT is treated as over the row budget"
      const sqlUpper = plan.sql.trimStart().toUpperCase();
      if (sqlUpper.startsWith('SELECT')) {
        if (!hasDetectableLimit(plan)) {
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
      }
    },

    async onRow(_row: Record<string, unknown>, _plan: Plan, _ctx: PluginContext) {
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
