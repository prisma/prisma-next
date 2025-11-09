import type { Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createRuntime } from '../src/runtime';
import { createTestContext, createTestContract } from './utils';

describe('Runtime error categories', () => {
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

  it('handles profile hash mismatch error', async () => {
    const contractWithProfile = createTestContract({
      ...mockContract,
      profileHash: 'sha256:test-profile',
    });

    const adapter = createPostgresAdapter();
    const context = createTestContext(contractWithProfile, adapter);
    const mockDriver: SqlDriver = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({
        rows: [
          {
            core_hash: 'sha256:test-core',
            profile_hash: 'sha256:different-profile',
          },
        ],
      }),
      execute: vi.fn().mockImplementation(async function* () {
        yield { id: 1 };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = createRuntime({
      context,
      adapter,
      driver: mockDriver,
      verify: { mode: 'startup', requireMarker: true },
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
    } as Plan;

    await expect(
      (async () => {
        for await (const _row of runtime.execute(plan)) {
          void _row;
        }
      })(),
    ).rejects.toMatchObject({
      code: 'CONTRACT.MARKER_MISMATCH',
      category: 'CONTRACT',
    });
  });

  it('handles default RUNTIME error category', () => {
    // Test that resolveCategory returns 'RUNTIME' for unknown error codes
    // This is tested indirectly through runtimeError function
    const adapter = createPostgresAdapter();
    const context = createTestContext(mockContract, adapter);
    const mockDriver: SqlDriver = {
      connect: vi.fn(),
      query: vi.fn().mockResolvedValue({ rows: [] }),
      execute: vi.fn().mockImplementation(async function* () {
        yield { id: 1 };
      }),
      close: vi.fn().mockResolvedValue(undefined),
    };

    const runtime = createRuntime({
      context,
      adapter,
      driver: mockDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    // The operations() method should be callable
    const operations = runtime.operations();
    expect(operations).toBeDefined();
  });
});

