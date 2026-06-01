import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  type AnyParamRef,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  JsonObjectExpr,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { resolveIncludeRelation } from '../src/collection-contract';
import { compileSelect, compileSelectWithIncludes } from '../src/query-plan-select';
import { type CollectionState, emptyState, type IncludeExpr } from '../src/types';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import {
  buildManyToManyContract,
  buildMixedPolyContract,
  buildStiPolyContract,
  isSelectAst,
} from './helpers';
import { unboundTables } from './unbound-tables';

function codecForColumn(table: string, column: string): string {
  const columnMeta = (
    unboundTables(baseContract.storage) as Record<
      string,
      { columns: Record<string, { codecId: string; nullable: boolean }> }
    >
  )[table]!.columns[column]!;
  return columnMeta.codecId;
}

function paramCodecs(plan: {
  ast: { collectParamRefs(): AnyParamRef[] };
}): Array<string | undefined> {
  return [...new Set(plan.ast.collectParamRefs())].map((ref) =>
    ref.kind === 'param-ref' ? ref.codec?.codecId : ref.codec.codecId,
  );
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

describe('compileSelectWithIncludes', () => {
  it('collects params in AST traversal order (includes before top-level)', () => {
    const { collection } = createCollection();
    const state = collection
      .where((user) => user.name.eq('Alice'))
      .include('posts', (posts) => posts.where((post) => post.views.gte(100))).state;

    const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
    expect(plan.params).toEqual([100, 'Alice']);
    expect(paramCodecs(plan)).toEqual([
      codecForColumn('posts', 'views'),
      codecForColumn('users', 'name'),
    ]);

    expectSelectAst(plan.ast);

    expect(plan.ast.where).toEqual(
      bindWhereExpr(
        baseContract,
        BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
      ),
    );

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSource = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSource);

    expect(childRowsSource.query.where?.kind).toBe('and');
    expect(childRowsSource.query.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
        bindWhereExpr(
          baseContract,
          BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
        ),
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

    const plan = compileSelect(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual(['Alice', 'Alice', 7]);
    expect(paramCodecs(plan)).toEqual([
      codecForColumn('users', 'name'),
      codecForColumn('users', 'name'),
      codecForColumn('users', 'id'),
    ]);

    const gtName = bindWhereExpr(
      baseContract,
      BinaryExpr.gt(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    );
    const eqName = bindWhereExpr(
      baseContract,
      BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Alice')),
    );
    const ltId = bindWhereExpr(
      baseContract,
      BinaryExpr.lt(ColumnRef.of('users', 'id'), LiteralExpr.of(7)),
    );

    expect(plan.ast.where).toEqual(OrExpr.of([gtName, AndExpr.of([eqName, ltId])]));
    expect(plan.ast.distinctOn).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.limit).toBe(10);
    expect(plan.ast.offset).toBe(3);
  });

  it('builds single-column cursor boundaries and rejects incomplete cursors', () => {
    const { collection } = createCollection();
    const state = collection.orderBy((user) => user.id.asc()).cursor({ id: 9 }).state;

    const plan = compileSelect(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual([9]);
    expect(paramCodecs(plan)).toEqual([codecForColumn('users', 'id')]);
    expect(plan.ast.where).toEqual(
      bindWhereExpr(baseContract, BinaryExpr.gt(ColumnRef.of('users', 'id'), LiteralExpr.of(9))),
    );

    const invalidState = {
      ...collection.orderBy((user) => user.id.asc()).state,
      cursor: {},
    };
    expect(() => compileSelect(baseContract, 'public', 'users', invalidState)).toThrow(
      'Missing cursor value for orderBy column "id"',
    );
  });

  it('compiles expression-based orderBy to OrderByItem with the expression', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.desc(opExpr)],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      OrderByItem.asc(ColumnRef.of('posts', 'id')),
      OrderByItem.desc(opExpr),
    ]);

    expect(plan.params).toEqual([[1, 2, 3]]);
    const params = [...new Set(plan.ast.collectParamRefs())];
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({ name: 'searchVec', codec: { codecId: 'pg/vector@1' } });
  });

  it('cursor pagination ignores expression-based orders', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.desc(opExpr)],
      cursor: { id: 5 },
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      new OrderByItem(ColumnRef.of('posts', 'id'), 'asc'),
      new OrderByItem(opExpr, 'desc'),
    ]);

    expect(plan.ast.where).toEqual(
      bindWhereExpr(baseContract, BinaryExpr.gt(ColumnRef.of('posts', 'id'), LiteralExpr.of(5))),
    );
  });

  it('compiles extension operation in where() with correct params', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const whereExpr = new BinaryExpr('lt', opExpr, LiteralExpr.of(0.2));

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      filters: [whereExpr],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.params).toEqual([[1, 2, 3]]);
    const params = [...new Set(plan.ast.collectParamRefs())];
    expect(params).toHaveLength(1);
    expect(params[0]).toMatchObject({
      name: 'searchVec',
      codec: { codecId: 'pg/vector@1' },
    });
  });

  it('compiles mixed extension where + extension orderBy with correct param order', () => {
    const opExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([1, 2, 3], { name: 'searchVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const whereExpr = new BinaryExpr('lt', opExpr, LiteralExpr.of(0.5));

    const orderOpExpr = new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('posts', 'embedding'),
      args: [ParamRef.of([4, 5, 6], { name: 'orderVec', codec: { codecId: 'pg/vector@1' } })],
      returns: { codecId: 'builtin/float8', nullable: false },
      lowering: { targetFamily: 'sql', strategy: 'function', template: '{{self}} <=> {{arg0}}' },
    });

    const { collection } = createCollectionFor('Post');
    const state = {
      ...collection.state,
      filters: [whereExpr],
      orderBy: [OrderByItem.asc(ColumnRef.of('posts', 'id')), OrderByItem.asc(orderOpExpr)],
    };

    const plan = compileSelect(baseContract, 'public', 'posts', state);
    expectSelectAst(plan.ast);

    expect(plan.ast.orderBy).toEqual([
      OrderByItem.asc(ColumnRef.of('posts', 'id')),
      OrderByItem.asc(orderOpExpr),
    ]);

    expect(plan.params).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it('builds include subqueries with child distinctOn and offset', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts
        .orderBy((post) => post.title.asc())
        .distinctOn('title')
        .skip(1)
        .take(2),
    ).state;

    const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
    expectSelectAst(plan.ast);
    expect(plan.ast.joins ?? []).toHaveLength(0);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const aggregateQuery = postsProjection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);

    const childRows = aggregateQuery.from.query;
    expect(childRows.distinctOn).toEqual([ColumnRef.of('posts', 'title')]);
    expect(childRows.offset).toBe(1);
    expect(childRows.limit).toBe(2);
  });

  // Each scalar reducer lowers to a correlated subquery whose
  // projection is the `json_build_object('value', AGG(...))` envelope.
  // The JSON wrapper lets the value travel through the existing
  // include-payload decoder (which JSON.parse'es the column and pulls
  // `.value` out) — no codec wiring needed on the outer projection.
  describe('correlated scalar reducers', () => {
    function extractScalarCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    function expectAggregateProjection(
      subquerySelect: SelectAst,
      relationName: string,
      expectedAggregate: AnyExpression,
    ): void {
      expect(subquerySelect.projection).toEqual([
        ProjectionItem.of(
          relationName,
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', expectedAggregate)]),
        ),
      ]);
    }

    it('emits correlated COUNT(*) for a bare count() include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.count()).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count());
      expect(subquery.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
      );
      // Aggregate scope omits pagination / orderBy.
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.orderBy).toBeUndefined();
    });

    it('emits correlated COUNT(*) over the where-filtered relation', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gte(100)).count(),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count());
      expect(subquery.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `orderBy` on a scalar refine is meaningless for an aggregate.
    // Silently drop it at SQL level — matches existing behaviour for
    // other irrelevant clauses (e.g. ignoring select() in scalar context).
    it('silently drops orderBy() applied to a scalar refine', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.orderBy((post) => post.id.asc()).count(),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
      expect(subquery.orderBy).toBeUndefined();
    });

    // Pagination on a scalar refine composes through to the aggregate
    // scope: `take(N)` / `skip(M)` shape the row set the aggregate sees.
    it('pagination composes through to the correlated COUNT scope', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .where((post) => post.views.gte(100))
          .skip(5)
          .take(10)
          .count(),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(subquery, 'posts', AggregateExpr.count());
      expect(subquery.limit).toBeUndefined();
      expect(subquery.offset).toBeUndefined();
      expect(subquery.where).toBeUndefined();
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(10);
      expect(innerSelect.offset).toBe(5);
      expect(innerSelect.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // `distinct(cols).orderBy(c).take(N).sum(...)` must aggregate the
    // ordered top-N deduped rows. The ROW_NUMBER dedup wrap strips
    // ordering from its output, so the orderBy is reapplied on the
    // wrapped alias before LIMIT slices the deduped rows.
    it('reapplies orderBy after the ROW_NUMBER dedup wrap', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .distinct('title')
          .orderBy((post) => post.views.desc())
          .take(2)
          .sum('views'),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractScalarCorrelatedSubquery(plan, 'posts');

      expectAggregateProjection(
        subquery,
        'posts',
        AggregateExpr.sum(ColumnRef.of('posts__scalar', 'views')),
      );
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__scalar');

      const innerSelect = subquery.from.query;
      expect(innerSelect.limit).toBe(2);
      expectDerivedTableSource(innerSelect.from);
      expect(innerSelect.from.alias).toBe('posts__scalar_distinct');
      expect(innerSelect.orderBy).toEqual([
        new OrderByItem(ColumnRef.of('posts__scalar_distinct', 'posts__order_0'), 'desc'),
      ]);
    });

    it('emits correlated SUM / AVG / MIN / MAX over the column reference', () => {
      const reducers: ReadonlyArray<['sum' | 'avg' | 'min' | 'max', AggregateExpr]> = [
        ['sum', AggregateExpr.sum(ColumnRef.of('posts', 'views'))],
        ['avg', AggregateExpr.avg(ColumnRef.of('posts', 'views'))],
        ['min', AggregateExpr.min(ColumnRef.of('posts', 'views'))],
        ['max', AggregateExpr.max(ColumnRef.of('posts', 'views'))],
      ];
      for (const [fn, expected] of reducers) {
        const { collection } = createCollection();
        const state = collection.include('posts', (posts) => posts[fn]('views')).state;
        const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
        const subquery = extractScalarCorrelatedSubquery(plan, 'posts');
        expectAggregateProjection(subquery, 'posts', expected);
      }
    });

    // Recursive: scalar nested inside a row include emits a nested
    // correlated subquery inside the parent row's child SELECT.
    it('emits a nested correlated subquery for count() inside a row include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.include('comments', (comments) => comments.count()),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const postsSubquery = extractScalarCorrelatedSubquery(plan, 'posts');
      // The posts subquery's FROM is the child-rows derived table; its
      // inner SELECT carries the nested comments correlated subquery as
      // a projection item.
      expectDerivedTableSource(postsSubquery.from);
      const postsRows = postsSubquery.from.query;
      const commentsProjection = postsRows.projection.find((item) => item.alias === 'comments');
      expectSubqueryExpr(commentsProjection?.expr);
      expect(commentsProjection.expr.query.projection).toEqual([
        ProjectionItem.of(
          'comments',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', AggregateExpr.count())]),
        ),
      ]);
    });
  });

  // combine() packs into a single correlated subquery whose FROM
  // cross-joins per-branch derived tables and whose projection is the
  // `json_build_object`
  // over those branches.
  describe('correlated combine() packing', () => {
    function extractCombineCorrelatedSubquery(
      plan: { ast: unknown },
      relationName: string,
    ): SelectAst {
      expectSelectAst(plan.ast);
      const projection = plan.ast.projection.find((item) => item.alias === relationName);
      expectSubqueryExpr(projection?.expr);
      return projection.expr.query;
    }

    it('packs row + scalar combine into one correlated subquery', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((p) => p.id.desc()).take(3),
          total: posts.count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      // Outer projection is json_build_object referencing per-branch
      // derived-table aliases.
      expect(subquery.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('recent', ColumnRef.of('posts__combine__recent', 'posts')),
            JsonObjectExpr.entry('total', ColumnRef.of('posts__combine__total', 'posts')),
          ]),
        ),
      ]);

      // FROM <recent_branch>, INNER JOIN <total_branch> ON TRUE.
      expectDerivedTableSource(subquery.from);
      expect(subquery.from.alias).toBe('posts__combine__recent');
      const totalJoin = subquery.joins?.[0];
      expect(totalJoin?.joinType).toBe('inner');
      expect(totalJoin?.lateral).toBe(false);
      expect(totalJoin?.on).toEqual(AndExpr.true());
      expectDerivedTableSource(totalJoin?.source);
      expect(totalJoin.source.alias).toBe('posts__combine__total');
    });

    it('packs two scalar branches (count + sum) under correlated', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          a: posts.count(),
          b: posts.sum('views'),
        }),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      expectDerivedTableSource(subquery.from);
      const aSelect = subquery.from.query;
      expect(aSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', AggregateExpr.count())]),
        ),
      ]);
      const bJoin = subquery.joins?.[0];
      expectDerivedTableSource(bJoin?.source);
      const bSelect = bJoin.source.query;
      expect(bSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([
            JsonObjectExpr.entry('value', AggregateExpr.sum(ColumnRef.of('posts', 'views'))),
          ]),
        ),
      ]);
    });

    it('keeps each branch independently scoped under divergent where filters (correlated)', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          popular: posts.where((p) => p.views.gte(200)).count(),
          mediocre: posts.where((p) => p.views.lt(200)).count(),
        }),
      ).state;

      const plan = compileSelectWithIncludes(baseContract, 'public', 'users', state);
      const subquery = extractCombineCorrelatedSubquery(plan, 'posts');

      const fkExpr = BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'));
      const popularWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );
      const mediocreWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.lt(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );

      expectDerivedTableSource(subquery.from);
      const popularSelect = subquery.from.query;
      expect(popularSelect.where).toEqual(AndExpr.of([fkExpr, popularWhere]));
      const mediocreJoin = subquery.joins?.[0];
      expectDerivedTableSource(mediocreJoin?.source);
      const mediocreSelect = mediocreJoin.source.query;
      expect(mediocreSelect.where).toEqual(AndExpr.of([fkExpr, mediocreWhere]));
    });
  });
});

