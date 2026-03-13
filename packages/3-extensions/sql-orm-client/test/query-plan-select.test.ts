import {
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  ListLiteralExpr,
  LiteralExpr,
  OrExpr,
  ParamRef,
  type SelectAst,
  SubqueryExpr,
  type ToWhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileRelationSelect,
  compileSelect,
  compileSelectWithIncludeStrategy,
} from '../src/query-plan-select';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import { isSelectAst } from './helpers';

const descriptor = (index: number) => ({ source: 'lane' as const, index });
const bound = (
  expr: BinaryExpr,
  params: readonly unknown[] = [],
  paramDescriptors = params.map((_, index) => descriptor(index + 1)),
): BoundWhereExpr => ({
  expr,
  params,
  paramDescriptors,
});
const toWhereExpr = (value: BoundWhereExpr): ToWhereExpr => ({
  toWhereExpr: () => value,
});

function expectSelectAst(ast: unknown): asserts ast is SelectAst {
  expect(isSelectAst(ast)).toBe(true);
}

function expectSubqueryExpr(expr: unknown): asserts expr is SubqueryExpr {
  expect(expr).toBeInstanceOf(SubqueryExpr);
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeInstanceOf(DerivedTableSource);
}

describe('compileSelectWithIncludeStrategy', () => {
  it('offsets include filter params after top-level params', () => {
    const { collection } = createCollection();
    const state = collection
      .where(() =>
        toWhereExpr(
          bound(BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')), ['Alice']),
        ),
      )
      .include('posts', (posts) =>
        posts.where(() =>
          toWhereExpr(
            bound(BinaryExpr.gte(ColumnRef.of('posts', 'views'), ParamRef.of(1, 'views')), [100]),
          ),
        ),
      ).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated');
    expect(plan.params).toEqual(['Alice', 100]);
    expect(plan.meta.paramDescriptors).toEqual([descriptor(1), descriptor(2)]);

    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')),
    );

    const postsProjection = plan.ast.project.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.where).toBeInstanceOf(AndExpr);
    expect(childRowsSource.query.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), ParamRef.of(2, 'views')),
      ]),
    );
  });

  it('builds lexicographic cursor filters with distinctOn, limit, and offset', () => {
    const { collection } = createCollection();
    const state = collection
      .orderBy((user) => user.name.asc())
      .orderBy((user) => user.id.desc())
      .cursor({ name: 'Alice', id: 7 })
      .distinctOn('email')
      .take(10)
      .skip(3)
      .select('id').state;

    const plan = compileSelect(baseContract, 'users', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      OrExpr.of([
        BinaryExpr.gt(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
          BinaryExpr.lt(ColumnRef.of('users', 'id'), LiteralExpr.of(7)),
        ]),
      ]),
    );
    expect(plan.ast.distinctOn).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.limit).toBe(10);
    expect(plan.ast.offset).toBe(3);
  });

  it('builds single-column cursor boundaries and rejects incomplete cursors', () => {
    const { collection } = createCollection();
    const state = collection.orderBy((user) => user.id.asc()).cursor({ id: 9 }).state;

    const plan = compileSelect(baseContract, 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.ast.where).toEqual(BinaryExpr.gt(ColumnRef.of('users', 'id'), LiteralExpr.of(9)));

    const invalidState = {
      ...collection.orderBy((user) => user.id.asc()).state,
      cursor: {},
    };
    expect(() => compileSelect(baseContract, 'users', invalidState)).toThrow(
      'Missing cursor value for orderBy column "id"',
    );
  });

  it('prepends relation filters and clears nested paging for relation selects', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .where((post) => post.title.eq('Hello'))
      .take(2)
      .skip(1).state;

    const plan = compileRelationSelect(baseContract, 'posts', 'user_id', [1, 2], state);
    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      AndExpr.of([
        BinaryExpr.in(ColumnRef.of('posts', 'user_id'), ListLiteralExpr.fromValues([1, 2])),
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), LiteralExpr.of('Hello')),
      ]),
    );
    expect(plan.ast.limit).toBeUndefined();
    expect(plan.ast.offset).toBeUndefined();
  });

  it('builds lateral include joins with child distinctOn and offset', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .orderBy((post) => post.title.asc())
        .distinctOn('title')
        .skip(1)
        .take(2),
    ).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
    expectSelectAst(plan.ast);

    const join = plan.ast.joins?.[0];
    expect(join).toBeInstanceOf(JoinAst);
    expect(join?.lateral).toBe(true);
    expectDerivedTableSource(join?.source);

    const aggregateQuery = join.source.query;
    expectDerivedTableSource(aggregateQuery.from);

    const childRows = aggregateQuery.from.query;
    expect(childRows.distinctOn).toEqual([ColumnRef.of('posts', 'title')]);
    expect(childRows.offset).toBe(1);
    expect(childRows.limit).toBe(2);
  });

  it('rejects scalar include selectors for single-query include strategies', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) => posts.count()).state;

    expect(() => compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral')).toThrow(
      'single-query include strategy does not support scalar include selectors or combine()',
    );
  });
});
