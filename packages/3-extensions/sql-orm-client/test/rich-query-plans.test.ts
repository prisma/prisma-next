import {
  AggregateExpr,
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  DoUpdateSetConflictAction,
  InsertAst,
  LiteralExpr,
  ParamRef,
  SelectAst,
  SubqueryExpr,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteReturning,
  compileGroupedAggregate,
  compileInsertReturning,
  compileSelectWithIncludeStrategy,
  compileUpdateReturning,
  compileUpsertReturning,
} from '../src/query-plan';
import { baseContract, createCollectionFor } from './collection-fixtures';

describe('SQL ORM rich AST query plans', () => {
  it('compiles include plans with AST classes and limit annotations', () => {
    const { collection } = createCollectionFor('User');
    const state = collection
      .where(() =>
        BinaryExpr.eq(
          ColumnRef.of('users', 'name'),
          ParamRef.of('Alice', { name: 'name', codecId: 'pg/text@1' }),
        ),
      )
      .include('posts', (posts) =>
        posts.where(() =>
          BinaryExpr.gte(
            ColumnRef.of('posts', 'views'),
            ParamRef.of(100, { name: 'views', codecId: 'pg/int4@1' }),
          ),
        ),
      )
      .take(5).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated');

    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect(plan.params).toEqual([100, 'Alice']);
    expect(plan.meta.annotations).toEqual({ limit: 5 });

    const ast = plan.ast as SelectAst;
    expect(ast.where).toBeInstanceOf(BinaryExpr);

    const postsProjection = ast.projection.find((item) => item.alias === 'posts');
    expect(postsProjection?.expr).toBeInstanceOf(SubqueryExpr);
    const aggregateQuery = (postsProjection?.expr as SubqueryExpr).query;
    expect(aggregateQuery.from).toBeInstanceOf(DerivedTableSource);

    const rowsQuery = (aggregateQuery.from as DerivedTableSource).query;
    expect(rowsQuery.where).toBeInstanceOf(AndExpr);
    const childFilter = (rowsQuery.where as AndExpr).exprs[1] as BinaryExpr;
    expect(childFilter.right).toBeInstanceOf(ParamRef);
    expect((childFilter.right as ParamRef).value).toBe(100);
  });

  it('compiles insert, upsert, update, delete, and grouped aggregate plans with rich nodes', () => {
    const insertPlan = compileInsertReturning(
      baseContract,
      'users',
      [{ id: 1, name: 'Alice', email: 'a@example.com' }],
      ['id'],
    );
    expect(insertPlan.ast).toBeInstanceOf(InsertAst);

    const upsertPlan = compileUpsertReturning(
      baseContract,
      'users',
      { id: 1, name: 'Alice', email: 'a@example.com' },
      { name: 'Alice Updated' },
      ['email'],
      ['id'],
    );
    expect(upsertPlan.ast).toBeInstanceOf(InsertAst);
    expect((upsertPlan.ast as InsertAst).onConflict?.action).toBeInstanceOf(
      DoUpdateSetConflictAction,
    );

    const updatePlan = compileUpdateReturning(
      baseContract,
      'users',
      { email: 'b@example.com' },
      [BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))],
      ['id'],
    );
    expect(updatePlan.ast).toBeInstanceOf(UpdateAst);
    expect((updatePlan.ast as UpdateAst).where).toBeInstanceOf(BinaryExpr);

    const deletePlan = compileDeleteReturning(
      baseContract,
      'users',
      [BinaryExpr.eq(ColumnRef.of('users', 'id'), LiteralExpr.of(1))],
      ['id'],
    );
    expect(deletePlan.ast).toBeInstanceOf(DeleteAst);

    const groupedPlan = compileGroupedAggregate(
      baseContract,
      'posts',
      [],
      ['user_id'],
      {
        postCount: { kind: 'aggregate', fn: 'count' },
        totalViews: { kind: 'aggregate', fn: 'sum', column: 'views' },
      },
      BinaryExpr.gt(AggregateExpr.count(), LiteralExpr.of(1)),
    );
    expect(groupedPlan.ast).toBeInstanceOf(SelectAst);
    const groupedAst = groupedPlan.ast as SelectAst;
    expect(groupedAst.groupBy).toEqual([ColumnRef.of('posts', 'user_id')]);
    expect(groupedAst.having).toBeInstanceOf(BinaryExpr);
  });
});
