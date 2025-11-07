import { validateContract } from '@prisma-next/sql-query/schema';
import type { Plan } from '@prisma-next/sql-query/types';
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
      await expect(drainPlanExecution(runtime, mockPlan)).resolves.not.toThrow();
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

      await expect(drainPlanExecution(runtime, planWithUnknownType)).rejects.toMatchObject({
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

      await expect(drainPlanExecution(runtime, mismatchedPlan)).rejects.toMatchObject({
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

      await expect(drainPlanExecution(runtime, mismatchedPlan)).rejects.toMatchObject({
        code: 'PLAN.HASH_MISMATCH',
        category: 'PLAN',
      });
    });
  });
});
