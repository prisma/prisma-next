/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { describe, it, expect, vi } from 'vitest';
import { createRuntime } from '../src/runtime';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { Plan } from '@prisma-next/sql-query/types';
import type { SqlDriver } from '@prisma-next/sql-target';
import type { Plugin } from '../src/plugins/types';
import { validateContract } from '@prisma-next/sql-query/schema';
import { drainPlanExecution, executePlanAndCollect } from './utils';

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


  describe('constructor', () => {
    it('validates codec registry at startup when verify.mode is startup', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      // With a complete registry, startup mode should succeed
      expect(() => {
        createRuntime({
          contract: mockContract,
          adapter,
          driver: mockDriver,
          verify: { mode: 'startup', requireMarker: false },
        });
      }).not.toThrow();
    });

    it('does not validate codec registry immediately when verify.mode is not startup', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      // Should create runtime without validation
      expect(() => {
        createRuntime({
          contract: mockContract,
          adapter,
          driver: mockDriver,
          verify: { mode: 'onFirstUse', requireMarker: false },
        });
      }).not.toThrow();
    });

    it('defaults mode to strict', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      expect((runtime as unknown as { mode: string }).mode).toBe('strict');
    });

    it('uses permissive mode when specified', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        mode: 'permissive',
      });

      expect((runtime as unknown as { mode: string }).mode).toBe('permissive');
    });
  });

  describe('codec registry validation', () => {
    it('validates codec registry lazily on first execute when not startup mode', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      // Should not throw with complete registry
      await expect(executePlan(runtime, mockPlan)).resolves.not.toThrow();
    });

    it('throws when codec registry is incomplete on first execute', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const contractWithUnknownType: SqlContract<SqlStorage> = {
        ...mockContract,
        storage: {
          tables: {
            user: {
              columns: {
                id: { type: 'pg/int4@1', nullable: false },
                email: { type: 'pg/text@1', nullable: false },
                unknown: { type: 'unknown-scalar-type', nullable: false },
              },
            },
          },
        },
      };

      const runtime = createRuntime({
        contract: contractWithUnknownType,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const planWithUnknownType: Plan = {
        ...mockPlan,
        meta: {
          ...mockPlan.meta,
          coreHash: contractWithUnknownType.coreHash,
        },
      };

      await expect(executePlan(runtime, planWithUnknownType)).rejects.toMatchObject({
        code: 'RUNTIME.CODEC_MISSING',
      });
    });
  });

  describe('validatePlan', () => {
    it('throws PLAN.TARGET_MISMATCH when plan target differs from contract', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      const mismatchedPlan: Plan = {
        ...mockPlan,
        meta: {
          ...mockPlan.meta,
          target: 'mysql',
        },
      };

      await expect(executePlan(runtime, mismatchedPlan)).rejects.toMatchObject({
        code: 'PLAN.TARGET_MISMATCH',
        category: 'PLAN',
      });
    });

    it('throws PLAN.HASH_MISMATCH when plan coreHash differs from contract', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      const mismatchedPlan: Plan = {
        ...mockPlan,
        meta: {
          ...mockPlan.meta,
          coreHash: 'sha256:mismatch',
        },
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      await expect(executePlan(runtime, mismatchedPlan)).rejects.toMatchObject({
        code: 'PLAN.HASH_MISMATCH',
        category: 'PLAN',
      });
    });
  });

  describe('verifyPlanIfNeeded', () => {
    it('verifies contract marker on first execute when mode is startup', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:test-profile',
          },
        ],
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'startup', requireMarker: true },
      });

      await executePlan(runtime, mockPlan);

      expect(mockDriver.query).toHaveBeenCalled();
    });

    it('verifies contract marker on every execute when mode is always', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:test-profile',
          },
        ],
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'always', requireMarker: true },
      });

      await executePlan(runtime, mockPlan);

      const firstCallCount = (mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length;

      await executePlan(runtime, mockPlan);

      expect((mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        firstCallCount,
      );
    });

    it('throws CONTRACT.MARKER_MISSING when marker required but not found', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      await expect(async () => {
        await drainPlanExecution(runtime, mockPlan);
      }).rejects.toMatchObject({
        code: 'CONTRACT.MARKER_MISSING',
        category: 'CONTRACT',
      });
    });

    it('throws CONTRACT.MARKER_MISMATCH when profile hash differs', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:mismatch',
          },
        ],
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      await expect(async () => {
        await drainPlanExecution(runtime, mockPlan);
      }).rejects.toMatchObject({
        code: 'CONTRACT.MARKER_MISMATCH',
        category: 'CONTRACT',
      });
    });

    it('does not check profile hash when contract profileHash is null', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const contractWithoutProfile: SqlContract<SqlStorage> = {
        schemaVersion: '1',
        target: 'postgres',
        targetFamily: 'sql',
        coreHash: 'sha256:test-core',
        storage: mockContract.storage,
        models: {},
        relations: {},
        mappings: {},
      };

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:different',
          },
        ],
      });

      const runtime = createRuntime({
        contract: contractWithoutProfile,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      // Should not throw when profileHash is null in contract
      const promise = executePlan(runtime, mockPlan);
      await expect(promise).resolves.not.toThrow();
    });
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

      await executePlan(runtime, mockPlan);

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
      // eslint-disable-next-line require-yield
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

  describe('telemetry and diagnostics', () => {
    it('records success telemetry with duration', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      // Consume all rows to ensure telemetry is recorded
      await drainPlanExecution(runtime, mockPlan);

      const telemetry = runtime.telemetry();
      expect(telemetry).toMatchObject({
        outcome: 'success',
        lane: 'dsl',
        target: 'postgres',
        fingerprint: expect.any(String),
        durationMs: expect.any(Number),
      });
    });

    it('records runtime-error telemetry on execution failure', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });
      // eslint-disable-next-line require-yield
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        throw new Error('Driver error');
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      await expect(drainPlanExecution(runtime, mockPlan)).rejects.toThrow();

      const telemetry = runtime.telemetry();
      expect(telemetry).toMatchObject({
        outcome: 'runtime-error',
        durationMs: expect.any(Number),
      });
    });

    it('resets telemetry between executions', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      // Consume all rows
      await drainPlanExecution(runtime, mockPlan);

      const firstTelemetry = runtime.telemetry();
      expect(firstTelemetry).not.toBeNull();

      // Consume all rows again
      await drainPlanExecution(runtime, mockPlan);

      const secondTelemetry = runtime.telemetry();
      expect(secondTelemetry).not.toBeNull();
      expect(secondTelemetry).not.toBe(firstTelemetry);
    });

    it('returns null telemetry initially', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      expect(runtime.telemetry()).toBeNull();
    });
  });

  describe('close', () => {
    it('calls driver.close', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      await runtime.close();

      expect(mockDriver.close).toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    it('handles empty result set', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        // Empty result set
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      const rows: unknown[] = [];
      const collectedRows = await executePlanAndCollect<Record<string, unknown>>(runtime, mockPlan);
      rows.push(...collectedRows);

      expect(rows).toEqual([]);

      const telemetry = runtime.telemetry();
      expect(telemetry).toMatchObject({
        outcome: 'success',
        lane: 'dsl',
        target: 'postgres',
      });
    });

    it('handles plugin beforeExecute throwing error', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const plugin: Plugin = {
        name: 'error-plugin',
        beforeExecute: vi.fn().mockRejectedValue(new Error('Plugin error')),
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await expect(
        (async () => {
      await drainPlanExecution(runtime, mockPlan);
        })(),
      ).rejects.toThrow('Plugin error');
    });

    it('handles plugin onRow throwing error', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const plugin: Plugin = {
        name: 'error-plugin',
        onRow: vi.fn().mockRejectedValue(new Error('Row processing error')),
      };

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        plugins: [plugin],
      });

      await expect(
        (async () => {
          for await (const _row of runtime.execute(mockPlan)) {
            void _row;
            // Consume row
          }
        })(),
      ).rejects.toThrow('Row processing error');
    });

    it('handles already verified state in verifyPlanIfNeeded', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:test-profile',
          },
        ],
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: true },
      });

      // First execute - verifies
      await drainPlanExecution(runtime, mockPlan);

      const firstCallCount = (mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second execute - should skip verification
      await drainPlanExecution(runtime, mockPlan);

      // Should not call query again for verification
      expect((mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length).toBe(firstCallCount);
    });

    it('handles verify.mode always resetting verified flag', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:test-profile',
          },
        ],
      });

      const runtime = createRuntime({
        contract: mockContract,
        adapter,
        driver: mockDriver,
        verify: { mode: 'always', requireMarker: true },
      });

      // First execute
      await drainPlanExecution(runtime, mockPlan);

      const firstCallCount = (mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length;

      // Second execute - should verify again
      await drainPlanExecution(runtime, mockPlan);

      // Should call query again for verification
      expect((mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        firstCallCount,
      );
    });
  });
});
