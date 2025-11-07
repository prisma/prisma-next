import type { Plan } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
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

      await drainPlanExecution(runtime, mockPlan);

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

      await drainPlanExecution(runtime, mockPlan);

      const firstCallCount = (mockDriver.query as ReturnType<typeof vi.fn>).mock.calls.length;

      await drainPlanExecution(runtime, mockPlan);

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
      const promise = drainPlanExecution(runtime, mockPlan);
      await expect(promise).resolves.not.toThrow();
    });
  });
});
