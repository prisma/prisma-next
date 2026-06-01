import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AggregateExpr,
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  type AstRewriter,
  BinaryExpr,
  type BinaryOp,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  OrderByItem,
  OrExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  WindowFuncExpr,
} from '@prisma-next/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  type PolymorphismInfo,
  resolvePolymorphismInfo,
  resolvePrimaryKeyColumn,
} from './collection-contract';
import { buildOrmQueryPlan, deriveParamsFromAst, resolveTableColumns } from './query-plan-meta';
import { augmentSelectionForJoinColumns } from './selection-shaping';
import { tableSourceForContract } from './storage-resolution';
import type { CollectionState, IncludeCombineBranch, IncludeExpr, IncludeScalar } from './types';
import { bindWhereExpr } from './where-binding';
import { combineWhereExprs } from './where-utils';

type CursorOrderEntry = {
  readonly column: string;
  readonly direction: 'asc' | 'desc';
  readonly value: unknown;
};

function buildProjection(
  contract: Contract<SqlStorage>,
  tableName: string,
  selectedFields: readonly string[] | undefined,
  tableRef = tableName,
): ProjectionItem[] {
  const columns =
    selectedFields && selectedFields.length > 0
      ? [...selectedFields]
      : resolveTableColumns(contract, tableName);

  return columns.map((column) =>
    ProjectionItem.of(
      column,
      ColumnRef.of(tableRef, column),
      codecRefForStorageColumn(contract.storage, tableName, column),
    ),
  );
}

function createBoundaryExpr(tableName: string, entry: CursorOrderEntry): AnyExpression {
  const comparator: BinaryOp = entry.direction === 'asc' ? 'gt' : 'lt';
  return new BinaryExpr(
    comparator,
    ColumnRef.of(tableName, entry.column),
    LiteralExpr.of(entry.value),
  );
}

function buildLexicographicCursorWhere(
  tableName: string,
  entries: readonly CursorOrderEntry[],
): AnyExpression {
  const branches = entries.map((entry, index): AnyExpression => {
    const branchExprs: AnyExpression[] = [];

    for (const prefixEntry of entries.slice(0, index)) {
      branchExprs.push(
        BinaryExpr.eq(
          ColumnRef.of(tableName, prefixEntry.column),
          LiteralExpr.of(prefixEntry.value),
        ),
      );
    }

    branchExprs.push(createBoundaryExpr(tableName, entry));
    if (branchExprs.length === 1) {
      return branchExprs[0] as AnyExpression;
    }

    return AndExpr.of(branchExprs);
  });

  if (branches.length === 1) {
    return branches[0] as AnyExpression;
  }

  return OrExpr.of(branches);
}

function buildCursorWhere(
  tableName: string,
  orderBy: readonly OrderByItem[] | undefined,
  cursor: Readonly<Record<string, unknown>> | undefined,
): AnyExpression | undefined {
  if (!cursor || !orderBy || orderBy.length === 0) {
    return undefined;
  }

  const entries: CursorOrderEntry[] = [];
  for (const order of orderBy) {
    if (order.expr.kind !== 'column-ref') continue;
    const column = order.expr.column;
    const value = cursor[column];
    if (value === undefined) {
      throw new Error(`Missing cursor value for orderBy column "${column}"`);
    }
    entries.push({
      column,
      direction: order.dir,
      value,
    });
  }

  const firstEntry = entries[0];
  if (entries.length === 1 && firstEntry !== undefined) {
    return createBoundaryExpr(tableName, firstEntry);
  }

  return buildLexicographicCursorWhere(tableName, entries);
}

function createTableRefRemapper(fromTable: string, toTable: string): AstRewriter {
  return {
    columnRef: (col) => (col.table === fromTable ? ColumnRef.of(toTable, col.column) : col),
    tableSource: (source) => {
      if (source.alias === fromTable) {
        return TableSource.named(source.name, toTable, source.namespaceId);
      }
      if (!source.alias && source.name === fromTable) {
        return TableSource.named(source.name, toTable, source.namespaceId);
      }
      return source;
    },
    eqColJoinOn: (on) =>
      EqColJoinOn.of(
        on.left.table === fromTable ? ColumnRef.of(toTable, on.left.column) : on.left,
        on.right.table === fromTable ? ColumnRef.of(toTable, on.right.column) : on.right,
      ),
  };
}

function buildStateWhere(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  options?: {
    readonly filterTableName?: string;
  },
): AnyExpression | undefined {
  const filterTableName = options?.filterTableName;
  const cursorTableName = filterTableName ?? tableName;
  const cursorWhere = buildCursorWhere(cursorTableName, state.orderBy, state.cursor);
  const remappedFilters =
    filterTableName && filterTableName !== tableName
      ? state.filters.map((filter) =>
          filter.rewrite(createTableRefRemapper(filterTableName, tableName)),
        )
      : state.filters;
  const boundCursorWhere = cursorWhere ? bindWhereExpr(contract, cursorWhere) : undefined;
  const remappedCursorWhere =
    boundCursorWhere && filterTableName && filterTableName !== tableName
      ? boundCursorWhere.rewrite(createTableRefRemapper(filterTableName, tableName))
      : boundCursorWhere;
  const filters = remappedCursorWhere ? [...remappedFilters, remappedCursorWhere] : remappedFilters;
  return combineWhereExprs(filters);
}

