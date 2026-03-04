import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type { PluginContext } from '@prisma-next/runtime-executor';
import type {
  BinaryExpr,
  DeleteAst,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import {
  createColumnRef,
  createDeleteAst,
  createDerivedTableSource,
  createSelectAst,
  createTableRef,
  createUpdateAst,
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

const userTable = createTableRef('user');
const idCol = createColumnRef('user', 'id');

describe('lints plugin', () => {
  describe('DELETE without WHERE', () => {
    it('blocks execution when ast is delete without where', async () => {
      const deleteAst: DeleteAst = {
        kind: 'delete',
        table: userTable,
      };
      const plan = createPlan({ ast: deleteAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.DELETE_WITHOUT_WHERE',
        message: expect.stringContaining('DELETE without WHERE'),
        details: { table: 'user' },
      });
    });

    it('allows delete with where clause', async () => {
      const where: BinaryExpr = {
        kind: 'bin',
        op: 'eq',
        left: idCol,
        right: { kind: 'param', index: 1 },
      };
      const deleteAst = createDeleteAst({ table: userTable, where });
      const plan = createPlan({ ast: deleteAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });
  });

  describe('UPDATE without WHERE', () => {
    it('blocks execution when ast is update without where', async () => {
      const updateAst: UpdateAst = {
        kind: 'update',
        table: userTable,
        set: { email: { kind: 'param', index: 1 } },
      };
      const plan = createPlan({ ast: updateAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.UPDATE_WITHOUT_WHERE',
        message: expect.stringContaining('UPDATE without WHERE'),
        details: { table: 'user' },
      });
    });

    it('allows update with where clause', async () => {
      const where: BinaryExpr = {
        kind: 'bin',
        op: 'eq',
        left: idCol,
        right: { kind: 'param', index: 1 },
      };
      const updateAst = createUpdateAst({
        table: userTable,
        set: { email: { kind: 'param', index: 2 } },
        where,
      });
      const plan = createPlan({ ast: updateAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });
  });

  describe('Unbounded SELECT', () => {
    it('warns when select lacks limit', async () => {
      const selectAst: SelectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
          message: expect.stringContaining('Unbounded SELECT'),
        }),
      );
    });

    it('allows select with limit', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
        limit: 10,
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it('warns for derived-table selects without assuming a plain table source', async () => {
      const selectAst = createSelectAst({
        from: createDerivedTableSource(
          'user_ids',
          createSelectAst({
            from: userTable,
            project: [{ alias: 'id', expr: idCol }],
          }),
        ),
        project: [{ alias: 'id', expr: createColumnRef('user_ids', 'id') }],
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
          message: expect.stringContaining('Unbounded SELECT'),
          details: { table: 'user_ids' },
        }),
      );
    });

    it('throws when noLimit severity is error', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints({ severities: { noLimit: 'error' } });
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.NO_LIMIT',
        message: expect.stringContaining('Unbounded SELECT'),
      });
    });
  });

  describe('SELECT * intent', () => {
    it('warns when selectAllIntent present on ast', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
        limit: 1,
        selectAllIntent: { table: 'user' },
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.SELECT_STAR',
          message: expect.stringContaining('selectAll intent'),
          details: { table: 'user' },
        }),
      );
    });

    it('warns when selectAllIntent in meta.annotations', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
        limit: 1,
      });
      const plan = createPlan({
        ast: selectAst,
        meta: { annotations: { selectAllIntent: { table: 'user' } } },
      });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.SELECT_STAR',
          message: expect.stringContaining('selectAll intent'),
        }),
      );
    });

    it('allows select without selectAll intent', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
        limit: 1,
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it('throws when selectStar severity is error', async () => {
      const selectAst = createSelectAst({
        from: userTable,
        project: [{ alias: 'id', expr: idCol }],
        limit: 1,
        selectAllIntent: { table: 'user' },
      });
      const plan = createPlan({ ast: selectAst });
      const plugin = lints({ severities: { selectStar: 'error' } });
      const ctx = createPluginContext();

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
        message: expect.stringContaining('selectAll intent'),
      });
    });
  });

  describe('fallback when plan.ast missing', () => {
    it(
      'runs raw heuristic when fallbackWhenAstMissing is raw',
      async () => {
        const plan = createPlan({
          ast: undefined,
          sql: 'SELECT id FROM user',
          params: [],
          meta: {},
        });
        const plugin = lints({ fallbackWhenAstMissing: 'raw' });
        const ctx = createPluginContext();

        await plugin.beforeExecute?.(plan, ctx);
        expect(ctx.log.warn).toHaveBeenCalledWith(
          expect.objectContaining({
            code: 'LINT.NO_LIMIT',
            message: expect.stringContaining('omits LIMIT'),
          }),
        );
      },
      timeouts.default,
    );

    it('skips linting when fallbackWhenAstMissing is skip', async () => {
      const plan = createPlan({
        ast: undefined,
        sql: 'SELECT * FROM user',
        params: [],
        meta: {},
      });
      const plugin = lints({ fallbackWhenAstMissing: 'skip' });
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it('defaults to raw fallback when ast missing', async () => {
      const plan = createPlan({
        ast: undefined,
        sql: 'SELECT id FROM user',
        params: [],
        meta: {},
      });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
          message: expect.stringContaining('omits LIMIT'),
        }),
      );
    });
  });

  describe('INSERT', () => {
    it('passes when ast is insert', async () => {
      const plan = createPlan({
        ast: {
          kind: 'insert',
          table: userTable,
          values: { email: { kind: 'param', index: 1 } },
        },
      });
      const plugin = lints();
      const ctx = createPluginContext();

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
    });
  });
});
