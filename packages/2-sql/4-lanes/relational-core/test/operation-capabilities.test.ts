import type { Contract } from '@prisma-next/contract/types';
import { coreHash, profileHash } from '@prisma-next/contract/types';
import { emptyCodecLookup } from '@prisma-next/framework-components/codec';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import { vectorColumn as vectorColumnType } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { schema } from '../src/schema';
import { createTestContext } from './utils';

describe('Operation capability gating', () => {
  it('exposes operation with required capability when capability is present', () => {
    const contract = validateContract<Contract<SqlStorage>>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        roots: {},
        extensionPacks: {},
        capabilities: {
          pgvector: {
            'index.ivfflat': true,
          },
        },
        storage: {
          storageHash: coreHash('sha256:test-hash'),
          tables: {
            user: {
              columns: {
                vector: { ...vectorColumnType, nullable: false },
              },
              primaryKey: { columns: ['vector'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        meta: {},
      },
      emptyCodecLookup,
    );

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };

    const context = createTestContext(contract, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('does not expose operation with required capability when capability is missing', () => {
    const contract = validateContract<Contract<SqlStorage>>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        roots: {},
        extensionPacks: {},
        capabilities: {},
        storage: {
          storageHash: coreHash('sha256:test-hash'),
          tables: {
            user: {
              columns: {
                vector: { ...vectorColumnType, nullable: false },
              },
              primaryKey: { columns: ['vector'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        meta: {},
      },
      emptyCodecLookup,
    );

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };

    const context = createTestContext(contract, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });

  it('exposes operation without capabilities regardless of contract capabilities', () => {
    const contract = validateContract<Contract<SqlStorage>>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        roots: {},
        extensionPacks: {},
        capabilities: {},
        storage: {
          storageHash: coreHash('sha256:test-hash'),
          tables: {
            user: {
              columns: {
                vector: { ...vectorColumnType, nullable: false },
              },
              primaryKey: { columns: ['vector'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        meta: {},
      },
      emptyCodecLookup,
    );

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
    };

    const context = createTestContext(contract, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('requires all capabilities when multiple are specified', () => {
    const contract = validateContract<Contract<SqlStorage>>(
      {
        target: 'postgres',
        targetFamily: 'sql',
        profileHash: profileHash('sha256:test'),
        roots: {},
        extensionPacks: {},
        capabilities: {
          pgvector: {
            'index.ivfflat': true,
          },
        },
        storage: {
          storageHash: coreHash('sha256:test-hash'),
          tables: {
            user: {
              columns: {
                vector: { ...vectorColumnType, nullable: false },
              },
              primaryKey: { columns: ['vector'] },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
        models: {},
        meta: {},
      },
      emptyCodecLookup,
    );

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        template: '{{self}} <=> {{arg0}}',
      },
      capabilities: ['pgvector.index.ivfflat', 'pgvector.index.hnsw'],
    };

    const context = createTestContext(contract, {
      extensions: [
        {
          operations: () => [signature],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(
      (vectorColumn as unknown as { cosineDistance?: unknown }).cosineDistance,
    ).toBeUndefined();
  });
});
