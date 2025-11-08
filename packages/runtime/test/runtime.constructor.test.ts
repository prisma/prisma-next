import { validateContract } from '@prisma-next/sql-query/schema';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createRuntime } from '../src/runtime';
import { createTestContext } from './utils';

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
  const mockContract = validateContract(mockContractRaw);

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
        const context = createTestContext(mockContract, adapter);
        createRuntime({
          context,
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
        const context = createTestContext(mockContract, adapter);
        createRuntime({
          context,
          adapter,
          driver: mockDriver,
          verify: { mode: 'onFirstUse', requireMarker: false },
        });
      }).not.toThrow();
    });

    it('defaults mode to strict', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
      });

      expect((runtime as unknown as { mode: string }).mode).toBe('strict');
    });

    it('uses permissive mode when specified', () => {
      const mockDriver = createMockDriver();
      const adapter = createPostgresAdapter();

      const context = createTestContext(mockContract, adapter);
      const runtime = createRuntime({
        context,
        adapter,
        driver: mockDriver,
        verify: { mode: 'onFirstUse', requireMarker: false },
        mode: 'permissive',
      });

      expect((runtime as unknown as { mode: string }).mode).toBe('permissive');
    });
  });
});
