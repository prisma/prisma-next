import { describe, expect, it } from 'vitest';
import {
  createCodecRegistry,
  createOperationRegistry,
  type OperationSignature,
} from '@prisma-next/sql-target';
import { schema } from '../src/schema';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';

describe('Operation capability gating', () => {
  it('exposes operation with required capability when capability is present', () => {
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {
        pgvector: {
          'index.ivfflat': true,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const vectorColumn = tables.user.columns.vector;
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('does not expose operation with required capability when capability is missing', () => {
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {},
      storage: {
        tables: {
          user: {
            columns: {
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const vectorColumn = tables.user.columns.vector;
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });

  it('exposes operation without capabilities regardless of contract capabilities', () => {
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {},
      storage: {
        tables: {
          user: {
            columns: {
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const vectorColumn = tables.user.columns.vector;
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('requires all capabilities when multiple are specified', () => {
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {
        pgvector: {
          'index.ivfflat': true,
        },
      },
      storage: {
        tables: {
          user: {
            columns: {
              vector: { type: 'pgvector/vector@1', nullable: false },
            },
          },
        },
      },
      models: {},
      relations: {},
      mappings: {},
    });

    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat', 'pgvector.index.hnsw'],
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const vectorColumn = tables.user.columns.vector;
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });
});
