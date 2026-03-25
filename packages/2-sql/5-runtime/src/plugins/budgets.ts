import type { ExecutionPlan } from '@prisma-next/contract/types';
import type { AfterExecuteResult, Plugin, PluginContext } from '@prisma-next/runtime-executor';
import { AggregateExpr, SelectAst } from '@prisma-next/sql-relational-core/ast';

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

function hasAggregateWithoutGroupBy(ast: SelectAst): boolean {
  if (ast.groupBy !== undefined) {
    return false;
  }
  return ast.projection.some((item) => item.expr instanceof AggregateExpr);
}

function estimateRowsFromAst(
  ast: SelectAst,
  tableRows: Record<string, number>,
  defaultTableRows: number,
  refs: { tables?: readonly string[] } | undefined,
  hasAggregateWithoutGroup?: boolean,
): number | null {
  if (hasAggregateWithoutGroup ?? hasAggregateWithoutGroupBy(ast)) {
    return 1;
  }

  const table = refs?.tables?.[0];
  if (!table) {
    return null;
  }

  const tableEstimate = tableRows[table] ?? defaultTableRows;

  if (ast.limit !== undefined) {
    return Math.min(ast.limit, tableEstimate);
  }

  return tableEstimate;
}

function estimateRowsFromHeuristics(
  plan: ExecutionPlan,
  tableRows: Record<string, number>,
  defaultTableRows: number,
): number | null {
  const table = plan.meta.refs?.tables?.[0];
  if (!table) {
    return null;
  }

  const tableEstimate = tableRows[table] ?? defaultTableRows;

  const limit = plan.meta.annotations?.['limit'];
  if (typeof limit === 'number') {
    return Math.min(limit, tableEstimate);
  }

  return tableEstimate;
}

function hasDetectableLimitFromHeuristics(plan: ExecutionPlan): boolean {
  return typeof plan.meta.annotations?.['limit'] === 'number';
}

function emitBudgetViolation(
  error: ReturnType<typeof budgetError>,
  shouldBlock: boolean,
  ctx: PluginContext<unknown, unknown, unknown>,
): void {
  if (shouldBlock) {
    throw error;
  }
  ctx.log.warn({
    code: error.code,
    message: error.message,
    details: error.details,
  });
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

      if (plan.ast instanceof SelectAst) {
        return evaluateSelectAst(plan, plan.ast, ctx);
      }

      if (plan.ast) {
        return;
      }

      return evaluateWithHeuristics(plan, ctx);
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

  function evaluateSelectAst(
    plan: ExecutionPlan,
    ast: SelectAst,
    ctx: PluginContext<TContract, TAdapter, TDriver>,
  ) {
    const hasAggNoGroup = hasAggregateWithoutGroupBy(ast);
    const estimated = estimateRowsFromAst(
      ast,
      tableRows,
      defaultTableRows,
      plan.meta.refs,
      hasAggNoGroup,
    );
    const isUnbounded = ast.limit === undefined && !hasAggNoGroup;
    const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';

    if (isUnbounded) {
      if (estimated !== null && estimated >= maxRows) {
        emitBudgetViolation(
          budgetError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
            source: 'ast',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as PluginContext<unknown, unknown, unknown>,
        );
        return;
      }

      emitBudgetViolation(
        budgetError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
          source: 'ast',
          maxRows,
        }),
        shouldBlock,
        ctx as PluginContext<unknown, unknown, unknown>,
      );
      return;
    }

    if (estimated !== null && estimated > maxRows) {
      emitBudgetViolation(
        budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
          source: 'ast',
          estimatedRows: estimated,
          maxRows,
        }),
        shouldBlock,
        ctx as PluginContext<unknown, unknown, unknown>,
      );
    }
  }

  async function evaluateWithHeuristics(
    plan: ExecutionPlan,
    ctx: PluginContext<TContract, TAdapter, TDriver>,
  ) {
    const estimated = estimateRowsFromHeuristics(plan, tableRows, defaultTableRows);
    const isUnbounded = !hasDetectableLimitFromHeuristics(plan);
    const sqlUpper = plan.sql.trimStart().toUpperCase();
    const isSelect = sqlUpper.startsWith('SELECT');
    const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';

    if (isSelect && isUnbounded) {
      if (estimated !== null && estimated >= maxRows) {
        emitBudgetViolation(
          budgetError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as PluginContext<unknown, unknown, unknown>,
        );
        return;
      }

      emitBudgetViolation(
        budgetError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
          source: 'heuristic',
          maxRows,
        }),
        shouldBlock,
        ctx as PluginContext<unknown, unknown, unknown>,
      );
      return;
    }

    if (estimated !== null) {
      if (estimated > maxRows) {
        emitBudgetViolation(
          budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as PluginContext<unknown, unknown, unknown>,
        );
      }
      return;
    }

    const explainEnabled = options?.explain?.enabled === true;
    if (explainEnabled && isSelect && typeof ctx.driver === 'object' && ctx.driver !== null) {
      const estimatedRows = await computeEstimatedRows(plan, ctx.driver as DriverWithExplain);
      if (estimatedRows !== undefined) {
        if (estimatedRows > maxRows) {
          emitBudgetViolation(
            budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
              source: 'explain',
              estimatedRows,
              maxRows,
            }),
            shouldBlock,
            ctx as PluginContext<unknown, unknown, unknown>,
          );
        }
      }
    }
  }
}
