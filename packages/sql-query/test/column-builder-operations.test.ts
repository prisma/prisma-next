import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import {
  createCodecRegistry,
  createOperationRegistry,
  type OperationSignature,
} from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';
import { param } from '../src/param';
import { schema } from '../src/schema';

describe('ColumnBuilder operations', () => {
  const contract = validateContract<SqlContract<SqlStorage>>({
    target: 'postgres',
    targetFamily: 'sql',
    coreHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { type: 'pg/int4@1', nullable: false },
            email: { type: 'pg/text@1', nullable: false },
            vector: { type: 'pgvector/vector@1', nullable: false },
          },
        },
      },
    },
    models: {},
    relations: {},
    mappings: {},
  });

  it('exposes registered methods on columns with matching typeId', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(vectorColumn).toBeDefined();
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('does not expose registered methods on columns without matching typeId', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const idColumn = userTable.columns['id'];
    expect(idColumn).toBeDefined();
    expect((idColumn as unknown as { cosineDistance?: unknown }).cosineDistance).toBeUndefined();
  });

  it('exposes multiple operations on same typeId', () => {
    const registry = createOperationRegistry();
    const signature1: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };
    const signature2: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'l2Distance',
      args: [{ kind: 'typeId', type: 'pgvector/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <-> ${arg0}',
      },
    };
    registry.register(signature1);
    registry.register(signature2);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
    expect(typeof (vectorColumn as unknown as { l2Distance: unknown }).l2Distance).toBe('function');
  });

  it('registered method accepts param argument', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
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
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'column');
  });

  it('registered method returns ColumnBuilder with correct return type', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
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
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    expect(result).toHaveProperty('kind', 'column');
    expect(result).toHaveProperty('columnMeta');
  });

  it('operation result can be used in where clause', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
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
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { eq: (value: unknown) => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const binary = distance.eq(param('threshold'));
    expect(binary).toHaveProperty('kind', 'binary');
  });

  it('operation result can be used in orderBy', () => {
    const registry = createOperationRegistry();
    const signature: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
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
    registry.register(signature);

    const tables = schema(contract, { operations: registry, codecs: createCodecRegistry() }).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { asc: () => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const order = distance.asc();
    expect(order).toHaveProperty('kind', 'order');
  });
});