function buildIncludeOrderArtifacts(
  relationName: string,
  rowAlias: string,
  childOrderBy: readonly OrderByItem[] | undefined,
): {
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  if (!childOrderBy || childOrderBy.length === 0) {
    return {
      childOrderBy: undefined,
      hiddenOrderProjection: [],
      aggregateOrderBy: undefined,
    };
  }

  const hiddenOrderProjection = childOrderBy.map((orderItem, index) =>
    ProjectionItem.of(`${relationName}__order_${index}`, orderItem.expr),
  );
  const aggregateOrderBy = hiddenOrderProjection.map((projection, index) => {
    const orderItem = childOrderBy[index];
    if (!orderItem) {
      throw new Error(`Missing include order metadata at index ${index}`);
    }
    return new OrderByItem(ColumnRef.of(rowAlias, projection.alias), orderItem.dir);
  });

  return {
    childOrderBy,
    hiddenOrderProjection,
    aggregateOrderBy,
  };
}

/**
 * Wrap a base SELECT in a `ROW_NUMBER() OVER (PARTITION BY … ORDER BY …) = 1`
 * filter, implementing Prisma-style `.distinct(cols)` semantics: one
 * representative row per `(distinctColumnRefs)` group is kept; the rest
 * are dropped.
 *
 * Picking which row survives in each partition is governed by
 * `rankingOrderBy`. When the caller's `orderBy` doesn't fully order rows
 * within a partition (e.g. user wrote `.distinct('title')` with no
 * `orderBy`, or ties in their ordering), the choice is
 * implementation-defined — matching Prisma's documented nested-distinct
 * behaviour. Callers that want determinism should pass an `orderBy` that
 * is total within each partition.
 *
 * The wrapper forwards every column of `base.projection` through the
 * derived alias, so the wrapper's projection is byte-identical in alias
 * names — making this transparent to any outer query (`json_agg`,
 * correlated subquery, top-level SELECT) that consumes the SELECT.
 */
function wrapWithRowNumberDedup(options: {
  readonly base: SelectAst;
  readonly distinctColumnRefs: ReadonlyArray<AnyExpression>;
  readonly rankingOrderBy: ReadonlyArray<OrderByItem>;
  readonly rankedAlias: string;
}): SelectAst {
  const { base, distinctColumnRefs, rankingOrderBy, rankedAlias } = options;
  const rnAlias = '__prisma_distinct_rn';
  // SQLite requires an ORDER BY inside the window spec for ranking
  // functions; Postgres allows omitting it but the result is
  // unspecified. Default to ordering by the partition columns so the
  // emitted SQL is portable AND deterministic-modulo-distinct-cols
  // (which is the natural choice when the caller didn't specify).
  const effectiveOrderBy =
    rankingOrderBy.length > 0
      ? rankingOrderBy
      : distinctColumnRefs.map((expr) => OrderByItem.asc(expr));

  const inner = base.withProjection([
    ...base.projection,
    ProjectionItem.of(
      rnAlias,
      WindowFuncExpr.rowNumber({
        partitionBy: distinctColumnRefs,
        orderBy: effectiveOrderBy,
      }),
    ),
  ]);

  return SelectAst.from(DerivedTableSource.as(rankedAlias, inner))
    .withProjection(
      base.projection.map((item) =>
        ProjectionItem.of(item.alias, ColumnRef.of(rankedAlias, item.alias)),
      ),
    )
    .withWhere(BinaryExpr.eq(ColumnRef.of(rankedAlias, rnAlias), LiteralExpr.of(1)));
}

/**
 * Recursively build the correlated-subquery projections for the nested
 * includes attached to a child SELECT. Used by `buildIncludeChildRowsSelect`
 * to wire depth-2+ aggregates into the inner SELECT at each level.
 *
 * Each nested include contributes a single projection item whose
 * expression is a correlated subquery.
 */
function buildNestedIncludeProjections(
  contract: Contract<SqlStorage>,
  parentTableRef: string,
  includes: readonly IncludeExpr[],
): ReadonlyArray<ProjectionItem> {
  return includes.map(
    (nested) => buildCorrelatedIncludeProjection(contract, parentTableRef, nested).projection,
  );
}

/**
 * Resolve the MTI variant joins + `variant_table__column` projection for an
 * include whose target model is polymorphic, mirroring the parent path in
 * `compileSelectWithIncludes`. The discriminator column and any STI
 * variant-specific columns live on the base table and reach the row through
 * the ordinary base-column projection (`buildProjection`); only the MTI
 * variant tables need a join.
 *
 * When the child base table is aliased (self-relations), `buildMtiJoins`
 * emits a join `ON` against the unaliased base table name, which would fall
 * out of scope. Remap it to the child alias — the same remap the row builder
 * already applies to `orderBy`/`where`.
 */
function buildChildPolymorphismArtifacts(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  childTableAlias: string | undefined,
  childTableRef: string,
): { joins: ReadonlyArray<JoinAst>; projection: ReadonlyArray<ProjectionItem> } {
  const polyInfo = resolvePolymorphismInfo(contract, include.relatedModelName);
  if (!polyInfo || polyInfo.mtiVariants.length === 0) {
    return { joins: [], projection: [] };
  }

  const { joins, projection } = buildMtiJoins(contract, polyInfo, include.nested.variantName);
  if (!childTableAlias) {
    return { joins, projection };
  }

  const remapper = createTableRefRemapper(polyInfo.baseTable, childTableRef);
  return {
    joins: joins.map((join) => join.rewrite(remapper)),
    projection,
  };
}

