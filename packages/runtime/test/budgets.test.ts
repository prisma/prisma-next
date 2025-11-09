import type { Plan } from '@prisma-next/contract/types';
import type { SqlDriver } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { budgets } from '../src/plugins/budgets';
import type { PluginContext } from '../src/plugins/types';
import { createRuntime } from '../src/runtime';
import { createTestContext, createTestContract, drainPlanExecution } from './utils';

describe('budgets plugin', () => {
  const mockContract = createTestContract({
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test-core',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    models: {},
    relations: {},
    mappings: {
      codecTypes: {},
      operationTypes: {},
    },
  });

  const createMockDriver = (): SqlDriver => ({
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    execute: vi.fn().mockImplementation(async function* () {
      yield { id: 1 };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });

  const createMockContext = (driver: SqlDriver): PluginContext => ({
    contract: mockContract,
    adapter: createPostgresAdapter(),
    driver,
    mode: 'permissive',
    now: () => Date.now(),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  });

  describe('beforeExecute', () => {
    it('allows DSL plan with limit within budget', async () => {
      const plugin = budgets({ maxRows: 1000 });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
          limit: 10,
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
    });

    it('blocks DSL plan with limit exceeding budget in strict mode', async () => {
      const plugin = budgets({ maxRows: 100 });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 200',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
          limit: 200,
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);
      ctx.mode = 'strict';

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });
    });

    it('warns DSL plan with limit exceeding budget in permissive mode', async () => {
      const plugin = budgets({ maxRows: 100, severities: { rowCount: 'warn' } });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 200',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
          limit: 200,
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BUDGET.ROWS_EXCEEDED',
        }),
      );
    });

    it('uses table-specific row estimates', async () => {
      const plugin = budgets({
        maxRows: 100,
        defaultTableRows: 50,
        tableRows: { user: 200 },
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);
      ctx.mode = 'strict';

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
      });
    });

    it('uses explain when available for raw plans', async () => {
      const plugin = budgets({
        maxRows: 100,
        explain: { enabled: true },
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'raw',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
      };

      const driver = createMockDriver();
      driver.explain = vi.fn().mockResolvedValue({
        rows: [{ 'Plan Rows': 50 }],
      });
      const ctx = createMockContext(driver);

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
      expect(driver.explain).toHaveBeenCalled();
    });

    it('blocks raw plan with explain showing rows exceeding budget', async () => {
      const plugin = budgets({
        maxRows: 100,
        explain: { enabled: true },
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'raw',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
      };

      const driver = createMockDriver();
      driver.explain = vi.fn().mockResolvedValue({
        rows: [{ 'Plan Rows': 200 }],
      });
      const ctx = createMockContext(driver);
      ctx.mode = 'strict';

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
      });
    });

    it('handles explain failure gracefully', async () => {
      const plugin = budgets({
        maxRows: 100,
        defaultTableRows: 50, // Low estimate so heuristic doesn't block
        explain: { enabled: true },
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'raw',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
          annotations: { limit: 10 },
        },
      };

      const driver = createMockDriver();
      driver.explain = vi.fn().mockRejectedValue(new Error('Explain failed'));
      const ctx = createMockContext(driver);

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
    });

    it('blocks unbounded raw SELECT without detectable limit', async () => {
      const plugin = budgets({
        maxRows: 100,
        defaultTableRows: 200, // Exceeds maxRows
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'raw',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);
      ctx.mode = 'strict';

      await expect(plugin.beforeExecute?.(plan, ctx)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
      });
    });

    it('allows raw SELECT with limit annotation', async () => {
      const plugin = budgets({ maxRows: 100 });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'raw',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
          annotations: { limit: 10 },
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await expect(plugin.beforeExecute?.(plan, ctx)).resolves.not.toThrow();
    });
  });

  describe('onRow', () => {
    it('throws when observed rows exceed budget', async () => {
      const plugin = budgets({
        maxRows: 2,
        defaultTableRows: 1, // Low estimate so beforeExecute doesn't block
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
          limit: 1, // Low limit so beforeExecute doesn't block
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await plugin.beforeExecute?.(plan, ctx);

      await plugin.onRow?.({ id: 1 }, plan, ctx);
      await plugin.onRow?.({ id: 2 }, plan, ctx);

      await expect(plugin.onRow?.({ id: 3 }, plan, ctx)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
        category: 'BUDGET',
      });
    });
  });

  describe('afterExecute', () => {
    it('warns when latency exceeds budget', async () => {
      const plugin = budgets({ maxLatencyMs: 100 });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await plugin.afterExecute?.(plan, { rowCount: 1, latencyMs: 200, completed: true }, ctx);

      expect(ctx.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'BUDGET.TIME_EXCEEDED',
        }),
      );
    });

    it('throws when latency exceeds budget in strict mode with error severity', async () => {
      const plugin = budgets({
        maxLatencyMs: 100,
        severities: { latency: 'error' },
      });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);
      ctx.mode = 'strict';

      await expect(
        plugin.afterExecute?.(plan, { rowCount: 1, latencyMs: 200, completed: true }, ctx),
      ).rejects.toMatchObject({
        code: 'BUDGET.TIME_EXCEEDED',
        category: 'BUDGET',
      });
    });

    it('does not warn when latency is within budget', async () => {
      const plugin = budgets({ maxLatencyMs: 1000 });
      const plan: Plan = {
        sql: 'SELECT id FROM "user"',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
        },
      };

      const driver = createMockDriver();
      const ctx = createMockContext(driver);

      await plugin.afterExecute?.(plan, { rowCount: 1, latencyMs: 50, completed: true }, ctx);

      expect(ctx.log.warn).not.toHaveBeenCalled();
    });
  });

  describe('integration with runtime', () => {
    it('blocks execution when budget exceeded', async () => {
      const adapter = createPostgresAdapter();
      const driver = createMockDriver();
      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
        adapter,
        driver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [budgets({ maxRows: 1 })],
        mode: 'strict',
      });

      const plan: Plan = {
        sql: 'SELECT id FROM "user" LIMIT 10',
        params: [],
        meta: {
          target: 'postgres',
          coreHash: 'sha256:test-core',
          lane: 'dsl',
          paramDescriptors: [],
          refs: { tables: ['user'], columns: [] },
          projection: { id: 'user.id' },
        },
        ast: {
          kind: 'select',
          from: { kind: 'table', name: 'user' },
          project: [],
          limit: 10,
        },
      };

      await expect(drainPlanExecution(runtime, plan)).rejects.toMatchObject({
        code: 'BUDGET.ROWS_EXCEEDED',
      });
    });
  });
});
