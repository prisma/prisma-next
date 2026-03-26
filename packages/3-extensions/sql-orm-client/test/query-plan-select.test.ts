import {
  AndExpr,
  BinaryExpr,
  type BoundWhereExpr,
  ColumnRef,
  type DerivedTableSource,
  ListLiteralExpr,
  OrExpr,
  ParamRef,
  type SelectAst,
  type SubqueryExpr,
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
const dslDescriptor = (table: string, column: string, index: number) => {
  const columnMeta = (
    baseContract.storage.tables as Record<
      string,
      { columns: Record<string, { codecId: string; nativeType: string; nullable: boolean }> }
    >
  )[table]!.columns[column]!;
  return {
    index,
    name: column,
    source: 'dsl' as const,
    refs: { table, column },
    codecId: columnMeta.codecId,
    nativeType: columnMeta.nativeType,
    nullable: columnMeta.nullable,
  };
};
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
  expect(expr).toBeDefined();
  expect((expr as { kind: string }).kind).toBe('subquery');
}

function expectDerivedTableSource(source: unknown): asserts source is DerivedTableSource {
  expect(source).toBeDefined();
  expect((source as { kind: string }).kind).toBe('derived-table-source');
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

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.where!.kind).toBe('and');
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
    expect(plan.params).toEqual(['Alice', 'Alice', 7]);
    expect(plan.meta.paramDescriptors).toEqual([
      dslDescriptor('users', 'name', 1),
      dslDescriptor('users', 'name', 2),
      dslDescriptor('users', 'id', 3),
    ]);

    expect(plan.ast.where).toEqual(
      OrExpr.of([
        BinaryExpr.gt(ColumnRef.of('users', 'name'), ParamRef.of(1, 'name')),
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('users', 'name'), ParamRef.of(2, 'name')),
          BinaryExpr.lt(ColumnRef.of('users', 'id'), ParamRef.of(3, 'id')),
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
    expect(plan.params).toEqual([9]);
    expect(plan.meta.paramDescriptors).toEqual([dslDescriptor('users', 'id', 1)]);
    expect(plan.ast.where).toEqual(
      BinaryExpr.gt(ColumnRef.of('users', 'id'), ParamRef.of(1, 'id')),
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
      dslDescriptor('posts', 'user_id', 1),
      dslDescriptor('posts', 'user_id', 2),
      dslDescriptor('posts', 'title', 3),
    ]);

    expect(plan.ast.where).toEqual(
      AndExpr.of([
        BinaryExpr.in(
          ColumnRef.of('posts', 'user_id'),
          ListLiteralExpr.of([ParamRef.of(1, 'user_id'), ParamRef.of(2, 'user_id')]),
        ),
        BinaryExpr.eq(ColumnRef.of('posts', 'title'), ParamRef.of(3, 'title')),
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
    expect(join?.kind).toBe('join');
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
