import { validateContract } from '@prisma-next/sql-query/schema';
import type { Plan } from '@prisma-next/sql-query/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { Plugin } from '../src/plugins/types';
import { createRuntime } from '../src/runtime';
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
      const collectedRows = await executePlanAndCollect(runtime, mockPlan);
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
