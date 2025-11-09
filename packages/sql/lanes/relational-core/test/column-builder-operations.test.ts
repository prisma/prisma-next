import { createStubAdapter, createTestContext } from '@prisma-next/runtime/test/utils';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { OperationSignature, SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
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
          primaryKey: { columns: ['id'] },
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

  it('exposes registered methods on columns with matching typeId', () => {
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
    expect(vectorColumn).toBeDefined();
    expect(typeof (vectorColumn as unknown as { cosineDistance: unknown }).cosineDistance).toBe(
      'function',
    );
  });

  it('does not expose registered methods on columns without matching typeId', () => {
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
    const idColumn = userTable.columns['id'];
    expect(idColumn).toBeDefined();
    expect((idColumn as unknown as { cosineDistance?: unknown }).cosineDistance).toBeUndefined();
  });

  it('exposes multiple operations on same typeId', () => {
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

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature1, signature2],
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
    expect(typeof (vectorColumn as unknown as { l2Distance: unknown }).l2Distance).toBe('function');
  });

  it('registered method accepts param argument', () => {
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
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    expect(result).toBeDefined();
    expect(result).toHaveProperty('kind', 'column');
  });

  it('registered method returns ColumnBuilder with correct return type', () => {
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
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    expect(result).toHaveProperty('kind', 'column');
    expect(result).toHaveProperty('columnMeta');
  });

  it('operation result can be used in where clause', () => {
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
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { eq: (value: unknown) => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const binary = distance.eq(param('threshold'));
    expect(binary).toHaveProperty('kind', 'binary');
  });

  it('operation result can be used in orderBy', () => {
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
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { asc: () => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const order = distance.asc();
    expect(order).toHaveProperty('kind', 'order');
  });

  it('chains operations producing nested OperationExpr trees', () => {
    const signature1: OperationSignature = {
      forTypeId: 'pgvector/vector@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pgvector/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };
    const signature2: OperationSignature = {
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

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter, {
      extensions: [
        {
          operations: () => [signature1, signature2],
        },
      ],
    });
    const tables = schema(context).tables;
    const userTable = tables['user'];
    if (!userTable) throw new Error('user table not found');
    const vectorColumn = userTable.columns['vector'];

    // Chain operations: normalize().cosineDistance(otherVector)
    const normalized = (vectorColumn as unknown as { normalize: () => unknown }).normalize();
    const otherVectorColumn = userTable.columns['vector'];
    const distance = (
      normalized as unknown as {
        cosineDistance: (arg: unknown) => unknown;
        _operationExpr?: import('@prisma-next/sql-target').OperationExpr;
      }
    ).cosineDistance(otherVectorColumn);

    // Verify the result has an operation expression
    expect(distance).toHaveProperty('kind', 'column');
    const distanceWithExpr = distance as unknown as {
      _operationExpr?: import('@prisma-next/sql-target').OperationExpr;
    };
    expect(distanceWithExpr._operationExpr).toBeDefined();

    // Verify the outer operation (cosineDistance) has the inner operation (normalize) as its self
    const outerOp = distanceWithExpr._operationExpr;
    expect(outerOp).toMatchObject({
      kind: 'operation',
      method: 'cosineDistance',
      self: expect.objectContaining({
        kind: 'operation',
      }),
    });

    // Verify the inner operation (normalize) has the column as its self
    const innerOp = outerOp?.self as import('@prisma-next/sql-target').OperationExpr;
    expect(innerOp).toMatchObject({
      kind: 'operation',
      method: 'normalize',
      self: {
        kind: 'col',
        table: 'user',
        column: 'vector',
      },
    });
  });
});
