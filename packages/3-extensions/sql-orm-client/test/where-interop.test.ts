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
});