function buildIncludeChildRowsSelect(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const childState = include.nested;
  const childTableAlias =
    include.relatedTableName === parentTableName ? `${include.relationName}__child` : undefined;
  const childTableRef = childTableAlias ?? include.relatedTableName;
  const rowsAlias = `${include.relationName}__rows`;
  // Self-relations rename the inner table source via `childTableAlias`,
  // so any ColumnRef the user-supplied `orderBy` carries against the
  // original `include.relatedTableName` is no longer in scope inside the
  // child SELECT. Remap before lowering to the hidden order projection
  // — mirrors the `filterTableName` remap `buildStateWhere` applies to
  // the where clauses just below.
  const remappedChildOrderBy =
    childTableAlias && childState.orderBy
      ? childState.orderBy.map((item) =>
          item.rewrite(createTableRefRemapper(include.relatedTableName, childTableRef)),
        )
      : childState.orderBy;
  const { childOrderBy, hiddenOrderProjection, aggregateOrderBy } = buildIncludeOrderArtifacts(
    include.relationName,
    rowsAlias,
    remappedChildOrderBy,
  );
  const childWhere = buildStateWhere(contract, childTableRef, childState, {
    filterTableName: include.relatedTableName,
  });
  const joinExpr = BinaryExpr.eq(
    ColumnRef.of(childTableRef, include.targetColumn),
    ColumnRef.of(parentTableName, include.localColumn),
  );
  const whereExpr = childWhere ? AndExpr.of([joinExpr, childWhere]) : joinExpr;

  // `distinct()` on a non-leaf include cannot be lowered as
  // `SELECT DISTINCT <scalars>, json_agg(<grandchild>) FROM ...`:
  // Postgres rejects equality on the `json` aggregate column. Instead,
  // pre-dedupe scalar child rows in a wrapped subquery — force-including
  // the grandchild join keys so the outer aggregates can correlate back
  // to the deduped rows — and attach grandchild aggregates onto that
  // wrapped result. `DISTINCT` runs over scalar columns only, no `json`
  // column is in scope, and the user-visible row shape stays bit-for-bit
  // equivalent to the multi-query stitcher's output (which applies the
  // same force-include + strip-hidden pattern in JS).
  const isDistinctNonLeaf =
    childState.distinct !== undefined &&
    childState.distinct.length > 0 &&
    childState.includes.length > 0;

  if (isDistinctNonLeaf) {
    return buildDistinctNonLeafChildRowsSelect({
      contract,
      include,
      childTableAlias,
      childTableRef,
      rowsAlias,
      childOrderBy,
      hiddenOrderProjection,
      aggregateOrderBy,
      whereExpr,
    });
  }

  const scalarProjection = buildProjection(
    contract,
    include.relatedTableName,
    childState.selectedFields,
    childTableRef,
  );

  // When the include target is polymorphic, mirror the parent path: join
  // the MTI variant tables into the correlated subquery's FROM and project
  // their `variant_table__column` cells so the decoder can resolve each
  // row's variant. The discriminator + STI variant columns ride the base
  // projection above.
  const polyArtifacts = buildChildPolymorphismArtifacts(
    contract,
    include,
    childTableAlias,
    childTableRef,
  );

  // Recurse: each nested include produces a correlated subquery
  // projection. The nested aggregates are attached to *this* child
  // SELECT, so they correlate against `childTableRef` — which may itself
  // be an alias if the relation is self-referential.
  const nestedProjections = buildNestedIncludeProjections(
    contract,
    childTableRef,
    childState.includes,
  );

  // `childProjection` is the set of items that survive into the parent's
  // JSON object — the scalar columns, the MTI variant columns, plus any
  // nested-include aggregate columns. The hidden order-by projection is
  // separate and is dropped before assembling the parent's
  // json_object_expr.
  const childProjection: ReadonlyArray<ProjectionItem> = [
    ...scalarProjection,
    ...polyArtifacts.projection,
    ...nestedProjections,
  ];

  let childRows = SelectAst.from(
    tableSourceForContract(contract, include.relatedTableName, childTableAlias),
  )
    .withProjection([...childProjection, ...hiddenOrderProjection])
    .withWhere(whereExpr);
  if (polyArtifacts.joins.length > 0) {
    childRows = childRows.withJoins([...polyArtifacts.joins]);
  }

  if (childState.distinctOn && childState.distinctOn.length > 0) {
    childRows = childRows.withDistinctOn(
      childState.distinctOn.map((column) => ColumnRef.of(childTableRef, column)),
    );
    if (childOrderBy) {
      childRows = childRows.withOrderBy(childOrderBy);
    }
  } else if (childState.distinct && childState.distinct.length > 0) {
    // Prisma-style `.distinct(cols)`: keep one representative row per
    // (distinct cols) group. Plain SQL `DISTINCT` over the projected row
    // set dedupes nothing when the projection includes columns outside
    // `distinct cols` (typically an `id`), so we lower to a
    // `ROW_NUMBER() OVER (PARTITION BY <cols> ORDER BY …) = 1` wrap.
    // The user's `orderBy` (if any) feeds the OVER clause so it picks
    // the right representative; we reapply it on the wrapped SELECT
    // for any subsequent LIMIT/OFFSET. See `wrapWithRowNumberDedup`.
    const rankedAlias = `${include.relationName}__distinct`;
    childRows = wrapWithRowNumberDedup({
      base: childRows,
      distinctColumnRefs: childState.distinct.map((column) => ColumnRef.of(childTableRef, column)),
      rankingOrderBy: childOrderBy ?? [],
      rankedAlias,
    });
    if (childOrderBy) {
      childRows = childRows.withOrderBy(
        childOrderBy.map(
          (item, index) =>
            new OrderByItem(
              ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
              item.dir,
            ),
        ),
      );
    }
  } else if (childOrderBy) {
    childRows = childRows.withOrderBy(childOrderBy);
  }
  if (childState.limit !== undefined) {
    childRows = childRows.withLimit(childState.limit);
  }
  if (childState.offset !== undefined) {
    childRows = childRows.withOffset(childState.offset);
  }

  return {
    childRows,
    childProjection,
    rowsAlias,
    aggregateOrderBy,
  };
}

