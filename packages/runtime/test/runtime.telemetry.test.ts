import type { Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createRuntime } from '../src/runtime';
import { createTestContext, createTestContract, drainPlanExecution } from './utils';

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
  };
  const mockContract = createTestContract(mockContractRaw);

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

  describe('telemetry and diagnostics', () => {
    it('records success telemetry with duration', async () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      mockDriver.query = vi.fn().mockResolvedValue({ rows: [] });

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
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
      // biome-ignore lint: generator function without yield for test
      mockDriver.execute = vi.fn().mockImplementation(async function* () {
        throw new Error('Driver error');
      });

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
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

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
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

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      expect(runtime.telemetry()).toBeNull();
    });
  });
});
