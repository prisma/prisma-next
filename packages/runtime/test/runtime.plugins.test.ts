import { validateContract } from '@prisma-next/sql-query/schema';
import type { Plan } from '@prisma-next/sql-query/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { Plugin } from '../src/plugins/types';
import { createRuntime } from '../src/runtime';
import { drainPlanExecution } from './utils';

describe('Runtime class', () => {
  const mockContractRaw: SqlContract<SqlStorage> = {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'sha256:test-core',
    profileHash: 'sha256:test-profile',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
          },
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  };
  const mockContract = validateContract(mockContractRaw);

  const mockPlan: Plan = {
    sql: 'SELECT id, email FROM "user" LIMIT 1',
    params: [],
    meta: {
      target: 'postgres',
      coreHash: 'sha256:test-core',
      lane: 'dsl',
      paramDescriptors: [],
      refs: { tables: ['user'], columns: [] },
      projection: { id: 'user.id', email: 'user.email' },
    },
    ast: {
      kind: 'select',
      from: { kind: 'table', name: 'user' },
      project: [],
      limit: 1,
    },
  } as Plan;

  const createMockDriver = (): SqlDriver => ({
    connect: vi.fn(),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    execute: vi.fn().mockImplementation(async function* () {
      yield { id: 1, email: 'test@example.com' };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  });

  describe('plugin hooks', () => {
    it('invokes beforeExecute hook', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const beforeExecute = vi.fn().mockResolvedValue(undefined);

      const plugin: Plugin = {
        name: 'test-plugin',
        beforeExecute,
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await drainPlanExecution(runtime, mockPlan);

      expect(beforeExecute).toHaveBeenCalledWith(mockPlan, expect.any(Object));
    });

    it('invokes onRow hook for each row', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const onRow = vi.fn().mockResolvedValue(undefined);

      const plugin: Plugin = {
        name: 'test-plugin',
        onRow,
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        yield { id: 1, email: 'test1@example.com' };
        yield { id: 2, email: 'test2@example.com' };
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await drainPlanExecution(runtime, mockPlan);

      expect(onRow).toHaveBeenCalledTimes(2);
    });

    it('invokes afterExecute hook on success', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const afterExecute = vi.fn().mockResolvedValue(undefined);

      const plugin: Plugin = {
        name: 'test-plugin',
        afterExecute,
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      // Consume all rows to ensure afterExecute is called
      await drainPlanExecution(runtime, mockPlan);

      expect(afterExecute).toHaveBeenCalledWith(
        mockPlan,
        expect.objectContaining({
          rowCount: expect.any(Number),
          latencyMs: expect.any(Number),
          completed: true,
        }),
        expect.any(Object),
      );
    });

    it('invokes afterExecute hook on error', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const afterExecute = vi.fn().mockResolvedValue(undefined);

      const plugin: Plugin = {
        name: 'test-plugin',
        afterExecute,
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        yield { id: 1, email: 'test@example.com' };
        throw new Error('Execution failed');
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await expect(async () => {
        for await (const _row of runtime.execute(mockPlan)) {
          void _row;
          // Consume first row before error
        }
      }).rejects.toThrow();

      expect(afterExecute).toHaveBeenCalledWith(
        mockPlan,
        expect.objectContaining({
          rowCount: expect.any(Number),
          latencyMs: expect.any(Number),
          completed: false,
        }),
        expect.any(Object),
      );
    });

    it('swallows errors from afterExecute hook', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const afterExecute = vi.fn().mockRejectedValue(new Error('Plugin error'));

      const plugin: Plugin = {
        name: 'test-plugin',
        afterExecute,
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });
      // biome-ignore lint: generator function without yield for test
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        throw new Error('Execution failed');
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await expect(async () => {
        await drainPlanExecution(runtime, mockPlan);
      }).rejects.toThrow('Execution failed');

      expect(afterExecute).toHaveBeenCalled();
    });

    it('invokes multiple plugins in order', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const callOrder: string[] = [];

      const plugin1: Plugin = {
        name: 'plugin-1',
        beforeExecute: vi.fn().mockImplementation(async () => {
          callOrder.push('before-1');
        }),
        afterExecute: vi.fn().mockImplementation(async () => {
          callOrder.push('after-1');
        }),
      };

      const plugin2: Plugin = {
        name: 'plugin-2',
        beforeExecute: vi.fn().mockImplementation(async () => {
          callOrder.push('before-2');
        }),
        afterExecute: vi.fn().mockImplementation(async () => {
          callOrder.push('after-2');
        }),
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin1, plugin2],
      });

      // Consume all rows to ensure afterExecute is called
      await drainPlanExecution(runtime, mockPlan);

      expect(callOrder).toEqual(['before-1', 'before-2', 'after-1', 'after-2']);
    });
  });
});