function buildDistinctNonLeafChildRowsSelect(options: {
  readonly contract: Contract<SqlStorage>;
  readonly include: IncludeExpr;
  readonly childTableAlias: string | undefined;
  readonly childTableRef: string;
  readonly rowsAlias: string;
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly whereExpr: AnyExpression;
}): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const {
    contract,
    include,
    childTableAlias,
    childTableRef,
    rowsAlias,
    childOrderBy,
    hiddenOrderProjection,
    aggregateOrderBy,
    whereExpr,
  } = options;
  const childState = include.nested;

  // Force-include every grandchild's `localColumn` into the distinct
  // projection so the outer aggregates can join against the deduped rows.
  // When the user's `.select(...)` already covers the join keys this is a
  // no-op; when it doesn't (e.g. `.select('title').distinct('title').include('comments')`)
  // the join keys appear inside the wrapper subquery only and are stripped
  // from the user-visible projection in the outer SELECT.
  //
  // De-duplicate before projection: two sibling nested includes can share
  // the same `localColumn` on the distinct child (e.g. a `User` whose
  // `posts` and `invitedUsers` grandchildren both join from `users.id`).
  const grandchildJoinColumns = Array.from(
    new Set(childState.includes.map((nested) => nested.localColumn)),
  );
  const { selectedForQuery } = augmentSelectionForJoinColumns(
    childState.selectedFields,
    grandchildJoinColumns,
  );

  // INNER: per-column-distinct scalar select with force-included join
  // keys + hidden order-by projections. No nested aggregates yet — the
  // ROW_NUMBER-based dedup only sees scalar columns; pre-deduped rows
  // are the input to the outer wrap.
  //
  // We use `ROW_NUMBER() OVER (PARTITION BY <distinct cols> ORDER BY …)
  // = 1` rather than SQL `DISTINCT` because the latter dedupes by the
  // full projected row — and we force-include grandchild join keys
  // (e.g. `post.id` so the `comments` correlated subquery can correlate). With those
  // join keys in the projection, plain `DISTINCT` would never collapse
  // rows whose ids differ, making `.distinct('title')` a no-op. The
  // window-function form partitions strictly on the user's chosen
  // columns and is therefore correct regardless of what else lives in
  // the projection.
  const innerScalarProjection = buildProjection(
    contract,
    include.relatedTableName,
    selectedForQuery,
    childTableRef,
  );

  // Polymorphic target: join the MTI variant tables into the pre-dedup
  // inner SELECT and carry their `variant_table__column` cells through the
  // ROW_NUMBER wrap so they reach the outer projection (forwarded by alias
  // from `distinctAlias` below). The discriminator + STI variant columns
  // ride the base projection.
  const polyArtifacts = buildChildPolymorphismArtifacts(
    contract,
    include,
    childTableAlias,
    childTableRef,
  );
  let baseInner = SelectAst.from(
    tableSourceForContract(contract, include.relatedTableName, childTableAlias),
  )
    .withProjection([
      ...innerScalarProjection,
      ...polyArtifacts.projection,
      ...hiddenOrderProjection,
    ])
    .withWhere(whereExpr);
  if (polyArtifacts.joins.length > 0) {
    baseInner = baseInner.withJoins([...polyArtifacts.joins]);
  }

  // `childState.distinct` is non-empty by the `isDistinctNonLeaf` guard
  // at the only caller (`buildIncludeChildRowsSelect`); assert here so
  // the partition expression list below is well-typed without a cast.
  const distinctColumns = childState.distinct;
  if (distinctColumns === undefined || distinctColumns.length === 0) {
    throw new Error(
      'buildDistinctNonLeafChildRowsSelect requires a non-empty `distinct` selection',
    );
  }
  const rankedAlias = `${include.relationName}__ranked`;
  let innerSelect = wrapWithRowNumberDedup({
    base: baseInner,
    distinctColumnRefs: distinctColumns.map((column) => ColumnRef.of(childTableRef, column)),
    rankingOrderBy: childOrderBy ?? [],
    rankedAlias,
  });
  if (childOrderBy) {
    // Reapply user's orderBy on the deduped result so LIMIT/OFFSET are
    // deterministic. Reference the hidden-order alias columns the
    // wrapper forwarded under their original names from `rankedAlias`.
    innerSelect = innerSelect.withOrderBy(
      childOrderBy.map(
        (item, index) =>
          new OrderByItem(
            ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
            item.dir,
          ),
      ),
    );
  }
  if (childState.limit !== undefined) {
    innerSelect = innerSelect.withLimit(childState.limit);
  }
  if (childState.offset !== undefined) {
    innerSelect = innerSelect.withOffset(childState.offset);
  }

  const distinctAlias = `${include.relationName}__distinct`;

  // OUTER: user-visible scalar projection (using the original
  // `selectedFields`, which strips any force-included hidden columns) +
  // nested aggregates correlated against the distinct alias instead of
  // the underlying table.
  const outerScalarProjection = buildProjection(
    contract,
    include.relatedTableName,
    childState.selectedFields,
    distinctAlias,
  );
  const outerNestedProjections = buildNestedIncludeProjections(
    contract,
    distinctAlias,
    childState.includes,
  );

  // Forward the MTI variant columns the inner wrap carried under their
  // `variant_table__column` aliases onto the outer SELECT, now sourced
  // from the deduped distinct alias (their join is gone at this level).
  const outerPolyProjection = polyArtifacts.projection.map((proj) =>
    ProjectionItem.of(proj.alias, ColumnRef.of(distinctAlias, proj.alias), proj.codec),
  );

  // Forward hidden order columns from the inner distinct subquery to the
  // outer SELECT so `aggregateOrderBy` (which still references `rowsAlias`)
  // can resolve them when the outer wrap materialises `(childRows) AS rowsAlias`.
  const outerHiddenOrderProjection = hiddenOrderProjection.map((proj) =>
    ProjectionItem.of(proj.alias, ColumnRef.of(distinctAlias, proj.alias)),
  );

  const childProjection: ReadonlyArray<ProjectionItem> = [
    ...outerScalarProjection,
    ...outerPolyProjection,
    ...outerNestedProjections,
  ];

  const childRows = SelectAst.from(
    DerivedTableSource.as(distinctAlias, innerSelect),
  ).withProjection([...childProjection, ...outerHiddenOrderProjection]);

  return {
    childRows,
    childProjection,
    rowsAlias,
    aggregateOrderBy,
  };
}

