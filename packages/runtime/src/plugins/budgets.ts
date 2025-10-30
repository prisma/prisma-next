import type { Plugin, PluginContext } from './types';

export interface BudgetsOptions {
  readonly maxRows?: number;
  readonly defaultTableRows?: number;
  readonly tableRows?: Record<string, number>;
  readonly severities?: {
    readonly rowCount?: 'warn' | 'error';
    readonly latency?: 'warn' | 'error';
  };
}

interface PlanMetaLike {
  readonly lane?: string;
  readonly refs?: { tables?: string[] };
}

interface DslAstLike {
  readonly kind: 'select';
  readonly limit?: number;
}

function budgetError(code: string, message: string, details?: Record<string, unknown>) {
  const error = new Error(message) as Error & {
    code: string;
    category: 'BUDGET';
    severity: 'error' | 'warn' | 'info';
    details?: Record<string, unknown>;
  };
  (error as any).code = code;
  (error as any).category = 'BUDGET';
  (error as any).severity = 'error';
  if (details) (error as any).details = details;
  return error;
}

export function budgets(options?: BudgetsOptions): Plugin {
  const maxRows = options?.maxRows ?? 10_000;
  const defaultTableRows = options?.defaultTableRows ?? 10_000;
  const tableRows = options?.tableRows ?? {};
  const rowSeverity = options?.severities?.rowCount ?? 'error';

  let observedRows = 0;
  let start = 0;

  function estimateRows(plan: any): number | null {
    const meta = (plan?.meta ?? {}) as PlanMetaLike;
    const lane = meta.lane ?? undefined;

    // Only DSL lane has AST we can trust for LIMIT in MVP
    if (lane !== 'dsl') return null;

    const ast = plan?.ast as DslAstLike | undefined;
    const table = meta.refs?.tables?.[0];
    if (!table) return null;

    const tableEstimate = tableRows[table] ?? defaultTableRows;

    if (typeof ast?.limit !== 'number') {
      // Unbounded read
      return tableEstimate;
    }

    return Math.min(ast.limit, tableEstimate);
  }

  return Object.freeze({
    name: 'budgets',

    async beforeExecute(plan: any, ctx: PluginContext) {
      observedRows = 0;
      start = ctx.now();

      const estimated = estimateRows(plan);
      if (estimated === null) {
        // Unknown lane: rely on post-check during streaming
        return;
      }

      if (typeof estimated === 'number' && estimated > maxRows) {
        const err = budgetError('BUDGET.ROWS_EXCEEDED', 'Estimated row count exceeds budget', {
          estimatedRows: estimated,
          maxRows,
          source: 'heuristic',
        });
        if (rowSeverity === 'error' || ctx.mode === 'strict') {
          throw err;
        }
        ctx.log.warn({ code: err.code, message: err.message, details: (err as any).details });
      }
    },

    async onRow(_row: unknown, _plan: any, _ctx: PluginContext) {
      observedRows += 1;
      if (observedRows > maxRows) {
        throw budgetError('BUDGET.ROWS_EXCEEDED', 'Observed row count exceeds budget', {
          observedRows,
          maxRows,
          source: 'observed',
        });
      }
    },

    async afterExecute(_plan: any, result, ctx) {
      const latencyMs = ctx.now() - start;
      // Latency budget wiring deferred; emit advisory if configured later.
      ctx.log.info({ event: 'afterExecute', latencyMs, rowCount: result.rowCount });
    },
  });
}



