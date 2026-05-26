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
  ListExpression,
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
import {
  compileRelationSelect,
  compileSelect,
  compileSelectWithIncludeStrategy,
} from '../src/query-plan-select';
import { emptyState } from '../src/types';
import { bindWhereExpr } from '../src/where-binding';
import { baseContract, createCollection, createCollectionFor } from './collection-fixtures';
import { buildMixedPolyContract, isSelectAst } from './helpers';
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

describe('compileSelectWithIncludeStrategy', () => {
  it('collects params in AST traversal order (includes before top-level)', () => {
    const { collection } = createCollection();
    const state = collection
      .where((user) => user.name.eq('Alice'))
      .include('posts', (posts) => posts.where((post) => post.views.gte(100))).state;

    const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated');
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

    const plan = compileSelect(baseContract, 'users', state);
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

    const plan = compileSelect(baseContract, 'users', state);
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
    expect(() => compileSelect(baseContract, 'users', invalidState)).toThrow(
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

    const plan = compileSelect(baseContract, 'posts', state);
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

    const plan = compileSelect(baseContract, 'posts', state);
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

    const plan = compileSelect(baseContract, 'posts', state);
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

    const plan = compileSelect(baseContract, 'posts', state);
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

  it('prepends relation filters and clears nested paging for relation selects', () => {
    const { collection } = createCollectionFor('Post');
    const state = collection
      .where((post) => post.title.eq('Hello'))
      .take(2)
      .skip(1).state;

    const plan = compileRelationSelect(baseContract, 'posts', 'user_id', [1, 2], state);
    expectSelectAst(plan.ast);
    expect(plan.params).toEqual([1, 2, 'Hello']);
    expect(paramCodecs(plan)).toEqual([
      codecForColumn('posts', 'user_id'),
      codecForColumn('posts', 'user_id'),
      codecForColumn('posts', 'title'),
    ]);

    const inWhere = bindWhereExpr(
      baseContract,
      BinaryExpr.in(ColumnRef.of('posts', 'user_id'), ListExpression.fromValues([1, 2])),
    );
    const titleWhere = bindWhereExpr(
      baseContract,
      BinaryExpr.eq(ColumnRef.of('posts', 'title'), LiteralExpr.of('Hello')),
    );

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

  // Lateral lowers scalar reducers as `LEFT JOIN LATERAL (SELECT
  // json_build_object('value', AGG(...)) AS <rel> FROM <child> WHERE
  // <fk> = <parent>.<pk> [AND <user where>]) AS <alias> ON TRUE`.
  // The JSON wrapper lets the value travel through the existing
  // include-payload decoder (which JSON.parse'es the column and pulls
  // `.value` out) — no codec wiring needed on the outer projection,
  // and JSON-level numeric encoding matches the multi-query path's
  // observable shape (count: number, sum/avg/min/max: number | null).
  describe('lateral scalar reducers', () => {
    function extractScalarLateralSelect(plan: { ast: unknown }, alias: string): SelectAst {
      expectSelectAst(plan.ast);
      const join = plan.ast.joins?.find(
        (candidate) =>
          candidate.source.kind === 'derived-table-source' && candidate.source.alias === alias,
      );
      expect(join?.kind).toBe('join');
      expect(join?.lateral).toBe(true);
      expectDerivedTableSource(join?.source);
      return join.source.query;
    }

    function expectAggregateProjection(
      lateralSelect: SelectAst,
      relationName: string,
      expectedAggregate: AnyExpression,
    ): void {
      expect(lateralSelect.projection).toEqual([
        ProjectionItem.of(
          relationName,
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', expectedAggregate)]),
        ),
      ]);
    }

    it('emits LATERAL COUNT(*) for a bare count() include with no refinements', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.count()).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(lateralSelect, 'posts', AggregateExpr.count());
      expect(lateralSelect.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
      );
      // Aggregate scope must not carry pagination clauses.
      expect(lateralSelect.limit).toBeUndefined();
      expect(lateralSelect.offset).toBeUndefined();
      expect(lateralSelect.orderBy).toBeUndefined();

      // Outer projection references the lateral alias's relation column.
      expectSelectAst(plan.ast);
      const outerPostsProjection = plan.ast.projection.find((item) => item.alias === 'posts');
      expect(outerPostsProjection?.expr).toEqual(ColumnRef.of('posts_lateral', 'posts'));
    });

    it('emits LATERAL COUNT(*) over the where-filtered relation', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.where((post) => post.views.gte(100)).count(),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(lateralSelect, 'posts', AggregateExpr.count());
      expect(lateralSelect.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    // TML-2498 fix, baked in by construction: a `take(N)` / `skip(N)` on
    // a scalar refine is meaningless for an aggregate. The current
    // multi-query path silently mis-counts in this shape (the LIMIT
    // leaks into the row-fetch that feeds JS-side counting). The lateral
    // emission MUST omit LIMIT/OFFSET from the aggregate scope.
    it('TML-2498: LIMIT and OFFSET from take()/skip() do not enter COUNT scope', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts
          .where((post) => post.views.gte(100))
          .skip(5)
          .take(10)
          .count(),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expect(lateralSelect.limit).toBeUndefined();
      expect(lateralSelect.offset).toBeUndefined();
      // The where survives — the unpaginated-but-filtered scope is
      // exactly the root-level `aggregate()` semantics this slice aligns
      // include-scalar with.
      expect(lateralSelect.where).toEqual(
        AndExpr.of([
          BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          bindWhereExpr(
            baseContract,
            BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(100)),
          ),
        ]),
      );
    });

    it('emits LATERAL SUM(col) for sum()', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.sum('views')).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(
        lateralSelect,
        'posts',
        AggregateExpr.sum(ColumnRef.of('posts', 'views')),
      );
    });

    it('emits LATERAL AVG(col) for avg()', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.avg('views')).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(
        lateralSelect,
        'posts',
        AggregateExpr.avg(ColumnRef.of('posts', 'views')),
      );
    });

    it('emits LATERAL MIN(col) for min()', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.min('views')).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(
        lateralSelect,
        'posts',
        AggregateExpr.min(ColumnRef.of('posts', 'views')),
      );
    });

    it('emits LATERAL MAX(col) for max()', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) => posts.max('views')).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');

      expectAggregateProjection(
        lateralSelect,
        'posts',
        AggregateExpr.max(ColumnRef.of('posts', 'views')),
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

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');
      expect(lateralSelect.orderBy).toBeUndefined();
    });

    // Recursive carve-out: a `count()` nested inside a row include must
    // produce its own LATERAL inside the parent row's SELECT, and the
    // parent's json_object payload should reference that nested lateral's
    // column verbatim — JSON-on-JSON nesting Just Works because PG's
    // json_build_object embeds json values directly.
    it('emits a nested LATERAL for a count() inside a row include', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.include('comments', (comments) => comments.count()),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      expectSelectAst(plan.ast);

      // Top-level posts lateral.
      const postsLateralSelect = extractScalarLateralSelect(plan, 'posts_lateral');
      // Posts' inner SELECT (rows feeding the json_agg) carries the
      // nested comments lateral.
      expectDerivedTableSource(postsLateralSelect.from);
      const postsRows = postsLateralSelect.from.query;
      const commentsJoin = postsRows.joins?.find(
        (candidate) =>
          candidate.source.kind === 'derived-table-source' &&
          candidate.source.alias === 'comments_lateral',
      );
      expect(commentsJoin?.lateral).toBe(true);
      expectDerivedTableSource(commentsJoin?.source);
      expect(commentsJoin.source.query.projection).toEqual([
        ProjectionItem.of(
          'comments',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', AggregateExpr.count())]),
        ),
      ]);
    });
  });

  // Lateral lowers `combine({ a, b, ... })` as a single LATERAL JOIN
  // whose inner SELECT cross-joins each branch as a derived table and
  // projects `json_build_object('a', a_alias.<rel>, 'b', b_alias.<rel>, ...)`.
  // Row branches reuse the standalone row builder; scalar branches
  // reuse the standalone scalar builder (preserving the `{value:
  // <primitive>}` envelope inside the combined JSON — the decoder
  // unwraps per-branch).
  describe('lateral combine() packing', () => {
    function extractCombineLateralSelect(plan: { ast: unknown }, alias: string): SelectAst {
      expectSelectAst(plan.ast);
      const join = plan.ast.joins?.find(
        (candidate) =>
          candidate.source.kind === 'derived-table-source' && candidate.source.alias === alias,
      );
      expect(join?.kind).toBe('join');
      expect(join?.lateral).toBe(true);
      expectDerivedTableSource(join?.source);
      return join.source.query;
    }

    function expectCombineJsonProjection(
      lateralSelect: SelectAst,
      relationName: string,
      expectedEntries: ReadonlyArray<readonly [string, string]>,
    ): void {
      expect(lateralSelect.projection).toEqual([
        ProjectionItem.of(
          relationName,
          JsonObjectExpr.fromEntries(
            expectedEntries.map(([branchName, branchAlias]) =>
              JsonObjectExpr.entry(branchName, ColumnRef.of(branchAlias, relationName)),
            ),
          ),
        ),
      ]);
    }

    it('packs a row + scalar combine into one LATERAL with json_build_object', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          recent: posts.orderBy((p) => p.id.desc()).take(3),
          total: posts.count(),
        }),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractCombineLateralSelect(plan, 'posts_lateral');

      expectCombineJsonProjection(lateralSelect, 'posts', [
        ['recent', 'posts__combine__recent'],
        ['total', 'posts__combine__total'],
      ]);

      // FROM <recent_branch>, INNER JOIN <total_branch> ON TRUE.
      expectDerivedTableSource(lateralSelect.from);
      expect(lateralSelect.from.alias).toBe('posts__combine__recent');
      expect(lateralSelect.joins).toHaveLength(1);
      const totalJoin = lateralSelect.joins?.[0];
      expect(totalJoin?.joinType).toBe('inner');
      expect(totalJoin?.lateral).toBe(false);
      expect(totalJoin?.on).toEqual(AndExpr.true());
      expectDerivedTableSource(totalJoin?.source);
      expect(totalJoin.source.alias).toBe('posts__combine__total');

      // Each branch keeps its own FK correlation in WHERE.
      // The scalar branch (total): json_build_object('value', count(*)) AS posts
      const totalBranchSelect = totalJoin.source.query;
      expect(totalBranchSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', AggregateExpr.count())]),
        ),
      ]);
      expect(totalBranchSelect.where).toEqual(
        BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
      );
      // Pagination NEVER enters the scalar branch's scope.
      expect(totalBranchSelect.limit).toBeUndefined();
      expect(totalBranchSelect.offset).toBeUndefined();

      // The row branch (recent): paginated rows, json_agg'd.
      expectDerivedTableSource(lateralSelect.from);
      const recentBranchSelect = lateralSelect.from.query;
      expectDerivedTableSource(recentBranchSelect.from);
      const recentRows = recentBranchSelect.from.query;
      expect(recentRows.limit).toBe(3);
    });

    it('packs two scalar branches (count + sum) into one LATERAL', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          a: posts.count(),
          b: posts.sum('views'),
        }),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractCombineLateralSelect(plan, 'posts_lateral');

      expectCombineJsonProjection(lateralSelect, 'posts', [
        ['a', 'posts__combine__a'],
        ['b', 'posts__combine__b'],
      ]);

      // Branch a: SELECT json_build_object('value', count(*)) AS posts FROM posts WHERE FK
      expectDerivedTableSource(lateralSelect.from);
      const aSelect = lateralSelect.from.query;
      expect(aSelect.projection).toEqual([
        ProjectionItem.of(
          'posts',
          JsonObjectExpr.fromEntries([JsonObjectExpr.entry('value', AggregateExpr.count())]),
        ),
      ]);

      // Branch b: SELECT json_build_object('value', sum(views)) AS posts FROM posts WHERE FK
      const bJoin = lateralSelect.joins?.[0];
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

    it('keeps each branch independently scoped under divergent where filters', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          popular: posts.where((p) => p.views.gte(200)).count(),
          mediocre: posts.where((p) => p.views.lt(200)).count(),
        }),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractCombineLateralSelect(plan, 'posts_lateral');

      const fkExpr = BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'));
      const popularWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.gte(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );
      const mediocreWhere = bindWhereExpr(
        baseContract,
        BinaryExpr.lt(ColumnRef.of('posts', 'views'), LiteralExpr.of(200)),
      );

      expectDerivedTableSource(lateralSelect.from);
      const popularSelect = lateralSelect.from.query;
      expect(popularSelect.where).toEqual(AndExpr.of([fkExpr, popularWhere]));

      const mediocreJoin = lateralSelect.joins?.[0];
      expectDerivedTableSource(mediocreJoin?.source);
      const mediocreSelect = mediocreJoin.source.query;
      expect(mediocreSelect.where).toEqual(AndExpr.of([fkExpr, mediocreWhere]));
    });

    // Distinct interplay: the spec promises the row branch's existing
    // distinct(cols) lowering (ROW_NUMBER wrap from TML-2656) is reused
    // verbatim; scalar branches see the where-only relation. This pins
    // the row branch's ROW_NUMBER lowering survives into the combine
    // packing without combine-specific distinct handling.
    it('row branch with distinct() keeps its ROW_NUMBER lowering', () => {
      const { collection } = createCollection();
      const state = collection.include('posts', (posts) =>
        posts.combine({
          unique: posts.distinct('title'),
          total: posts.count(),
        }),
      ).state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      const lateralSelect = extractCombineLateralSelect(plan, 'posts_lateral');

      // The row branch's inner FROM source is the rows-derived-table
      // wrap; its query carries the `__prisma_distinct_rn` projection
      // (the ROW_NUMBER lowering signature).
      expectDerivedTableSource(lateralSelect.from);
      const uniqueBranchSelect = lateralSelect.from.query;
      expectDerivedTableSource(uniqueBranchSelect.from);
      const rowsWrap = uniqueBranchSelect.from.query;
      // The ROW_NUMBER wrap aliases to `${include.relationName}__distinct`.
      expect(rowsWrap.from.kind === 'derived-table-source').toBe(true);
    });

    // The dispatch path admits combine under lateral. Top-level row +
    // combine sibling: each becomes its own outer LATERAL; the planner
    // wires both projections into the parent SELECT.
    it('admits combine alongside a plain row include at the same level', () => {
      const { collection } = createCollection();
      const state = collection
        .include('posts', (posts) =>
          posts.combine({
            a: posts.count(),
            b: posts.sum('views'),
          }),
        )
        .include('profile').state;

      const plan = compileSelectWithIncludeStrategy(baseContract, 'users', state, 'lateral');
      expectSelectAst(plan.ast);
      // Both includes contribute joins.
      const aliases = plan.ast.joins?.map((j) =>
        j.source.kind === 'derived-table-source' ? j.source.alias : undefined,
      );
      expect(aliases).toEqual(expect.arrayContaining(['posts_lateral', 'profile_lateral']));
    });
  });

  it('still rejects scalar include selectors under the correlated strategy', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) => posts.count()).state;

    expect(() =>
      compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated'),
    ).toThrow('correlated include strategy does not support scalar include selectors');
  });

  it('still rejects combine() include descriptors under the correlated strategy', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts.combine({
        rows: posts.orderBy((p) => p.id.asc()),
        total: posts.count(),
      }),
    ).state;

    expect(() =>
      compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated'),
    ).toThrow('correlated include strategy does not support combine() include descriptors');
  });

  it('still rejects combine() nested inside row includes under the correlated strategy', () => {
    const { collection } = createCollection();
    const state = collection.include('posts', (posts) =>
      posts.include('comments', (comments) =>
        comments.combine({
          rows: comments.orderBy((c) => c.id.asc()),
          total: comments.count(),
        }),
      ),
    ).state;

    expect(() =>
      compileSelectWithIncludeStrategy(baseContract, 'users', state, 'correlated'),
    ).toThrow('correlated include strategy does not support combine() include descriptors');
  });
});

