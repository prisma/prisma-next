import { ColumnRef, OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyOrderBuilder,
  ExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { buildMeta } from '../src/sql/plan';
import type { Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

function createExpressionBuilder(operationExpr: OperationExpr): ExpressionBuilder {
  const notImplemented = (): never => {
    throw new Error('not used');
  };

  return {
    kind: 'expression',
    expr: operationExpr,
    columnMeta: { nativeType: 'vector', codecId: 'pg/vector@1', nullable: false },
    eq: notImplemented as () => AnyBinaryBuilder,
    neq: notImplemented as () => AnyBinaryBuilder,
    gt: notImplemented as () => AnyBinaryBuilder,
    lt: notImplemented as () => AnyBinaryBuilder,
    gte: notImplemented as () => AnyBinaryBuilder,
    lte: notImplemented as () => AnyBinaryBuilder,
    asc: notImplemented as () => AnyOrderBuilder,
    desc: notImplemented as () => AnyOrderBuilder,
    toExpr: () => operationExpr,
    __jsType: undefined as never,
  };
}

function createColumnBuilder(table: string, column: string): AnyColumnBuilder {
  const notImplemented = (): never => {
    throw new Error('not used');
  };

  return {
    kind: 'column',
    table,
    column,
    columnMeta: { nativeType: 'jsonb', codecId: 'core/json@1', nullable: true },
    eq: notImplemented as () => AnyBinaryBuilder,
    neq: notImplemented as () => AnyBinaryBuilder,
    gt: notImplemented as () => AnyBinaryBuilder,
    lt: notImplemented as () => AnyBinaryBuilder,
    gte: notImplemented as () => AnyBinaryBuilder,
    lte: notImplemented as () => AnyBinaryBuilder,
    asc: notImplemented as () => AnyOrderBuilder,
    desc: notImplemented as () => AnyOrderBuilder,
    toExpr: () => ColumnRef.of(table, column),
    __jsType: undefined as never,
  } as unknown as AnyColumnBuilder;
}

describe('buildMeta', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('records operation projections, refs, and codecs', () => {
    const operationExpr = OperationExpr.function({
      method: 'normalize',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'id'),
      args: [],
      returns: { kind: 'typeId', type: 'pg/vector@1' },
      template: 'normalize({{self}})',
    });

    const meta = buildMeta({
      contract,
      table: { name: 'user' },
      projection: {
        aliases: ['normalized'],
        columns: [createExpressionBuilder(operationExpr)],
      },
      paramDescriptors: [],
    });

    expect(meta.projection).toEqual({ normalized: 'operation:normalize' });
    expect(meta.projectionTypes).toEqual({ normalized: 'pg/vector@1' });
    expect(meta.annotations?.codecs).toEqual({ normalized: 'pg/vector@1' });
  });

  it('tracks include and join refs', () => {
    const meta = buildMeta({
      contract,
      table: { name: 'user' },
      projection: {
        aliases: ['id', 'posts'],
        columns: [userColumns.id, createColumnBuilder('post', '')],
      },
      joins: [
        {
          joinType: 'inner',
          table: { name: 'post' },
          on: { left: userColumns.id, right: userColumns.id },
        },
      ],
      includes: [
        {
          alias: 'posts',
          table: { name: 'post' },
          on: { left: userColumns.id, right: userColumns.id },
          childProjection: { aliases: ['id'], columns: [userColumns.id] },
        },
      ],
      where: userColumns.id.eq(param('userId')),
      orderBy: userColumns.id.asc(),
      paramDescriptors: [],
    });

    expect(meta.projection).toEqual({ id: 'user.id', posts: 'include:posts' });
    expect(meta.refs?.tables).toContain('post');
    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'id' });
    expect(meta.annotations?.codecs).toEqual({
      id: 'pg/int4@1',
    });
  });

  it('tracks include null-check refs and builtin operation return types', () => {
    const operationExpr = OperationExpr.function({
      method: 'vectorLength',
      forTypeId: 'pg/vector@1',
      self: ColumnRef.of('user', 'id'),
      args: [],
      returns: { kind: 'builtin', type: 'number' },
      template: 'vector_length({{self}})',
    });

    const meta = buildMeta({
      contract,
      table: { name: 'user' },
      projection: {
        aliases: ['length', 'posts'],
        columns: [createExpressionBuilder(operationExpr), createColumnBuilder('post', '')],
      },
      includes: [
        {
          alias: 'posts',
          table: { name: 'post' },
          on: { left: userColumns.id, right: userColumns.id },
          childProjection: { aliases: ['id'], columns: [userColumns.id] },
          childWhere: userColumns.deletedAt.isNull(),
          childOrderBy: userColumns.email.desc(),
        },
      ],
      paramDescriptors: [],
    });

    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'deletedAt' });
    expect(meta.refs?.columns).toContainEqual({ table: 'user', column: 'email' });
    expect(meta.projectionTypes).toEqual({ length: 'number' });
    expect(meta.annotations?.codecs).toBeUndefined();
  });
});