describe('M:N include correlated subquery', () => {
  function buildManyToManyIncludeExpr(opts: {
    junctionTable: string;
    parentColumns: string[];
    childColumns: string[];
    targetColumns: string[];
    parentLocalColumns?: string[];
  }): IncludeExpr {
    const parentLocalColumns = opts.parentLocalColumns ?? ['id'];
    return {
      relationName: 'children',
      relatedModelName: 'Child',
      relatedTableName: 'children',
      targetColumn: opts.targetColumns[0] ?? 'id',
      localColumn: parentLocalColumns[0] ?? 'id',
      cardinality: 'N:M',
      through: {
        table: opts.junctionTable,
        parentColumns: opts.parentColumns,
        childColumns: opts.childColumns,
        targetColumns: opts.targetColumns,
        parentLocalColumns,
      },
      nested: emptyState(),
      scalar: undefined,
      combine: undefined,
    };
  }

  it('compiles a single-column M:N include to one correlated subquery through the junction', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    });

    const include = buildManyToManyIncludeExpr({
      junctionTable: 'parent_child',
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
      parentLocalColumns: ['id'],
    });

    const state = { ...emptyState(), includes: [include] };
    const plan = compileSelectWithIncludes(contract, 'parents', state);

    expectSelectAst(plan.ast);
    // Single top-level subquery projection — no multiple executions
    const childrenProjection = plan.ast.projection.find((item) => item.alias === 'children');
    expectSubqueryExpr(childrenProjection?.expr);

    // Outer aggregate: FROM (child rows derived table)
    const aggregateQuery = childrenProjection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);
    expect(aggregateQuery.from.alias).toBe('children__rows');

    // Inner child rows SELECT
    const childRowsSelect = aggregateQuery.from.query;
    expect(childRowsSelect.from).toBeInstanceOf(TableSource);

    // The child SELECT has exactly one inner join to the junction — no LATERAL
    expect(childRowsSelect.joins).toHaveLength(1);
    const junctionJoin = childRowsSelect.joins![0]!;
    expect(junctionJoin.joinType).toBe('inner');
    expect(junctionJoin.lateral).toBe(false);
    expect(junctionJoin.source).toBeInstanceOf(TableSource);
    expect((junctionJoin.source as TableSource).name).toBe('parent_child');

    // JOIN ON: junction.child_id = children.id
    expect(junctionJoin.on).toEqual(
      BinaryExpr.eq(ColumnRef.of('parent_child', 'child_id'), ColumnRef.of('children', 'id')),
    );

    // WHERE correlates junction to parent: parent_child.parent_id = parents.id
    expect(childRowsSelect.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('parent_child', 'parent_id'), ColumnRef.of('parents', 'id')),
    );
  });

  it('AND-s across all column pairs for a composite-key M:N junction', () => {
    const contract = buildManyToManyContract({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      localFields: ['tenant_id', 'id'],
    });

    const include = buildManyToManyIncludeExpr({
      junctionTable: 'parent_child',
      parentColumns: ['tenant_id', 'parent_id'],
      childColumns: ['tenant_id', 'child_id'],
      targetColumns: ['tenant_id', 'id'],
      parentLocalColumns: ['tenant_id', 'id'],
    });

    const state = { ...emptyState(), includes: [include] };
    const plan = compileSelectWithIncludes(contract, 'parents', state);

    expectSelectAst(plan.ast);
    const childrenProjection = plan.ast.projection.find((item) => item.alias === 'children');
    expectSubqueryExpr(childrenProjection?.expr);

    const childRowsSelect = childrenProjection.expr.query.from;
    expectDerivedTableSource(childRowsSelect);
    const childSelect = childRowsSelect.query;

    // JOIN ON: AND(junction.tenant_id = children.tenant_id, junction.child_id = children.id)
    expect(childSelect.joins).toHaveLength(1);
    const junctionJoin = childSelect.joins![0]!;
    expect(junctionJoin.lateral).toBe(false);
    expect(junctionJoin.on).toEqual(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('parent_child', 'tenant_id'),
          ColumnRef.of('children', 'tenant_id'),
        ),
        BinaryExpr.eq(ColumnRef.of('parent_child', 'child_id'), ColumnRef.of('children', 'id')),
      ]),
    );

    // WHERE: AND(parent_child.tenant_id = parents.tenant_id, parent_child.parent_id = parents.id)
    expect(childSelect.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(
          ColumnRef.of('parent_child', 'tenant_id'),
          ColumnRef.of('parents', 'tenant_id'),
        ),
        BinaryExpr.eq(ColumnRef.of('parent_child', 'parent_id'), ColumnRef.of('parents', 'id')),
      ]),
    );
  });

  it('FK include path is unchanged (no regression)', () => {
    const { collection } = createCollection();
    const state = collection.include('posts').state;

    const plan = compileSelectWithIncludes(baseContract, 'users', state);
    expectSelectAst(plan.ast);

    const postsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
    expectSubqueryExpr(postsProjection?.expr);

    const childRowsSelect = postsProjection.expr.query.from;
    expectDerivedTableSource(childRowsSelect);
    const childSelect = childRowsSelect.query;

    // FK path: no JOIN to junction, just WHERE on child FK
    expect(childSelect.joins ?? []).toHaveLength(0);
    expect(childSelect.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
    );
  });

  // M:N + distinct(cols) + nested non-leaf include exercises
  // `buildDistinctNonLeafChildRowsSelect` which applies `junctionJoins` to
  // `baseInner` — the innermost scalar SELECT inside the ROW_NUMBER wrap.
  // This test verifies the junction join attaches to `baseInner` (not to the
  // dedup wrapper or the outer distinct SELECT) and that the correlated WHERE
  // is present at that same level.
  it('attaches junction join to baseInner in M:N + distinct + nested non-leaf path', () => {
    // Contract: parents -[M:N via parent_child]-> children (has `name` column),
    // children -[1:N FK]-> grandchildren (child_id → id).
    // We inline the contract to give `children` a `name` column for distinct.
    const contract = {
      domain: {
        namespaces: {
          public: {
            id: 'public',
            models: {
              Parent: {
                fields: { id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } } },
                relations: {
                  children: {
                    to: { model: 'Child', namespace: 'public' },
                    cardinality: 'N:M',
                    on: { localFields: ['id'], targetFields: ['id'] },
                    through: {
                      table: 'parent_child',
                      parentColumns: ['parent_id'],
                      childColumns: ['child_id'],
                      targetColumns: ['id'],
                    },
                  },
                },
                storage: { table: 'parents', fields: { id: { column: 'id' } } },
              },
              Child: {
                fields: {
                  id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                  name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
                storage: {
                  table: 'children',
                  fields: { id: { column: 'id' }, name: { column: 'name' } },
                },
              },
              Grandchild: {
                fields: {
                  id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                  child_id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                },
                relations: {},
                storage: {
                  table: 'grandchildren',
                  fields: {
                    id: { column: 'id' },
                    child_id: { column: 'child_id' },
                  },
                },
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          public: {
            id: 'public',
            tables: {
              parents: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              children: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              grandchildren: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  child_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              parent_child: {
                columns: {
                  parent_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  child_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['parent_id', 'child_id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
          },
        },
      },
      capabilities: {},
    };

    // Grandchild FK include: children.id → grandchildren.child_id
    const grandchildInclude: IncludeExpr = {
      relationName: 'grandchildren',
      relatedModelName: 'Grandchild',
      relatedTableName: 'grandchildren',
      targetColumn: 'child_id',
      localColumn: 'id',
      cardinality: '1:N',
      nested: emptyState(),
      scalar: undefined,
      combine: undefined,
    };

    // M:N include: parents → children via parent_child, with distinct('name')
    // and a nested non-leaf grandchild include — exercises
    // buildDistinctNonLeafChildRowsSelect.
    const include: IncludeExpr = {
      relationName: 'children',
      relatedModelName: 'Child',
      relatedTableName: 'children',
      targetColumn: 'id',
      localColumn: 'id',
      cardinality: 'N:M',
      through: {
        table: 'parent_child',
        parentColumns: ['parent_id'],
        childColumns: ['child_id'],
        targetColumns: ['id'],
        parentLocalColumns: ['id'],
      },
      nested: {
        ...emptyState(),
        distinct: ['name'],
        includes: [grandchildInclude],
      },
      scalar: undefined,
      combine: undefined,
    };

    const state = { ...emptyState(), includes: [include] };
    // Cast: inline contract literal is structurally compatible but lacks
    // generated nominal types; the cast is local to this test.
    const plan = compileSelectWithIncludes(
      contract as unknown as Parameters<typeof compileSelectWithIncludes>[0],
      'parents',
      state,
    );

    expectSelectAst(plan.ast);
    const childrenProjection = plan.ast.projection.find((item) => item.alias === 'children');
    expectSubqueryExpr(childrenProjection?.expr);

    // Aggregate wrapper: FROM (children__rows)
    const aggregateQuery = childrenProjection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);
    expect(aggregateQuery.from.alias).toBe('children__rows');

    // Outer distinct SELECT: FROM (children__distinct)
    const childRows = aggregateQuery.from.query;
    expectDerivedTableSource(childRows.from);
    expect(childRows.from.alias).toBe('children__distinct');

    // ROW_NUMBER dedup wrapper: FROM (children__ranked)
    const innerSelect = childRows.from.query;
    expectDerivedTableSource(innerSelect.from);
    expect(innerSelect.from.alias).toBe('children__ranked');

    // baseInner: innermost scalar SELECT — junction join must be here
    const baseInner = innerSelect.from.query;

    // Junction join attaches to baseInner, not the dedup wrapper or outer SELECT
    expect(baseInner.joins).toHaveLength(1);
    const junctionJoin = baseInner.joins![0]!;
    expect(junctionJoin.joinType).toBe('inner');
    expect(junctionJoin.lateral).toBe(false);
    expect(junctionJoin.source).toBeInstanceOf(TableSource);
    expect((junctionJoin.source as TableSource).name).toBe('parent_child');
    expect(junctionJoin.on).toEqual(
      BinaryExpr.eq(ColumnRef.of('parent_child', 'child_id'), ColumnRef.of('children', 'id')),
    );

    // Correlated WHERE is present at baseInner level
    expect(baseInner.where).toEqual(
      BinaryExpr.eq(ColumnRef.of('parent_child', 'parent_id'), ColumnRef.of('parents', 'id')),
    );

    // No junction join leaked to the dedup wrapper or outer distinct SELECT
    expect(innerSelect.joins ?? []).toHaveLength(0);
    expect(childRows.joins ?? []).toHaveLength(0);
  });
});

describe('compileSelect MTI JOINs', () => {
  type AnyContract = {
    storage: {
      namespaces: Record<
        string,
        {
          entries: {
            table: Record<string, { columns: Record<string, { codecId: string }> }>;
          };
        }
      >;
    };
  };
  function codecRefForColumn(
    contract: AnyContract,
    table: string,
    column: string,
  ): { codecId: string } | undefined {
    const tables = unboundTables(contract.storage) as Record<
      string,
      { columns: Record<string, { codecId: string }> } | undefined
    >;
    const codecId = tables[table]?.columns[column]?.codecId;
    return codecId ? { codecId } : undefined;
  }
  function projectionFor(
    contract: AnyContract,
    table: string,
    columns: readonly string[],
  ): ProjectionItem[] {
    return columns.map((column) =>
      ProjectionItem.of(
        column,
        ColumnRef.of(table, column),
        codecRefForColumn(contract, table, column),
      ),
    );
  }
  const featuresJoinOn = EqColJoinOn.of(
    ColumnRef.of('tasks', 'id'),
    ColumnRef.of('features', 'id'),
  );

  it('base query LEFT JOINs MTI variant tables with table-qualified aliases', () => {
    const contract = buildMixedPolyContract();
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
    ];

    const plan = compileSelect(contract, 'public', 'tasks', emptyState(), 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.left(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );
  });

  it('variant query INNER JOINs the specific MTI variant table', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Feature' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
    ];

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([
          JoinAst.inner(TableSource.named('features', undefined, 'public'), featuresJoinOn),
        ]),
    );
  });

  it('STI-only variant query produces no JOINs', () => {
    const contract = buildMixedPolyContract();
    const state = { ...emptyState(), variantName: 'Bug' };
    const tasksBaseProjection = projectionFor(contract, 'tasks', [
      'id',
      'title',
      'type',
      'severity',
      'project_id',
      'parent_id',
    ]);

    const plan = compileSelect(contract, 'public', 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks', undefined, 'public'))
        .withProjection(tasksBaseProjection)
        .withSelectAllIntent({ table: 'tasks' }),
    );
  });

  it('non-polymorphic model produces no JOINs', () => {
    const plan = compileSelect(baseContract, 'public', 'users', emptyState(), 'User');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users', undefined, 'public'))
        .withProjection(
          projectionFor(baseContract, 'users', ['address', 'email', 'id', 'invited_by_id', 'name']),
        )
        .withSelectAllIntent({ table: 'users' }),
    );
  });
});