/**
 * Build the inner SELECT for a scalar include reducer (`count` /
 * `sum` / `avg` / `min` / `max`).
 *
 * Emits one row containing `json_build_object('value', AGG(...))`
 * over the child relation correlated to the parent via the FK. The
 * JSON wrap lets the value flow through the existing include-payload
 * decoder unchanged (it JSON.parses the column and the scalar branch
 * pulls `.value` out).
 *
 * The refine state's pipeline composes through to the aggregate's
 * input set: `where` / `orderBy` / `take` / `skip` / `distinct` shape
 * the rows the aggregate sees, matching the natural compositional
 * semantic of
 *
 *   `db.User.include('posts', p => p.where(W).take(N).count())  // ≤ N`
 *
 * When `take` / `skip` / `distinct` is set, the aggregate's input
 * cannot just be the bare correlated table — a top-level `LIMIT` on
 * the aggregating SELECT only trims the (already one-row) output, not
 * the rows being aggregated. We therefore wrap the source in a
 * derived SELECT that materialises the shaped row set, then
 * aggregate over that. `orderBy` alone (no `take` / `skip` /
 * `distinct`) is dropped at the SQL level since reordering does not
 * change which rows are aggregated.
 */
function buildIncludeChildScalarSelect(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  scalar: IncludeScalar<unknown>,
): SelectAst {
  const childTableAlias =
    include.relatedTableName === parentTableName ? `${include.relationName}__child` : undefined;
  const childTableRef = childTableAlias ?? include.relatedTableName;
  const state = scalar.state;

  const joinExpr = BinaryExpr.eq(
    ColumnRef.of(childTableRef, include.targetColumn),
    ColumnRef.of(parentTableName, include.localColumn),
  );
  const childWhere = buildStateWhere(contract, childTableRef, state, {
    filterTableName: include.relatedTableName,
  });
  const whereExpr = childWhere ? AndExpr.of([joinExpr, childWhere]) : joinExpr;

  // Self-relations rename the inner table source via `childTableAlias`;
  // remap any ColumnRef the user-supplied `orderBy` carries against
  // the original table name to the alias — mirrors the row-include
  // path.
  const remappedOrderBy =
    childTableAlias && state.orderBy
      ? state.orderBy.map((item) =>
          item.rewrite(createTableRefRemapper(include.relatedTableName, childTableRef)),
        )
      : state.orderBy;

  const hasPagination = state.limit !== undefined || state.offset !== undefined;
  const hasDistinct =
    (state.distinct !== undefined && state.distinct.length > 0) ||
    (state.distinctOn !== undefined && state.distinctOn.length > 0);
  const needsInnerScoping = hasPagination || hasDistinct;

  if (!needsInnerScoping) {
    const aggregateExpr = buildIncludeAggregateExpr(scalar, childTableRef);
    const jsonObjectExpr = JsonObjectExpr.fromEntries([
      JsonObjectExpr.entry('value', aggregateExpr),
    ]);
    return SelectAst.from(
      tableSourceForContract(contract, include.relatedTableName, childTableAlias),
    )
      .withProjection([ProjectionItem.of(include.relationName, jsonObjectExpr)])
      .withWhere(whereExpr);
  }

  // Inner SELECT: materialise the shaped row set. Project only what
  // the outer aggregate needs (the aggregate's column, or a constant
  // for COUNT). ORDER BY columns are accessible via the FROM scope
  // and don't need to be in the projection. Distinct columns are
  // accessible to ROW_NUMBER OVER PARTITION BY the same way.
  //
  // Exception: when `state.distinct` (Prisma-style ROW_NUMBER dedup)
  // is combined with `orderBy`, we must reapply the ordering on the
  // wrapped (post-dedup) result so subsequent LIMIT / OFFSET slices
  // the ordered deduped rows. Postgres has no contract that rows
  // exit the `WHERE rn=1` wrap in any particular order. To do that
  // we carry hidden order columns through the wrap and re-reference
  // them on the wrapped alias — mirrors the row-include lowering in
  // `buildIncludeChildRowsSelect`'s distinct branch.
  const innerAlias = `${include.relationName}__scalar`;
  const needsHiddenOrderProjection =
    state.distinct !== undefined &&
    state.distinct.length > 0 &&
    remappedOrderBy !== undefined &&
    remappedOrderBy.length > 0;
  const hiddenOrderProjection: ReadonlyArray<ProjectionItem> = needsHiddenOrderProjection
    ? remappedOrderBy.map((item, index) =>
        ProjectionItem.of(`${include.relationName}__order_${index}`, item.expr),
      )
    : [];
  const innerProjection: ProjectionItem[] = [
    ...(scalar.column !== undefined
      ? [ProjectionItem.of(scalar.column, ColumnRef.of(childTableRef, scalar.column))]
      : [ProjectionItem.of('__row', LiteralExpr.of(1))]),
    ...hiddenOrderProjection,
  ];

  let inner = SelectAst.from(
    tableSourceForContract(contract, include.relatedTableName, childTableAlias),
  )
    .withProjection(innerProjection)
    .withWhere(whereExpr);

  if (state.distinctOn !== undefined && state.distinctOn.length > 0) {
    inner = inner.withDistinctOn(
      state.distinctOn.map((column) => ColumnRef.of(childTableRef, column)),
    );
    if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
      inner = inner.withOrderBy(remappedOrderBy);
    }
  } else if (state.distinct !== undefined && state.distinct.length > 0) {
    // Prisma-style `.distinct(cols)`: ROW_NUMBER dedup, mirroring
    // `buildIncludeChildRowsSelect`'s distinct lowering. The ranking
    // orderBy feeds the OVER clause so dedup picks the right
    // representative; the reapplied orderBy below sequences the
    // surviving rows for LIMIT / OFFSET.
    const rankedAlias = `${include.relationName}__scalar_distinct`;
    inner = wrapWithRowNumberDedup({
      base: inner,
      distinctColumnRefs: state.distinct.map((column) => ColumnRef.of(childTableRef, column)),
      rankingOrderBy: remappedOrderBy ?? [],
      rankedAlias,
    });
    if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
      inner = inner.withOrderBy(
        remappedOrderBy.map(
          (item, index) =>
            new OrderByItem(
              ColumnRef.of(rankedAlias, `${include.relationName}__order_${index}`),
              item.dir,
            ),
        ),
      );
    }
  } else if (remappedOrderBy !== undefined && remappedOrderBy.length > 0) {
    inner = inner.withOrderBy(remappedOrderBy);
  }

  if (state.limit !== undefined) {
    inner = inner.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    inner = inner.withOffset(state.offset);
  }

  // Outer aggregating SELECT over the shaped inner row set.
  const outerAggregateExpr = buildIncludeAggregateExpr(scalar, innerAlias);
  const outerJsonObjectExpr = JsonObjectExpr.fromEntries([
    JsonObjectExpr.entry('value', outerAggregateExpr),
  ]);

  return SelectAst.from(DerivedTableSource.as(innerAlias, inner)).withProjection([
    ProjectionItem.of(include.relationName, outerJsonObjectExpr),
  ]);
}

