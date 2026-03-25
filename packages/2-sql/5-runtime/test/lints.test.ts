import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type { PluginContext } from '@prisma-next/runtime-executor';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { lints } from '../src/plugins/lints';

function createPluginContext(): PluginContext<unknown, unknown, unknown> {
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
    meta: { ...baseMeta, ...(metaOverrides ?? {}) } as PlanMeta,
    ...rest,
  } as ExecutionPlan;
}

const userTable = TableSource.named('user');
const idCol = ColumnRef.of('user', 'id');

describe('lints plugin', () => {
  it(
    'blocks delete without where',
    async () => {
      const plan = createPlan({ ast: DeleteAst.from(userTable) });
      const plugin = lints();
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.DELETE_WITHOUT_WHERE',
        details: { table: 'user' },
      });
    },
    timeouts.default,
  );

  it(
    'blocks update without where',
    async () => {
      const plan = createPlan({
        ast: UpdateAst.table(userTable).withSet({ email: ParamRef.of(1, 'email') }),
      });
      const plugin = lints();
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.UPDATE_WITHOUT_WHERE',
        details: { table: 'user' },
      });
    },
    timeouts.default,
  );

  it(
    'warns for unbounded selects and selectAll intent',
    async () => {
      const ast = SelectAst.from(userTable)
        .withProjection([ProjectionItem.of('id', idCol)])
        .withSelectAllIntent({ table: 'user' });
      const plan = createPlan({ ast });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.NO_LIMIT', details: { table: 'user' } }),
      );
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'LINT.SELECT_STAR', details: { table: 'user' } }),
      );
    },
    timeouts.default,
  );

  it(
    'uses derived table aliases when reporting unbounded selects',
    async () => {
      const derived = DerivedTableSource.as(
        'user_ids',
        SelectAst.from(userTable).withProjection([ProjectionItem.of('id', idCol)]),
      );
      const ast = SelectAst.from(derived).withProjection([
        ProjectionItem.of('id', ColumnRef.of('user_ids', 'id')),
      ]);
      const plan = createPlan({ ast });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
          details: { table: 'user_ids' },
        }),
      );
    },
    timeouts.default,
  );

  it(
    'allows bounded selects and guarded mutations',
    async () => {
      const selectPlan = createPlan({
        ast: SelectAst.from(userTable)
          .withProjection([ProjectionItem.of('id', idCol)])
          .withWhere(BinaryExpr.eq(idCol, ParamRef.of(1)))
          .withLimit(10),
      });
      const updatePlan = createPlan({
        ast: UpdateAst.table(userTable)
          .withSet({ email: ParamRef.of(1, 'email') })
          .withWhere(BinaryExpr.eq(idCol, ParamRef.of(2, 'id'))),
      });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(selectPlan, ctx);
      await plugin.beforeExecute?.(updatePlan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    },
    timeouts.default,
  );
});