describe('compileSelectWithIncludes polymorphic targets', () => {
  function includeFor(
    contract: Contract<SqlStorage>,
    parentModel: string,
    relationName: string,
    nested: CollectionState = emptyState(),
    namespaceId = 'public',
  ): IncludeExpr {
    const relation = resolveIncludeRelation(contract, namespaceId, parentModel, relationName);
    return {
      relationName,
      relatedModelName: relation.relatedModelName,
      relatedTableName: relation.relatedTableName,
      relatedNamespaceId: relation.relatedNamespaceId,
      targetColumn: relation.targetColumn,
      localColumn: relation.localColumn,
      cardinality: relation.cardinality,
      nested,
      scalar: undefined,
      combine: undefined,
    };
  }

  function stateWithInclude(include: IncludeExpr): CollectionState {
    return { ...emptyState(), includes: [include] };
  }

  function childRowsSelectFor(plan: { ast: unknown }, relationName: string): SelectAst {
    expectSelectAst(plan.ast);
    const projection = plan.ast.projection.find((item) => item.alias === relationName);
    expectSubqueryExpr(projection?.expr);
    const aggregateQuery = projection.expr.query;
    expectDerivedTableSource(aggregateQuery.from);
    return aggregateQuery.from.query;
  }

  function projectionAliases(select: SelectAst): string[] {
    return select.projection.map((item) => item.alias);
  }

  it('STI-target include projects discriminator and variant base-table columns, no joins', () => {
    const contract = buildStiPolyContract();
    const state = stateWithInclude(includeFor(contract, 'Account', 'members'));

    const plan = compileSelectWithIncludes(contract, 'public', 'accounts', state, 'Account');
    const childRows = childRowsSelectFor(plan, 'members');

    expect(childRows.joins ?? []).toHaveLength(0);
    const aliases = projectionAliases(childRows);
    expect(aliases).toContain('kind');
    expect(aliases).toContain('role');
    expect(aliases).toContain('plan');
  });

  it('MTI-target include left-joins variant tables and projects variant_table__column', () => {
    const contract = buildMixedPolyContract();
    const state = stateWithInclude(includeFor(contract, 'Project', 'tasks'));

    const plan = compileSelectWithIncludes(contract, 'public', 'projects_tbl', state, 'Project');
    const childRows = childRowsSelectFor(plan, 'tasks');

    expect(childRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);

    const aliases = projectionAliases(childRows);
    expect(aliases).toContain('type');
    expect(aliases).toContain('severity');
    expect(aliases).toContain('features__priority');
  });

  it('variant-narrowed MTI-target include inner-joins only the named variant', () => {
    const contract = buildMixedPolyContract();
    const include = includeFor(contract, 'Project', 'tasks', {
      ...emptyState(),
      variantName: 'Feature',
    });
    const state = stateWithInclude(include);

    const plan = compileSelectWithIncludes(contract, 'public', 'projects_tbl', state, 'Project');
    const childRows = childRowsSelectFor(plan, 'tasks');

    expect(childRows.joins).toEqual([
      JoinAst.inner(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
    expect(projectionAliases(childRows)).toContain('features__priority');
  });

  it('self-relation poly include remaps the variant join ON to the child alias', () => {
    const contract = buildMixedPolyContract();
    // `subtasks` is a Task→Task self relation; the child base table is
    // aliased, so the variant join ON must reference the alias rather
    // than the unaliased base table name.
    const state = stateWithInclude(includeFor(contract, 'Task', 'subtasks'));

    const plan = compileSelectWithIncludes(contract, 'public', 'tasks', state, 'Task');
    const childRows = childRowsSelectFor(plan, 'subtasks');

    expect(childRows.joins).toEqual([
      JoinAst.left(
        TableSource.named('features', undefined, 'public'),
        EqColJoinOn.of(ColumnRef.of('subtasks__child', 'id'), ColumnRef.of('features', 'id')),
      ),
    ]);
  });
});