function buildIncludeAggregateExpr(
  scalar: IncludeScalar<unknown>,
  childTableRef: string,
): AggregateExpr {
  if (scalar.fn === 'count') {
    return AggregateExpr.count();
  }
  if (scalar.column === undefined) {
    throw new Error(`Aggregate selector "${scalar.fn}" requires a column`);
  }
  const columnRef = ColumnRef.of(childTableRef, scalar.column);
  switch (scalar.fn) {
    case 'sum':
      return AggregateExpr.sum(columnRef);
    case 'avg':
      return AggregateExpr.avg(columnRef);
    case 'min':
      return AggregateExpr.min(columnRef);
    case 'max':
      return AggregateExpr.max(columnRef);
    default:
      throw new Error(`Unsupported aggregate selector: ${scalar.fn satisfies never}`);
  }
}

/**
 * Build the inner SELECT for a `combine({ a, b, ... })` include.
 *
 * Each branch produces a self-contained SELECT projecting one row
 * with one column aliased to the relation name. The branches are
 * stitched together as cross-joined derived tables (FROM <first>
 * INNER JOIN <second> ON TRUE ...), and the outer projection packs
 * them into a single `json_build_object` keyed by branch name. The
 * resulting subquery emits exactly one row per parent row containing
 * the combined JSON — embedded as a correlated subquery in the outer
 * projection.
 *
 * Row branches reuse the standalone row-include builder; scalar
 * branches reuse `buildIncludeChildScalarSelect` — the `{value: ...}`
 * envelope survives into the combined JSON and the decoder unwraps
 * it per scalar branch. Distinct/take/skip semantics inside a row
 * branch fan out naturally because the row builder is invoked with
 * a synthetic IncludeExpr whose `nested` is the branch's state.
 */
