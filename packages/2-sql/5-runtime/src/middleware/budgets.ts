import type { ExecutionPlan } from '@prisma-next/contract/types';
import { type RuntimeErrorEnvelope, runtimeError } from '@prisma-next/framework-components/runtime';
import type {
  AfterExecuteResult,
  Middleware,
  MiddlewareContext,
} from '@prisma-next/runtime-executor';
import { isQueryAst, type SelectAst } from '@prisma-next/sql-relational-core/ast';

export interface BudgetsOptions {
  readonly maxRows?: number;
  readonly defaultTableRows?: number;
  readonly tableRows?: Record<string, number>;
  readonly maxLatencyMs?: number;
  readonly severities?: {
    readonly rowCount?: 'warn' | 'error';
    readonly latency?: 'warn' | 'error';
  };
}

function hasAggregateWithoutGroupBy(ast: SelectAst): boolean {
  if (ast.groupBy !== undefined) {
    return false;
  }
  return ast.projection.some((item) => item.expr.kind === 'aggregate');
}

function estimateRowsFromAst(
  ast: SelectAst,
  tableRows: Record<string, number>,
  defaultTableRows: number,
  refs: { tables?: readonly string[] } | undefined,
  hasAggregateWithoutGroup: boolean,
): number | null {
  if (hasAggregateWithoutGroup) {
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
  error: RuntimeErrorEnvelope,
  shouldBlock: boolean,
  ctx: MiddlewareContext<unknown>,
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

export function budgets<TContract = unknown>(options?: BudgetsOptions): Middleware<TContract> {
  const maxRows = options?.maxRows ?? 10_000;
  const defaultTableRows = options?.defaultTableRows ?? 10_000;
  const tableRows = options?.tableRows ?? {};
  const maxLatencyMs = options?.maxLatencyMs ?? 1_000;
  const rowSeverity = options?.severities?.rowCount ?? 'error';

  const observedRowsByPlan = new WeakMap<ExecutionPlan, { count: number }>();

  return Object.freeze({
    name: 'budgets',
    familyId: 'sql' as const,

    async beforeExecute(plan: ExecutionPlan, ctx: MiddlewareContext<TContract>) {
      observedRowsByPlan.set(plan, { count: 0 });

      if (isQueryAst(plan.ast)) {
        if (plan.ast.kind === 'select') {
          return evaluateSelectAst(plan, plan.ast, ctx);
        }
        return;
      }

      return evaluateWithHeuristics(plan, ctx);
    },

    async onRow(
      _row: Record<string, unknown>,
      plan: ExecutionPlan,
      _ctx: MiddlewareContext<TContract>,
    ) {
      const state = observedRowsByPlan.get(plan);
      if (!state) return;
      state.count += 1;
      if (state.count > maxRows) {
        throw runtimeError('BUDGET.ROWS_EXCEEDED', 'Observed row count exceeds budget', {
          source: 'observed',
          observedRows: state.count,
          maxRows,
        });
      }
    },

    async afterExecute(
      _plan: ExecutionPlan,
      result: AfterExecuteResult,
      ctx: MiddlewareContext<TContract>,
    ) {
      const latencyMs = result.latencyMs;
      if (latencyMs > maxLatencyMs) {
        const shouldBlock = ctx.mode === 'strict';
        emitBudgetViolation(
          runtimeError('BUDGET.TIME_EXCEEDED', 'Query latency exceeds budget', {
            latencyMs,
            maxLatencyMs,
          }),
          shouldBlock,
          ctx as MiddlewareContext<unknown>,
        );
      }
    },
  });

  function evaluateSelectAst(
    plan: ExecutionPlan,
    ast: SelectAst,
    ctx: MiddlewareContext<TContract>,
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
          runtimeError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
            source: 'ast',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as MiddlewareContext<unknown>,
        );
        return;
      }

      emitBudgetViolation(
        runtimeError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
          source: 'ast',
          maxRows,
        }),
        shouldBlock,
        ctx as MiddlewareContext<unknown>,
      );
      return;
    }

    if (estimated !== null && estimated > maxRows) {
      emitBudgetViolation(
        runtimeError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
          source: 'ast',
          estimatedRows: estimated,
          maxRows,
        }),
        shouldBlock,
        ctx as MiddlewareContext<unknown>,
      );
    }
  }

  async function evaluateWithHeuristics(plan: ExecutionPlan, ctx: MiddlewareContext<TContract>) {
    const estimated = estimateRowsFromHeuristics(plan, tableRows, defaultTableRows);
    const isUnbounded = !hasDetectableLimitFromHeuristics(plan);
    const sqlUpper = plan.sql.trimStart().toUpperCase();
    const isSelect = sqlUpper.startsWith('SELECT');
    const shouldBlock = rowSeverity === 'error' || ctx.mode === 'strict';

    if (isSelect && isUnbounded) {
      if (estimated !== null && estimated >= maxRows) {
        emitBudgetViolation(
          runtimeError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as MiddlewareContext<unknown>,
        );
        return;
      }

      emitBudgetViolation(
        runtimeError('BUDGET.ROWS_EXCEEDED', 'Unbounded SELECT query exceeds budget', {
          source: 'heuristic',
          maxRows,
        }),
        shouldBlock,
        ctx as MiddlewareContext<unknown>,
      );
      return;
    }

    if (estimated !== null) {
      if (estimated > maxRows) {
        emitBudgetViolation(
          runtimeError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
            source: 'heuristic',
            estimatedRows: estimated,
            maxRows,
          }),
          shouldBlock,
          ctx as MiddlewareContext<unknown>,
        );
      }
      return;
    }
  }
}