describe('compileSelect MTI JOINs', () => {
  type AnyContract = {
    storage: {
      namespaces: Record<
        string,
        { tables?: Record<string, { columns: Record<string, { codecId: string }> }> }
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
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
    ];

    const plan = compileSelect(contract, 'tasks', emptyState(), 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([JoinAst.left(TableSource.named('features'), featuresJoinOn)]),
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
    ]);
    const featuresMtiProjection = [
      ProjectionItem.of(
        'features__priority',
        ColumnRef.of('features', 'priority'),
        codecRefForColumn(contract, 'features', 'priority'),
      ),
    ];

    const plan = compileSelect(contract, 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks'))
        .withProjection([...tasksBaseProjection, ...featuresMtiProjection])
        .withSelectAllIntent({ table: 'tasks' })
        .withJoins([JoinAst.inner(TableSource.named('features'), featuresJoinOn)]),
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
    ]);

    const plan = compileSelect(contract, 'tasks', state, 'Task');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('tasks'))
        .withProjection(tasksBaseProjection)
        .withSelectAllIntent({ table: 'tasks' }),
    );
  });

  it('non-polymorphic model produces no JOINs', () => {
    const plan = compileSelect(baseContract, 'users', emptyState(), 'User');

    expect(plan.ast).toEqual(
      SelectAst.from(TableSource.named('users'))
        .withProjection(
          projectionFor(baseContract, 'users', ['address', 'email', 'id', 'invited_by_id', 'name']),
        )
        .withSelectAllIntent({ table: 'users' }),
    );
  });
});
