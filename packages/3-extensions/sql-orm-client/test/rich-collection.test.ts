import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  ParamRef,
  type SelectAst,
  type ToWhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

describe('SQL ORM collections with rich AST plans', () => {
  it('stores direct where expressions and bound where payloads in collection state', () => {
    const { collection } = createCollectionFor('User');

    const direct = collection.where(BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1)));
    expect(direct.state.filters[0]?.expr?.kind).toBe('binary');
    expect(direct.state.filters[0]?.params).toEqual([1]);

    const bound = collection.where({
      toWhereExpr: () => ({
        expr: BinaryExpr.eq(ColumnRef.of('users', 'email'), ParamRef.of(1, 'email')),
        params: ['a@example.com'],
        paramDescriptors: [{ index: 1, source: 'dsl' as const }],
      }),
    } satisfies ToWhereExpr);
    expect(bound.state.filters[0]?.params).toEqual(['a@example.com']);
  });

  it('dispatches select plans with SelectAst limits and annotations', async () => {
    const { collection, runtime } = createCollectionFor('User');
    runtime.setNextResults([[{ id: 1, name: 'Alice', email: 'a@example.com' }]]);

    const row = await collection.where((user) => user['id']!.eq(1)).first();
    expect(row).toMatchObject({ id: 1, name: 'Alice' });

    const plan = runtime.executions[0]?.plan;
    expect((plan?.ast as SelectAst | undefined)?.kind).toBe('select');
    expect((plan?.ast as SelectAst).limit).toBe(1);
    expect(plan?.meta.annotations).toEqual({ limit: 1 });
  });

  it('executes grouped aggregates backed by aggregate expressions', async () => {
    const { collection, runtime } = createCollectionFor('Post');
    runtime.setNextResults([[{ user_id: 1, postCount: '2', totalViews: '30' }]]);

    const rows = await collection
      .groupBy('userId')
      .having((having) => having.count().gt(1))
      .aggregate((aggregate) => ({
        postCount: aggregate.count(),
        totalViews: aggregate.sum('views'),
      }));

    expect(rows).toEqual([{ userId: 1, postCount: 2, totalViews: 30 }]);

    const plan = runtime.executions[0]?.plan;
    expect((plan?.ast as SelectAst | undefined)?.kind).toBe('select');
    const ast = plan?.ast as SelectAst;
    expect(ast!.having!.kind).toBe('binary');
    expect((ast!.having as BinaryExpr).left.kind).toBe('aggregate');
  });
});
