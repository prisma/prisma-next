import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type { AfterExecuteResult, MiddlewareContext } from '@prisma-next/runtime-executor';
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
import { budgets } from '../src/middleware/budgets';

const userTable = TableSource.named('user');
const idCol = ColumnRef.of('user', 'id');

function createMiddlewareContext(
  overrides?: Partial<MiddlewareContext<unknown>>,
): MiddlewareContext<unknown> {
  return {
    contract: {},
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

describe('budgets middleware', () => {
  describe('heuristic row budget (no AST)', () => {
    it(
      'throws for unbounded raw SELECT exceeding budget',
      async () => {
        const plan = createPlan({
          sql: 'SELECT id, email FROM "user"',
          meta: { refs: { tables: ['user'] } },
        });
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 50 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
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
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 100, tableRows: { user: 50 } });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 1 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
      },
      timeouts.default,
    );
  });

  describe('observed row count (onRow)', () => {
    it(
      'throws when observed rows exceed budget',
      async () => {
        const mw = budgets({ maxRows: 2 });
        const plan = createPlan({
          sql: 'INSERT INTO "user" (id) VALUES ($1)',
        });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
        await mw.onRow?.({}, plan, ctx);
        await mw.onRow?.({}, plan, ctx);
        await expect(mw.onRow?.({}, plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'observed' }),
        });
      },
      timeouts.default,
    );

    it(
      'tracks row counts independently per execution plan',
      async () => {
        const mw = budgets({ maxRows: 2 });
        const planA = createPlan({ sql: 'INSERT INTO "user" (id) VALUES ($1)' });
        const planB = createPlan({ sql: 'INSERT INTO "user" (id) VALUES ($2)' });
        const ctxA = createMiddlewareContext();
        const ctxB = createMiddlewareContext();

        await mw.beforeExecute?.(planA, ctxA);
        await mw.beforeExecute?.(planB, ctxB);

        await mw.onRow?.({}, planA, ctxA);
        await mw.onRow?.({}, planB, ctxB);
        await mw.onRow?.({}, planA, ctxA);
        await mw.onRow?.({}, planB, ctxB);

        await expect(mw.onRow?.({}, planA, ctxA)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
        });
        await expect(mw.onRow?.({}, planB, ctxB)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
        });
      },
      timeouts.default,
    );
  });

  describe('latency budget (afterExecute)', () => {
    it(
      'warns when latency exceeds budget in non-strict mode',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'warn' } });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createMiddlewareContext({ mode: 'permissive' });
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 200, completed: true };

        await mw.afterExecute?.(plan, result, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({ code: 'BUDGET.TIME_EXCEEDED' }),
        );
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget in strict mode with error severity',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'error' } });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createMiddlewareContext({ mode: 'strict' });
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 200, completed: true };

        await expect(mw.afterExecute?.(plan, result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'throws when latency exceeds budget in strict mode even with warn severity',
      async () => {
        const mw = budgets({ maxLatencyMs: 100, severities: { latency: 'warn' } });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createMiddlewareContext({ mode: 'strict' });
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 200, completed: true };

        await expect(mw.afterExecute?.(plan, result, ctx)).rejects.toMatchObject({
          code: 'BUDGET.TIME_EXCEEDED',
          category: 'BUDGET',
        });
      },
      timeouts.default,
    );

    it(
      'does not warn when latency is within budget',
      async () => {
        const mw = budgets({ maxLatencyMs: 1000 });
        const plan = createPlan({ sql: 'SELECT 1', meta: { annotations: { limit: 1 } } });
        const ctx = createMiddlewareContext();
        const result: AfterExecuteResult = { rowCount: 1, latencyMs: 50, completed: true };

        await mw.afterExecute?.(plan, result, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
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
        const mw = budgets({
          maxRows: 50,
          defaultTableRows: 10_000,
          severities: { rowCount: 'warn' },
        });
        const ctx = createMiddlewareContext({ mode: 'permissive' });

        await mw.beforeExecute?.(plan, ctx);
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
        const mw = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
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
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 50 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
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
        const mw = budgets({ maxRows: 10_000, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).not.toHaveBeenCalled();
      },
      timeouts.default,
    );

    it(
      'does not check row budget for non-SelectAst (e.g. DeleteAst)',
      async () => {
        const ast = DeleteAst.from(userTable);
        const plan = createPlan({ ast });
        const mw = budgets({ maxRows: 1 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
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
        const mw = budgets({ maxRows: 1, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await mw.beforeExecute?.(plan, ctx);
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
        const mw = budgets({ maxRows: 50, defaultTableRows: 10_000 });
        const ctx = createMiddlewareContext();

        await expect(mw.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
          code: 'BUDGET.ROWS_EXCEEDED',
          details: expect.objectContaining({ source: 'ast' }),
        });
      },
      timeouts.default,
    );
  });
});
