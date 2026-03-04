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

describe('where interop select/source branches', () => {
  it('normalizes params inside joins, derived sources, and projection subqueries', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'exists',
        not: false,
        subquery: {
          kind: 'select',
          from: {
            kind: 'derivedTable',
            alias: 'users_src',
            query: {
              kind: 'select',
              from: { kind: 'table', name: 'users' },
              project: [{ alias: 'id', expr: col('users', 'id') }],
              where: {
                kind: 'bin',
                op: 'eq',
                left: col('users', 'kind'),
                right: param(1),
              },
            },
          },
          joins: [
            {
              kind: 'join',
              joinType: 'inner',
              source: { kind: 'table', name: 'posts' },
              lateral: false,
              on: {
                kind: 'bin',
                op: 'eq',
                left: col('users_src', 'id'),
                right: param(2),
              },
            },
          ],
          project: [
            { alias: 'id', expr: col('users_src', 'id') },
            {
              alias: 'nested',
              expr: {
                kind: 'subquery',
                query: {
                  kind: 'select',
                  from: { kind: 'table', name: 'posts' },
                  project: [{ alias: 'title', expr: op(col('posts', 'title'), [param(3)]) }],
                },
              },
            },
          ],
          orderBy: [{ expr: op(col('users_src', 'id'), [param(4)]), dir: 'desc' }],
        },
      },
      params: ['srcWhere', 'joinOn', 'nestedProject', 'order'],
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
      if (select.from.kind === 'derivedTable') {
        expect(select.from.query.where).toMatchObject({
          kind: 'bin',
          right: { kind: 'literal', value: 'srcWhere' },
        });
      }
      const firstJoin = select.joins?.[0];
      expect(firstJoin?.on).toMatchObject({
        kind: 'bin',
        right: { kind: 'literal', value: 'joinOn' },
      });
      const nestedProjection = select.project.find((item) => item.alias === 'nested');
      expect(nestedProjection?.expr.kind).toBe('subquery');
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

  it('rejects bare exists expressions with params in derived branches', () => {
    const expr = {
      kind: 'exists' as const,
      not: false,
      subquery: {
        kind: 'select' as const,
        from: {
          kind: 'derivedTable' as const,
          alias: 'users_src',
          query: {
            kind: 'select' as const,
            from: { kind: 'table' as const, name: 'users' },
            project: [{ alias: 'id', expr: col('users', 'id') }],
            where: {
              kind: 'bin' as const,
              op: 'eq' as const,
              left: col('users', 'id'),
              right: param(1),
            },
          },
        },
        project: [{ alias: 'id', expr: col('users_src', 'id') }],
      },
    };

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('accepts bare exists with literal/subquery projections and no params', () => {
    const expr: WhereExpr = {
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        project: [
          { alias: 'id', expr: col('users', 'id') },
          { alias: 'tag', expr: literal('x') },
          {
            alias: 'postId',
            expr: {
              kind: 'subquery',
              query: {
                kind: 'select',
                from: { kind: 'table', name: 'posts' },
                project: [{ alias: 'id', expr: col('posts', 'id') }],
              },
            },
          },
        ],
        orderBy: [{ expr: col('users', 'id'), dir: 'asc' }],
      },
    };

    expect(normalizeWhereArg(expr)).toEqual(expr);
  });

  it('rejects bare exists with params in top-level and nested subqueries', () => {
    const expr: WhereExpr = {
      kind: 'exists',
      not: false,
      subquery: {
        kind: 'select',
        from: { kind: 'table', name: 'users' },
        project: [
          {
            alias: 'postId',
            expr: {
              kind: 'subquery',
              query: {
                kind: 'select',
                from: { kind: 'table', name: 'posts' },
                project: [{ alias: 'id', expr: op(col('posts', 'id'), [param(2)]) }],
              },
            },
          },
        ],
        orderBy: [{ expr: op(col('users', 'id'), [param(1)]), dir: 'asc' }],
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
