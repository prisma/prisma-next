import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type { AfterExecuteResult, PluginContext } from '@prisma-next/runtime-executor';
import {
  AggregateExpr,
  ColumnRef,
  DeleteAst,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { budgets } from '../src/plugins/budgets';

const userTable = TableSource.named('user');
const idCol = ColumnRef.of('user', 'id');

function createPluginContext(
  overrides?: Partial<PluginContext<unknown, unknown, unknown>>,
): PluginContext<unknown, unknown, unknown> {
  return {
    contract: {},
    adapter: {},
    driver: {},
    mode: 'strict' as const,
    now: () => Date.now(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ...overrides,
  };
}

const baseMeta: PlanMeta = {
  target: 'postgres',
  storageHash: 'sha256:test',
  lane: 'dsl',
  paramDescriptors: [],
};

type PlanOverrides = Partial<Omit<ExecutionPlan, 'meta'>> & { meta?: Partial<PlanMeta> };

function createPlan(overrides: PlanOverrides): ExecutionPlan {
  const { meta: metaOverrides, ...rest } = overrides;
  return {
    sql: 'SELECT 1',
    params: [],
    meta: { ...baseMeta, ...(metaOverrides ?? {}) } as unknown as PlanMeta,
    ...rest,
  } as unknown as ExecutionPlan;
}

describe('budgets plugin', () => {
  describe('heuristic row budget (no AST)', () => {
    it(
      'throws for unbounded raw SELECT exceeding budget',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id, email FROM "user"',
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'throws for unbounded raw SELECT even without table refs',
      async () => {
        const plan = createPlan({
          sql: 'SELECT 1',
        });
        const plugin = budgets({ maxRows: 50 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'allows bounded raw SELECT with limit annotation within budget',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id FROM "user" LIMIT 5',
          meta: {
            refs: { tables: ['user'] },
            annotations: { limit: 5 },
          },
        });
        const plugin = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'throws when estimated rows exceed budget for bounded query',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id FROM "user" LIMIT 500',
          meta: {
            refs: { tables: ['user'] },
            annotations: { limit: 500 },
          },
        });
        const plugin = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
          details: expect.objectContaining({ source: 'heuristic' }),
        });
      },
      timeouts.default,
    );

    it(
      'uses tableRows config for estimation',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id FROM "user"',
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 100, tableRows: { user: 50 } });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
        });
      },
      timeouts.default,
    );

    it(
      'does not check row budget for non-SELECT statements',
      async () => {
        const plan = createPlan({
          sql: 'INSERT INTO "user" (id, email) VALUES ($1, $2)',
        });
        const plugin = budgets({ maxRows: 1 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
      },
      timeouts.default,
    );
  });

  describe('observed row count (onRow)', () => {
    it(
      'throws when observed rows exceed budget',
      async () => {
        const plugin = budgets({ maxRows: 2 });
        const plan = createPlan({
          sql: 'INSERT INTO "user" (id) VALUES ($1)',
        });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        await plugin.onRow?.({}, plan, ctx);
        await plugin.onRow?.({}, plan, ctx);
        await expect(plugin.onRow?.({}, plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'observed' }),
        });
      },
      timeouts.default,
    );
  });

  describe('latency budget (afterExecute)', () => {
    it(
      'warns when latency exceeds budget in non-strict mode',
      async () => {
        const plugin = budgets({ maxLatencyMs: 100, severities: { latency: 'warn' } });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createPluginContext({ mode: 'permissive' });
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 200, completed: true };

        await plugin.afterExecute?.(plan, result, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.TIME_EXCEEDED' }),
        );
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget in strict mode with error severity',
      async () => {
        const plugin = budgets({ maxLatencyMs: 100, severities: { latency: 'error' } });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createPluginContext({ mode: 'strict' });
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 200, completed: true };

        await expect(plugin.afterExecute?.(plan, result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'does not warn when latency is within budget',
      async () => {
        const plugin = budgets({ maxLatencyMs: 1000 });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createPluginContext();
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 50, completed: true };

        await plugin.afterExecute?.(plan, result, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );
  });

  describe('EXPLAIN fallback', () => {
    it(
      'uses EXPLAIN when enabled and driver supports it',
      async () => {
        const explainDriver = {
          explain: vi.fn().mockResolvedValue({
            rows: [{ 'Plan Rows': 50_000 }],
          }),
        };
        const plan = createPlan({
          sql: 'SELECT id FROM "user" LIMIT 100',
          meta: { annotations: { limit: 100 } },
        });
        const plugin = budgets({ maxRows: 10_000, explain: { enabled: true } });
        const ctx = createPluginContext({ driver: explainDriver });

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'explain' }),
        });
      },
      timeouts.default,
    );

    it(
      'falls back gracefully when EXPLAIN fails',
      async () => {
        const explainDriver = {
          explain: vi.fn().mockRejectedValue(new Error('EXPLAIN failed')),
        };
        const plan = createPlan({
          sql: 'SELECT id FROM "user" LIMIT 100',
          meta: { annotations: { limit: 100 } },
        });
        const plugin = budgets({ maxRows: 10_000, explain: { enabled: true } });
        const ctx = createPluginContext({ driver: explainDriver });

        await plugin.beforeExecute?.(plan, ctx);
      },
      timeouts.default,
    );
  });

  describe('severity configuration', () => {
    it(
      'warns instead of throwing when rowCount severity is warn and mode is permissive',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id FROM "user"',
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({
          maxRows: 50,
          defaultTableRows: 10_000,
          severities: { rowCount: 'warn' },
        });
        const ctx = createPluginContext({ mode: 'permissive' });

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.ROWS_EXCEEDED' }),
        );
      },
      timeouts.default,
    );
  });

  describe('AST-based row budget', () => {
    it(
      'allows bounded SelectAst with limit within budget',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withLimit(5);
        const plan = createPlan({
          ast,
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'throws for unbounded SelectAst without limit',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]);
        const plan = createPlan({
          ast,
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          category: 'BUDGET',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );

    it(
      'throws for unbounded SelectAst without table refs',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]);
        const plan = createPlan({ ast });
        const plugin = budgets({ maxRows: 50 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );

    it(
      'reads limit from AST, not from annotations',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withLimit(5);
        const plan = createPlan({
          ast,
          meta: {
            refs: { tables: ['user'] },
            annotations: { limit: 99999 },
          },
        });
        const plugin = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'does not check row budget for non-SelectAst (e.g. DeleteAst)',
      async () => {
        const ast = DeleteAst.from(userTable);
        const plan = createPlan({ ast });
        const plugin = budgets({ maxRows: 1 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
      },
      timeouts.default,
    );

    it(
      'estimates 1 row for aggregate without GROUP BY',
      async () => {
        const ast = SelectAst.from(userTable).withProjection([
          ProjectionItem.of('count', AggregateExpr.count()),
        ]);
        const plan = createPlan({
          ast,
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 1, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'does not reduce estimate for aggregate with GROUP BY',
      async () => {
        const ast = SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('count', AggregateExpr.count())])
          .withGroupBy([idCol]);
        const plan = createPlan({
          ast,
          meta: { refs: { tables: ['user'] } },
        });
        const plugin = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createPluginContext();

        await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );
  });
});