function buildIncludeChildCombineSelect(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  branches: Readonly<Record<string, IncludeCombineBranch>>,
): SelectAst {
  const branchEntries = Object.entries(branches);
  if (branchEntries.length === 0) {
    throw new Error(`combine() include "${include.relationName}" has no branches`);
  }

  const compiledBranches = branchEntries.map(([name, branch]) => ({
    name,
    alias: `${include.relationName}__combine__${name}`,
    select: buildIncludeChildCombineBranchSelect(contract, parentTableName, include, branch),
  }));

  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    compiledBranches.map((branch) =>
      JsonObjectExpr.entry(branch.name, ColumnRef.of(branch.alias, include.relationName)),
    ),
  );

  const [firstBranch, ...restBranches] = compiledBranches;
  if (!firstBranch) {
    // Unreachable given the empty-branches guard above; keeps the
    // type-narrowing honest for the destructuring read below.
    throw new Error(`combine() include "${include.relationName}" has no branches`);
  }

  const joins = restBranches.map((branch) =>
    JoinAst.inner(DerivedTableSource.as(branch.alias, branch.select), AndExpr.true(), false),
  );

  return SelectAst.from(DerivedTableSource.as(firstBranch.alias, firstBranch.select))
    .withProjection([ProjectionItem.of(include.relationName, jsonObjectExpr)])
    .withJoins(joins);
}

/**
 * Compile one branch of a `combine({ ... })` into a SelectAst that
 * projects exactly one row with one column aliased to the parent
 * relation name. Dispatches to the standalone scalar / row builders
 * with the branch's state spliced into a synthetic IncludeExpr.
 */
function buildIncludeChildCombineBranchSelect(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  branch: IncludeCombineBranch,
): SelectAst {
  if (branch.kind === 'scalar') {
    return buildIncludeChildScalarSelect(contract, parentTableName, include, branch.selector);
  }
  // Row branch: synthesize an IncludeExpr whose `nested` is the
  // branch's state, then build the standard row-aggregate inner shape.
  const syntheticInclude: IncludeExpr = {
    ...include,
    nested: branch.state,
    scalar: undefined,
    combine: undefined,
  };
  return buildIncludeChildRowsAggregateSelect(contract, parentTableName, syntheticInclude);
}

/**
 * Internal helper: build the inner aggregate SELECT that `json_agg`s
 * child rows into a single JSON-array column aliased to the relation
 * name. Used by both the standalone row correlated-subquery path and
 * by combine's row branches.
 */
function buildIncludeChildRowsAggregateSelect(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
): SelectAst {
  const { childRows, childProjection, rowsAlias, aggregateOrderBy } = buildIncludeChildRowsSelect(
    contract,
    parentTableName,
    include,
  );
  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    childProjection.map((item) =>
      JsonObjectExpr.entry(item.alias, ColumnRef.of(rowsAlias, item.alias)),
    ),
  );
  return SelectAst.from(DerivedTableSource.as(rowsAlias, childRows)).withProjection([
    ProjectionItem.of(
      include.relationName,
      JsonArrayAggExpr.of(jsonObjectExpr, 'emptyArray', aggregateOrderBy),
    ),
  ]);
}

function buildCorrelatedIncludeProjection(
  contract: Contract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
): {
  readonly projection: ProjectionItem;
} {
  if (include.scalar) {
    const scalarSelect = buildIncludeChildScalarSelect(
      contract,
      parentTableName,
      include,
      include.scalar,
    );
    return {
      projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(scalarSelect)),
    };
  }

  if (include.combine) {
    const combineSelect = buildIncludeChildCombineSelect(
      contract,
      parentTableName,
      include,
      include.combine,
    );
    return {
      projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(combineSelect)),
    };
  }

  const aggregateQuery = buildIncludeChildRowsAggregateSelect(contract, parentTableName, include);
  return {
    projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(aggregateQuery)),
  };
}

function buildSelectAst(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  options: {
    readonly joins?: ReadonlyArray<JoinAst>;
    readonly includeProjection?: ReadonlyArray<ProjectionItem>;
    readonly where?: AnyExpression;
  } = {},
): SelectAst {
  const scalarProjection = buildProjection(contract, tableName, state.selectedFields);
  const projection = [...scalarProjection, ...(options.includeProjection ?? [])];
  const where = options.where ?? buildStateWhere(contract, tableName, state);

  // When `.distinct(cols)` is set, wrap the table source in a
  // ROW_NUMBER-based dedup subquery aliased to the original `tableName`.
  // That aliasing keeps every outer reference — the projection's
  // scalar columns, the MTI variant joins, the include subqueries'
  // parent correlations, the orderBy — resolving transparently,
  // without needing to rewrite column refs across the AST.
  //
  // We project every column of the underlying table so anything the
  // outer query may reference is in scope; the database can prune
  // unused columns. The original WHERE moves INTO the wrap (so
  // ROW_NUMBER computes over filtered rows), and the outer's WHERE
  // becomes just `__prisma_distinct_rn = 1`.
  const usesRowNumberDistinct = state.distinct !== undefined && state.distinct.length > 0;
  const fromSource: AnyFromSource = usesRowNumberDistinct
    ? DerivedTableSource.as(
        tableName,
        buildTopLevelDistinctRankedInner(contract, tableName, state, where),
      )
    : tableSourceForContract(contract, tableName);

  let ast = SelectAst.from(fromSource).withProjection(projection);
  if (usesRowNumberDistinct) {
    ast = ast.withWhere(
      BinaryExpr.eq(ColumnRef.of(tableName, '__prisma_distinct_rn'), LiteralExpr.of(1)),
    );
  } else if (where) {
    ast = ast.withWhere(where);
  }
  if (state.orderBy) {
    ast = ast.withOrderBy(state.orderBy);
  }
  if (state.selectedFields === undefined) {
    ast = ast.withSelectAllIntent({ table: tableName });
  }
  if (state.distinctOn && state.distinctOn.length > 0) {
    ast = ast.withDistinctOn(state.distinctOn.map((column) => ColumnRef.of(tableName, column)));
  }
  // `state.distinct` is handled via the `usesRowNumberDistinct` wrap
  // above; we do not apply SQL `DISTINCT` here.
  if (state.limit !== undefined) {
    ast = ast.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    ast = ast.withOffset(state.offset);
  }
  if (options.joins && options.joins.length > 0) {
    ast = ast.withJoins(options.joins);
  }

  return ast;
}

