import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  ListLiteralExpr,
  LiteralExpr,
  OrExpr,
  type SelectAst,
  SubqueryExpr,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileRelationSelect,
  compileSelect,
  compileSelectWithIncludeStrategy,
} from '../src/query-plan-select';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import { isSelectAst } from './helpers';

function dslDescriptor(table: string, column: string) {
  const columnMeta = (
    baseContract.storage.tables as Record<
      string,
      { columns: Record<string, { codecId: string; nativeType: string; nullable: boolean }> }
    >
  )[table]!.columns[column]!;
  return {
    name: column,
    source: 'dsl' as const,
    codecId: columnMeta.codecId,
    nativeType: columnMeta.nativeType,
  };
}

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
  it('orders include filter params after top-level params in collectParamRefs', () => {
    const { collection } = createCollection();
    const state = collection
      .where((user) => user.name.eq('Alice'))
      .include('posts', (posts) => posts.where((post) => post.views.gte(100))).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated');
    expect(plan.params).toEqual([100, 'Alice']);
    expect(plan.meta.paramDescriptors).toEqual([
      dslDescriptor('posts', 'views'),
      dslDescriptor('users', 'name'),
    ]);

    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      bindWhereExpr(
        baseContract,
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
      ).expr,
    );

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.where).toBeInstanceOf(AndExpr);
    expect(childRowsSource.query.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        bindWhereExpr(
          baseContract,
          BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ).expr,
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
    expect(plan.params).toEqual(['Alice', 'Alice', 7]);
    expect(plan.meta.paramDescriptors).toEqual([
      dslDescriptor('users', 'name'),
      dslDescriptor('users', 'name'),
      dslDescriptor('users', 'id'),
    ]);

    const gtName = bindWhereExpr(
      baseContract,
      BinaryExpr.gt(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    ).expr;
    const eqName = bindWhereExpr(
      baseContract,
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    ).expr;
    const ltId = bindWhereExpr(
      baseContract,
      BinaryExpr.lt(ColumnRef.of('users', 'id'), LiteralExpr.of(7)),
    ).expr;

    expect(plan.ast.where).toEqual(OrExpr.of([gtName, AndExpr.of([eqName, ltId])]));
    expect(plan.ast.distinctOn).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.limit).toBe(10);
    expect(plan.ast.offset).toBe(3);
  });

  it('builds single-column cursor boundaries and rejects incomplete cursors', () => {
    const { collection } = createCollection();
    const state = collection.orderBy((user) => user.id.asc()).cursor({ id: 9 }).state;

    const plan = compileSelect(baseContract, 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual([9]);
    expect(plan.meta.paramDescriptors).toEqual([dslDescriptor('users', 'id')]);
    expect(plan.ast.where).toEqual(
      bindWhereExpr(baseContract, BinaryExpr.gt(ColumnRef.of('users', 'id'), LiteralExpr.of(9)))
        .expr,
    );

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
    expect(plan.params).toEqual([1, 2, 'Hello']);
    expect(plan.meta.paramDescriptors).toEqual([
      dslDescriptor('posts', 'user_id'),
      dslDescriptor('posts', 'user_id'),
      dslDescriptor('posts', 'title'),
    ]);

    const inWhere = bindWhereExpr(
      baseContract,
      BinaryExpr.in(ColumnRef.of('posts', 'user_id'), ListLiteralExpr.fromValues([1, 2])),
    ).expr;
    const titleWhere = bindWhereExpr(
      baseContract,
      BinaryExpr.eq(ColumnRef.of('posts', 'title'), LiteralExpr.of('Hello')),
    ).expr;

    expect(plan.ast.where).toEqual(AndExpr.of([inWhere, titleWhere]));
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
