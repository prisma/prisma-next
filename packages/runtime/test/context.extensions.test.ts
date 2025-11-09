import { describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../adapter-postgres/src/exports/adapter';
import type { Extension, OperationSignature } from '../src/context';
import { createRuntimeContext } from '../src/exports';
import { createTestContract } from './utils';

describe('createRuntimeContext with extensions', () => {
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

  it('registers operations from extension', () => {
    const adapter = createPostgresAdapter();
    const operation: OperationSignature = {
      forTypeId: 'pg/text@1',
      method: 'test',
      args: [],
      returns: { kind: 'builtin', type: 'string' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        template: 'test(${self})',
      },
    };

    const extension: Extension = {
      operations: () => [operation],
    };

    const context = createRuntimeContext({
      contract: mockContract,
      adapter,
      extensions: [extension],
    });

    const operations = context.operations.byType('pg/text@1');
    expect(operations).toHaveLength(1);
    expect(operations[0]?.method).toBe('test');
  });

  it('handles extension without operations', () => {
    const adapter = createPostgresAdapter();
    const extension: Extension = {};

    const context = createRuntimeContext({
      contract: mockContract,
      adapter,
      extensions: [extension],
    });

    expect(context.operations.byType('pg/text@1')).toEqual([]);
  });
});

