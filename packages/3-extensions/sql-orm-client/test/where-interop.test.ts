import type { BoundWhereExpr, WhereArg, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { normalizeWhereArg } from '../src/where-interop';

function toWhereExpr(expr: BoundWhereExpr): WhereArg {
  return {
    toWhereExpr: () => expr,
  };
}

describe('where interop', () => {
  it('normalizes bound params into literals', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'name' },
        right: { kind: 'param', index: 1 },
      },
      params: ['Alice'],
      paramDescriptors: [{ source: 'lane' }],
    });

    expect(normalizeWhereArg(arg)).toEqual({
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'users', column: 'name' },
      right: { kind: 'literal', value: 'Alice' },
    });
  });

  it('normalizes nested and/or/exists branches', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'and',
        exprs: [
          {
            kind: 'bin',
            op: 'eq',
            left: { kind: 'col', table: 'users', column: 'id' },
            right: { kind: 'param', index: 1 },
          },
          {
            kind: 'or',
            exprs: [
              {
                kind: 'bin',
                op: 'eq',
                left: { kind: 'col', table: 'users', column: 'email' },
                right: { kind: 'param', index: 2 },
              },
              {
                kind: 'exists',
                not: false,
                subquery: {
                  kind: 'select',
                  from: { kind: 'table', name: 'posts' },
                  project: [{ alias: 'id', expr: { kind: 'col', table: 'posts', column: 'id' } }],
                  where: {
                    kind: 'bin',
                    op: 'eq',
                    left: { kind: 'col', table: 'posts', column: 'user_id' },
                    right: { kind: 'param', index: 3 },
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
          kind: 'bin',
          op: 'eq',
          left: { kind: 'col', table: 'users', column: 'id' },
          right: { kind: 'literal', value: 1 },
        },
        {
          kind: 'or',
          exprs: [
            {
              kind: 'bin',
              op: 'eq',
              left: { kind: 'col', table: 'users', column: 'email' },
              right: { kind: 'literal', value: 'a@b.c' },
            },
            {
              kind: 'exists',
              not: false,
              subquery: {
                kind: 'select',
                from: { kind: 'table', name: 'posts' },
                project: [{ alias: 'id', expr: { kind: 'col', table: 'posts', column: 'id' } }],
                where: {
                  kind: 'bin',
                  op: 'eq',
                  left: { kind: 'col', table: 'posts', column: 'user_id' },
                  right: { kind: 'literal', value: 99 },
                },
              },
            },
          ],
        },
      ],
    });
  });

  it('rejects bare WhereExpr with ParamRef', () => {
    const expr: WhereExpr = {
      kind: 'bin',
      op: 'eq',
      left: { kind: 'col', table: 'users', column: 'id' },
      right: { kind: 'param', index: 1 },
    };

    expect(() => normalizeWhereArg(expr)).toThrow(/bare WhereExpr.*ParamRef/i);
  });

  it('rejects invalid bound payload alignment', () => {
    const arg = toWhereExpr({
      expr: {
        kind: 'bin',
        op: 'eq',
        left: { kind: 'col', table: 'users', column: 'id' },
        right: { kind: 'param', index: 1 },
      },
      params: [1],
      paramDescriptors: [],
    });

    expect(() => normalizeWhereArg(arg)).toThrow(/paramDescriptors/i);
  });
});
