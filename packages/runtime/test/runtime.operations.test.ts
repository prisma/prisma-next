import type { Plan } from '@prisma-next/contract/types';
import type { SqlContract, SqlDriver, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it, vi } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import { createRuntime } from '../src/runtime';
import { createTestContext, createTestContract } from './utils';

describe('Runtime operations', () => {
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

  it('returns operations registry', () => {
    const mockDriver = createMockDriver();
    const adapter = createPostgresAdapter();
    const context = createTestContext(mockContract, adapter);
    const runtime = createRuntime({
      context,
      adapter,
      driver: mockDriver,
      verify: { mode: 'onFirstUse', requireMarker: false },
    });

    const operations = runtime.operations();
    expect(operations).toBeDefined();
    expect(operations.byType('pg/text@1')).toEqual([]);
  });
});

