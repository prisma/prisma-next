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
            table: { kind: 'table', name: 'posts' },
            on: {
              kind: 'eqCol',
              left: col('users', 'id'),
              right: col('posts', 'userId'),
            },
          },
          {
            kind: 'join',
            joinType: 'inner',
            table: { kind: 'table', name: 'profiles' },
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

  it('normalizes params inside select joins and includes', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'users' },
          joins: [
            {
              kind: 'join',
              joinType: 'inner',
              table: { kind: 'table', name: 'posts' },
              on: {
                kind: 'bin',
                op: 'eq',
                left: col('users', 'id'),
                right: param(1),
              },
            },
            {
              kind: 'join',
              joinType: 'left',
              table: { kind: 'table', name: 'profiles' },
              on: {
                kind: 'eqCol',
                left: col('users', 'id'),
                right: col('profiles', 'userId'),
              },
            },
          ],
          project: [
            { alias: 'id', expr: col('users', 'id') },
            { alias: 'kind', expr: literal('admin') },
            { alias: 'nested', expr: { kind: 'includeRef', alias: 'posts' } },
          ],
          includes: [
            {
              kind: 'includeMany',
              alias: 'posts',
              child: {
                table: { kind: 'table', name: 'posts' },
                on: {
                  kind: 'eqCol',
                  left: col('users', 'id'),
                  right: col('posts', 'userId'),
                },
                where: {
                  kind: 'bin',
                  op: 'eq',
                  left: col('posts', 'title'),
                  right: param(2),
                },
                orderBy: [{ expr: op(col('posts', 'title'), [param(3)]), dir: 'asc' }],
                project: [{ alias: 'title', expr: col('posts', 'title') }],
              },
            },
          ],
          orderBy: [{ expr: op(col('users', 'email'), [param(4)]), dir: 'desc' }],
        },
      },
      params: ['join', 'childWhere', 'childOrder', 'order'],
      paramDescriptors: [
        { source: 'lane' },
        { source: 'lane' },
        { source: 'lane' },
        { source: 'lane' },
      ],
    });

    const normalized = normalizeWhereArg(arg);
    expect(normalized.kind).toBe('exists');
    if (normalized.kind === 'exists') {
      const select = normalized.subquery;
      const firstJoin = select.joins?.[0];
      expect(firstJoin?.on).toMatchObject({
        kind: 'bin',
        right: { kind: 'literal', value: 'join' },
      });
      const include = select.includes?.[0];
      expect(include?.child.where).toMatchObject({
        kind: 'bin',
        right: { kind: 'literal', value: 'childWhere' },
      });
    }
  });

  it('normalizes nullCheck expressions with operation args', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'nullCheck',
        isNull: false,
        expr: op(col('users', 'email'), [col('users', 'email'), param(1), literal('x')]),
      },
      params: ['needle'],
      paramDescriptors: [{ source: 'lane' }],
    });

    expect(normalizeWhereArg(arg)).toEqual({
      kind: 'nullCheck',
      isNull: false,
      expr: op(col('users', 'email'), [col('users', 'email'), literal('needle'), literal('x')]),
    });
  });

  it('collects and normalizes params referenced from select projection and orderBy', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'exists',
        not: true,
        subquery: {
          kind: 'select',
          from: { kind: 'table', name: 'users' },
          project: [
            { alias: 'email', expr: op(col('users', 'email'), [col('users', 'id'), param(1)]) },
          ],
          orderBy: [{ expr: op(col('users', 'id'), [param(2), col('users', 'id')]), dir: 'asc' }],
          where: { kind: 'bin', op: 'eq', left: col('users', 'id'), right: literal('u1') },
        },
      },
      params: ['project', 'order'],
      paramDescriptors: [{ source: 'lane' }, { source: 'lane' }],
    });

    const normalized = normalizeWhereArg(arg);
    expect(normalized).toMatchObject({
      kind: 'exists',
      not: true,
      subquery: {
        project: [
          {
            expr: {
              kind: 'operation',
              args: [
                { kind: 'col', table: 'users', column: 'id' },
                { kind: 'literal', value: 'project' },
              ],
            },
          },
        ],
        orderBy: [
          {
            expr: {
              kind: 'operation',
              args: [
                { kind: 'literal', value: 'order' },
                { kind: 'col', table: 'users', column: 'id' },
              ],
            },
          },
        ],
      },
    });
  });

  it('rejects bare exists expressions with params in include branches', () => {
    const expr = {
      kind: 'exists' as const,
      not: false,
      subquery: {
        kind: 'select' as const,
        from: { kind: 'table' as const, name: 'users' },
        project: [{ alias: 'id', expr: col('users', 'id') }],
        includes: [
          {
            kind: 'includeMany' as const,
            alias: 'posts',
            child: {
              table: { kind: 'table' as const, name: 'posts' },
              on: {
                kind: 'eqCol' as const,
                left: col('users', 'id'),
                right: col('posts', 'userId'),
              },
              project: [{ alias: 'id', expr: col('posts', 'id') }],
              where: {
                kind: 'bin' as const,
                op: 'eq' as const,
                left: col('posts', 'title'),
                right: param(1),
              },
            },
          },
        ],
      },
    };

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('accepts bare exists with literal/includeRef projections and include orderBy without params', () => {
    const expr: WhereExpr = {
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        project: [
          { alias: 'id', expr: col('users', 'id') },
          { alias: 'tag', expr: { kind: 'literal', value: 'x' } },
          { alias: 'posts', expr: { kind: 'includeRef', alias: 'posts' } },
        ],
        orderBy: [{ expr: col('users', 'id'), dir: 'asc' }],
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'posts' },
              on: { kind: 'eqCol', left: col('users', 'id'), right: col('posts', 'userId') },
              orderBy: [{ expr: col('posts', 'id'), dir: 'asc' }],
              project: [{ alias: 'id', expr: col('posts', 'id') }],
            },
          },
        ],
      },
    };

    expect(normalizeWhereArg(expr)).toEqual(expr);
  });

  it('rejects bare exists with params in top-level and include orderBy', () => {
    const expr: WhereExpr = {
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        project: [{ alias: 'id', expr: col('users', 'id') }],
        orderBy: [{ expr: op(col('users', 'id'), [param(1)]), dir: 'asc' }],
        includes: [
          {
            kind: 'includeMany',
            alias: 'posts',
            child: {
              table: { kind: 'table', name: 'posts' },
              on: { kind: 'eqCol', left: col('users', 'id'), right: col('posts', 'userId') },
              orderBy: [{ expr: op(col('posts', 'id'), [param(2)]), dir: 'asc' }],
              project: [{ alias: 'id', expr: col('posts', 'id') }],
            },
          },
        ],
      },
    };

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('throws for unsupported where node kinds', () => {
    const bad = { kind: 'unsupported' } as unknown as WhereExpr;
    expect(() => normalizeWhereArg(bad)).toThrow(/Unsupported where expression kind/i);

    const wrapped = toWhereExpr({
      expr: bad,
      params: [],
      paramDescriptors: [],
    });
    expect(() => normalizeWhereArg(wrapped)).toThrow(/Unsupported where expression kind/i);
  });
});
