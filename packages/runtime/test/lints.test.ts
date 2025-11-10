import type { Plan } from '@prisma-next/contract/types';
import { describe, expect, it, vi } from 'vitest';
import { lints } from '../src/plugins/lints';
import type { PluginContext } from '../src/plugins/types';

describe('lints plugin', () => {
  const createMockContext = (): PluginContext => ({
    contract: {} as PluginContext['contract'],
    adapter: {} as PluginContext['adapter'],
    driver: {} as PluginContext['driver'],
    mode: 'strict',
    now: () => Date.now(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  describe('beforeExecute', () => {
    it('ignores DSL plans', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT * FROM "user"',
        params: [],
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
        },
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: [], columns: [] },
          projection: {},
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).not.toHaveBeenCalled();
      expect(ctx.log.error).not.toHaveBeenCalled();
    });

    it('throws error for SELECT * in raw plans', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
      });
    });

    it('logs warning for missing LIMIT in raw SELECT', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.NO_LIMIT',
        }),
      );
    });

    it('does not warn for SELECT with LIMIT', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).not.toHaveBeenCalled();
    });

    it('throws error for mutation with read-only intent', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'INSERT INTO "user" (email) VALUES ($1)',
        params: ['test@example.com'],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
          annotations: { intent: 'read' },
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.READ_ONLY_MUTATION',
      });
    });

    it('logs warning for unindexed predicate when refs provided', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user" WHERE email = $1 LIMIT 1',
        params: ['test@example.com'],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
          refs: {
            tables: ['user'],
            columns: [{ table: 'user', column: 'email' }],
            indexes: [],
          },
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.UNINDEXED_PREDICATE',
        }),
      );
    });

    it('does not warn for indexed predicate', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user" WHERE email = $1',
        params: ['test@example.com'],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
          refs: {
            tables: ['user'],
            columns: [{ table: 'user', column: 'email' }],
            indexes: [
              {
                table: 'user',
                columns: ['email'],
              },
            ],
          },
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.UNINDEXED_PREDICATE',
        }),
      );
    });

    it('respects configured severity overrides', async () => {
      const plugin = lints({
        severities: {
          selectStar: 'warn',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await plugin.beforeExecute?.(plan, ctx);

      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LINT.SELECT_STAR',
        }),
      );
    });

    it('respects configured severity to upgrade warn to error', async () => {
      const plugin = lints({
        severities: {
          noLimit: 'error',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.NO_LIMIT',
      });
    });

    it('respects configured severity for selectStar', async () => {
      const plugin = lints({
        severities: {
          selectStar: 'error',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT * FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
      });
    });

    it('respects configured severity for readOnlyMutation', async () => {
      const plugin = lints({
        severities: {
          readOnlyMutation: 'error',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'INSERT INTO "user" (id) VALUES (1)',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
          annotations: { intent: 'read' },
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.READ_ONLY_MUTATION',
      });
    });

    it('respects configured severity for unindexedPredicate', async () => {
      const plugin = lints({
        severities: {
          unindexedPredicate: 'error',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user" WHERE email = $1',
        params: ['test@example.com'],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
          refs: {
            tables: ['user'],
            columns: [{ table: 'user', column: 'email' }],
          },
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.UNINDEXED_PREDICATE',
      });
    });

    it('returns undefined for unknown lint code', async () => {
      const plugin = lints({
        severities: {
          selectStar: 'warn',
        },
      });
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
    });

    it('handles WITH statement containing SELECT', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'WITH users AS (SELECT id FROM "user") SELECT * FROM users',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'LINT.SELECT_STAR',
      });
    });

    it('handles WITH statement without SELECT', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'WITH users AS (INSERT INTO "user" (id) VALUES (1) RETURNING id) INSERT INTO "post" (user_id) VALUES (1)',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
      expect(ctx.log.error).not.toHaveBeenCalled();
    });

    it('handles other statement types', async () => {
      const plugin = lints();
      const ctx = createMockContext();
      const plan: Plan = {
        sql: 'CREATE TABLE "user" (id INTEGER)',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test',
          lane: 'raw',
          paramDescriptors: [],
        },
      };

      await plugin.beforeExecute?.(plan, ctx);
      expect(ctx.log.warn).not.toHaveBeenCalled();
      expect(ctx.log.error).not.toHaveBeenCalled();
    });
  });
});
