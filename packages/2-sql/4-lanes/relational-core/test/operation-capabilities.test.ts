import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import { vectorColumn as vectorColumnType } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';
import { schema } from '../src/schema';
import { createStubAdapter, createTestContext } from './utils';

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
      relations: {},
      mappings: {},
    });

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
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
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {},
      storage: {
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
      relations: {},
      mappings: {},
    });

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat'],
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
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
    const contract = validateContract<SqlContract<SqlStorage>>({
      target: 'postgres',
      targetFamily: 'sql',
      coreHash: 'test-hash',
      capabilities: {},
      storage: {
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
      relations: {},
      mappings: {},
    });

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
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
      relations: {},
      mappings: {},
    });

    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'param' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
      capabilities: ['pgvector.index.ivfflat', 'pgvector.index.hnsw'],
    };

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
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