function buildTopLevelDistinctRankedInner(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  where: AnyExpression | undefined,
): SelectAst {
  const distinctColumns = state.distinct;
  if (distinctColumns === undefined || distinctColumns.length === 0) {
    throw new Error('buildTopLevelDistinctRankedInner called without `state.distinct`');
  }
  // Project every column of the underlying table so outer references
  // (projection, joins, includes' correlations, orderBy) resolve
  // through the derived-subquery alias.
  const allCols = resolveTableColumns(contract, tableName);
  const allColsProjection = allCols.map((column) =>
    ProjectionItem.of(column, ColumnRef.of(tableName, column)),
  );
  const distinctColumnRefs = distinctColumns.map((column) => ColumnRef.of(tableName, column));
  const rankingOrderBy =
    state.orderBy && state.orderBy.length > 0
      ? state.orderBy
      : distinctColumnRefs.map((expr) => OrderByItem.asc(expr));

  let inner = SelectAst.from(tableSourceForContract(contract, tableName)).withProjection([
    ...allColsProjection,
    ProjectionItem.of(
      '__prisma_distinct_rn',
      WindowFuncExpr.rowNumber({
        partitionBy: distinctColumnRefs,
        orderBy: rankingOrderBy,
      }),
    ),
  ]);
  if (where) {
    inner = inner.withWhere(where);
  }
  return inner;
}

function buildMtiJoins(
  contract: Contract<SqlStorage>,
  polyInfo: PolymorphismInfo,
  variantName: string | undefined,
): { joins: JoinAst[]; projection: ProjectionItem[] } {
  const joins: JoinAst[] = [];
  const projection: ProjectionItem[] = [];
  const pkColumn = resolvePrimaryKeyColumn(contract, polyInfo.baseTable);

  const variantsToJoin = variantName
    ? polyInfo.mtiVariants.filter((v) => v.modelName === variantName)
    : polyInfo.mtiVariants;

  for (const variant of variantsToJoin) {
    const joinType = variantName ? 'inner' : 'left';
    const joinOn = EqColJoinOn.of(
      ColumnRef.of(polyInfo.baseTable, pkColumn),
      ColumnRef.of(variant.table, pkColumn),
    );
    const join =
      joinType === 'inner'
        ? JoinAst.inner(tableSourceForContract(contract, variant.table), joinOn)
        : JoinAst.left(tableSourceForContract(contract, variant.table), joinOn);
    joins.push(join);

    const variantColumns = resolveTableColumns(contract, variant.table);
    for (const col of variantColumns) {
      if (col === pkColumn) continue;
      const alias = `${variant.table}__${col}`;
      projection.push(
        ProjectionItem.of(
          alias,
          ColumnRef.of(variant.table, col),
          codecRefForStorageColumn(contract.storage, variant.table, col),
        ),
      );
    }
  }

  return { joins, projection };
}

export function compileSelect(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  modelName?: string,
): SqlQueryPlan<Record<string, unknown>> {
  const polyInfo = modelName ? resolvePolymorphismInfo(contract, modelName) : undefined;
  const mtiArtifacts =
    polyInfo && polyInfo.mtiVariants.length > 0
      ? buildMtiJoins(contract, polyInfo, state.variantName)
      : undefined;

  const ast = buildSelectAst(
    contract,
    tableName,
    { ...state, includes: [] },
    mtiArtifacts
      ? {
          joins: mtiArtifacts.joins,
          includeProjection: mtiArtifacts.projection,
        }
      : undefined,
  );

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, state.annotations);
}

export function compileSelectWithIncludes(
  contract: Contract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  modelName?: string,
): SqlQueryPlan<Record<string, unknown>> {
  const includeJoins: JoinAst[] = [];
  const includeProjection: ProjectionItem[] = [];
  const topLevelWhere = buildStateWhere(contract, tableName, state);

  const polyInfo = modelName ? resolvePolymorphismInfo(contract, modelName) : undefined;
  if (polyInfo && polyInfo.mtiVariants.length > 0) {
    const mtiArtifacts = buildMtiJoins(contract, polyInfo, state.variantName);
    includeJoins.push(...mtiArtifacts.joins);
    includeProjection.push(...mtiArtifacts.projection);
  }

  for (const include of state.includes) {
    const artifact = buildCorrelatedIncludeProjection(contract, tableName, include);
    includeProjection.push(artifact.projection);
  }

  const ast = buildSelectAst(
    contract,
    tableName,
    {
      ...state,
      includes: [],
    },
    {
      joins: includeJoins,
      includeProjection,
      ...ifDefined('where', topLevelWhere),
    },
  );

  const { params } = deriveParamsFromAst(ast);
  return buildOrmQueryPlan(contract, ast, params, state.annotations);
}
