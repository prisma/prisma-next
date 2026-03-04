import type { BoundWhereExpr, WhereArg, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { normalizeWhereArg } from '../src/where-interop';

function toWhereExpr(expr: BoundWhereExpr): WhereArg {
  return {
    toWhereExpr: () => expr,
  };
}

const col = (table: string, column: string) => ({ kind: 'col' as const, table, column });
const param = (index: number) => ({ kind: 'param' as const, index });
const literal = (value: unknown) => ({ kind: 'literal' as const, value });
const op = (
  self: ReturnType<typeof col>,
  args: Array<ReturnType<typeof col> | ReturnType<typeof param> | ReturnType<typeof literal>>,
) =>
  ({
    kind: 'operation',
    method: 'op',
    forTypeId: 'sql/text@1',
    self,
    args,
    returns: {} as never,
    lowering: {} as never,
  }) as const;
const eq = (
  left: ReturnType<typeof col>,
  right: ReturnType<typeof param> | ReturnType<typeof literal>,
) => ({
  kind: 'bin' as const,
  op: 'eq' as const,
  left,
  right,
});
describe('where interop', () => {
  it('rejects null where args', () => {
    expect(() => normalizeWhereArg(null as unknown as WhereArg)).toThrow(/cannot be null/i);
  });

  it('normalizes bound params into literals', () => {
    const arg = toWhereExpr({
      expr: eq(col('users', 'name'), param(1)),
      params: ['Alice'],
      paramDescriptors: [{ source: 'lane' }],
    });

    expect(normalizeWhereArg(arg)).toEqual({
      ...eq(col('users', 'name'), literal('Alice')),
    });
  });

  it('normalizes nested and/or/exists branches', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'and',
        exprs: [
          {
            ...eq(col('users', 'id'), param(1)),
          },
          {
            kind: 'or',
            exprs: [
              {
                ...eq(col('users', 'email'), param(2)),
              },
              {
                kind: 'exists',
                not: false,
                subquery: {
                  kind: 'select',
                  from: { kind: 'table', name: 'posts' },
                  project: [{ alias: 'id', expr: col('posts', 'id') }],
                  where: {
                    ...eq(col('posts', 'user_id'), param(3)),
                  },
                },
              },
            ],
          },
        ],
      },
      params: [1, 'a@b.c', 99],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }, { source: 'lane' }],
    });

    expect(normalizeWhereArg(arg)).toEqual({
      kind: 'and',
      exprs: [
        {
          ...eq(col('users', 'id'), literal(1)),
        },
        {
          kind: 'or',
          exprs: [
            {
              ...eq(col('users', 'email'), literal('a@b.c')),
            },
            {
              kind: 'exists',
              not: false,
              subquery: {
                kind: 'select',
                from: { kind: 'table', name: 'posts' },
                project: [{ alias: 'id', expr: col('posts', 'id') }],
                where: {
                  ...eq(col('posts', 'user_id'), literal(99)),
                },
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects bare WhereExpr with ParamRef', () => {
    const expr: WhereExpr = eq(col('users', 'id'), param(1));

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('accepts bare WhereExpr when param-free', () => {
    const expr: WhereExpr = eq(col('users', 'kind'), literal('admin'));
    expect(normalizeWhereArg(expr)).toEqual(expr);
  });

  it('accepts bare WhereExpr with expression comparables when param-free', () => {
    const expr: WhereExpr = {
      kind: 'bin',
      op: 'eq',
      left: col('users', 'email'),
      right: op(col('users', 'email'), [col('users', 'id'), literal('x')]),
    };
    expect(normalizeWhereArg(expr)).toEqual(expr);
  });

  it('accepts bare exists with join predicates and listLiteral comparables', () => {
    const expr: WhereExpr = {
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        joins: [
          {
            kind: 'join',
            joinType: 'left',
            source: { kind: 'table', name: 'posts' },
            lateral: false,
            on: {
              kind: 'eqCol',
              left: col('users', 'id'),
              right: col('posts', 'userId'),
            },
          },
          {
            kind: 'join',
            joinType: 'inner',
            source: { kind: 'table', name: 'profiles' },
            lateral: false,
            on: {
              kind: 'bin',
              op: 'eq',
              left: col('users', 'id'),
              right: literal('u1'),
            },
          },
        ],
        project: [{ alias: 'id', expr: col('users', 'id') }],
        where: {
          kind: 'bin',
          op: 'in',
          left: col('users', 'id'),
          right: { kind: 'listLiteral', values: [literal('u1'), literal('u2')] },
        },
      },
    };
    expect(normalizeWhereArg(expr)).toEqual(expr);
  });

  it('rejects bare nullCheck expression containing ParamRef in operation args', () => {
    const expr = {
      kind: 'nullCheck' as const,
      isNull: false,
      expr: op(col('users', 'email'), [param(1)]),
    };

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('rejects invalid bound payload alignment', () => {
    const arg = toWhereExpr({
      expr: {
        ...eq(col('users', 'id'), param(1)),
      },
      params: [1],
      paramDescriptors: [],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/paramDescriptors/i);
  });

  it('rejects payloads that do not start ParamRef indexing at 1', () => {
    const arg = toWhereExpr({
      expr: {
        ...eq(col('users', 'id'), param(2)),
      },
      params: ['a', 'b'],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/start at 1/i);
  });

  it('rejects payloads with non-contiguous ParamRef indices', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'and',
        exprs: [
          {
            ...eq(col('users', 'id'), param(1)),
          },
          {
            ...eq(col('users', 'email'), param(3)),
          },
        ],
      },
      params: ['a', 'b', 'c'],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }, { source: 'lane' }],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/contiguous/i);
  });

  it('rejects payloads whose max ParamRef index does not match params length', () => {
    const arg = toWhereExpr({
      expr: {
        ...eq(col('users', 'id'), param(1)),
      },
      params: ['a', 'b'],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/max ParamRef index/i);
  });

  it('accepts bound payloads with no ParamRef and no params', () => {
    const arg = toWhereExpr({
      expr: {
        ...eq(col('users', 'kind'), literal('admin')),
      },
      params: [],
      paramDescriptors: [],
    });

    expect(normalizeWhereArg(arg)).toEqual(eq(col('users', 'kind'), literal('admin')));
  });

  it('rejects bound payloads with params when expr contains no ParamRef', () => {
    const arg = toWhereExpr({
      expr: {
        ...eq(col('users', 'kind'), literal('admin')),
      },
      params: ['admin'],
      paramDescriptors: [{ source: 'lane' }],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/does not contain ParamRef/i);
  });

  it('normalizes operation and listLiteral payloads in binary comparable values', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'and',
        exprs: [
          {
            kind: 'bin',
            op: 'eq',
            left: op(col('users', 'email'), [param(1), literal('@example.com')]),
            right: op(col('users', 'email'), [param(2)]),
          },
          {
            kind: 'bin',
            op: 'in',
            left: col('users', 'id'),
            right: { kind: 'listLiteral', values: [param(3), literal('u2')] },
          },
        ],
      },
      params: ['prefix', 'rhs', 'u1'],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }, { source: 'lane' }],
    });

    expect(normalizeWhereArg(arg)).toEqual({
      kind: 'and',
      exprs: [
        {
          kind: 'bin',
          op: 'eq',
          left: {
            ...op(col('users', 'email'), [literal('prefix'), literal('@example.com')]),
          },
          right: {
            ...op(col('users', 'email'), [literal('rhs')]),
          },
        },
        {
          kind: 'bin',
          op: 'in',
          left: col('users', 'id'),
          right: { kind: 'listLiteral', values: [literal('u1'), literal('u2')] },
        },
      ],
    });
  });
});
