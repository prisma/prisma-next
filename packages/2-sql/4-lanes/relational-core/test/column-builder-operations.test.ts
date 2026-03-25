import { validateContract } from '@prisma-next/sql-contract/validate';
import type { SqlOperationSignature } from '@prisma-next/sql-operations';
import {
  int4Column as int4ColumnType,
  textColumn as textColumnType,
  vectorColumn as vectorColumnType,
} from '@prisma-next/test-utils/column-descriptors';
import { describe, expect, it } from 'vitest';
import { ColumnRef, type OperationExpr } from '../src/ast/types';
import { param } from '../src/param';
import { schema } from '../src/schema';
import { createStubAdapter, createTestContext } from './utils';

describe('ColumnBuilder operations', () => {
  const contract = validateContract({
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'test-hash',
    storage: {
      tables: {
        user: {
          columns: {
            id: { ...int4ColumnType, nullable: false },
            email: { ...textColumnType, nullable: false },
            vector: { ...vectorColumnType, nullable: false },
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
  } as const);

  it('exposes registered methods on columns with matching typeId', () => {
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const signature1: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
      returns: { kind: 'builtin', type: 'number' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'infix',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: '${self} <=> ${arg0}',
      },
    };
    const signature2: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'l2Distance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    expect(result).toBeDefined();
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(result).toHaveProperty('kind', 'expression');
  });

  it('registered method returns ExpressionBuilder with correct return type', () => {
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
    const result = (
      vectorColumn as unknown as { cosineDistance: (arg: unknown) => unknown }
    ).cosineDistance(param('other'));
    // Operations now return ExpressionBuilder with kind: 'expression'
    expect(result).toHaveProperty('kind', 'expression');
    expect(result).toHaveProperty('columnMeta');
  });

  it('operation result can be used in where clause', () => {
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
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { eq: (value: unknown) => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const binary = distance.eq(param('threshold'));
    expect(binary).toHaveProperty('kind', 'binary');
  });

  it('operation result can be used in orderBy', () => {
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
    const distance = (
      vectorColumn as unknown as {
        cosineDistance: (arg: unknown) => { asc: () => { kind: string } };
      }
    ).cosineDistance(param('other'));
    const order = distance.asc();
    expect(order).toHaveProperty('kind', 'order');
  });

  it('chains operations producing nested OperationExpr trees', () => {
    const signature1: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'normalize',
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      lowering: {
        targetFamily: 'sql',
        strategy: 'function',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: SQL template with placeholders
        template: 'normalize(${self})',
      },
    };
    const signature2: SqlOperationSignature = {
      forTypeId: 'pg/vector@1',
      method: 'cosineDistance',
      args: [{ kind: 'typeId', type: 'pg/vector@1' }],
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
      }
    ).cosineDistance(otherVectorColumn);

    // Verify the result is an ExpressionBuilder
    expect(distance).toHaveProperty('kind', 'expression');
    expect(distance).toHaveProperty('toExpr');

    // Get the expression via toExpr()
    const expressionBuilder = distance as unknown as { toExpr: () => OperationExpr };
    const outerOp = expressionBuilder.toExpr();

    // Verify the outer operation (cosineDistance) has the inner operation (normalize) as its self
    expect(outerOp.kind).toBe('operation');
    expect(outerOp.method).toBe('cosineDistance');
    expect(outerOp.self.kind).toBe('operation');

    // Verify the inner operation (normalize) has the column as its self
    const innerOp = outerOp.self as OperationExpr;
    expect(innerOp.kind).toBe('operation');
    expect(innerOp.method).toBe('normalize');
    expect(innerOp.self).toEqual(ColumnRef.of('user', 'vector'));
  });
});
