import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AstRewriter,
  BinaryExpr,
  type BinaryOp,
  type BoundWhereExpr,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  JsonArrayAggExpr,
  JsonObjectExpr,
  ListLiteralExpr,
  LiteralExpr,
  OrderByItem,
  OrExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import { buildOrmQueryPlan, resolveTableColumns } from './query-plan-meta';
import type { CollectionState, IncludeExpr, OrderExpr } from './types';
import { combineWhereFilters, createBoundWhereExpr, offsetBoundWhereExpr } from './where-utils';

type CursorOrderEntry = OrderExpr & {
  readonly value: unknown;
};

function buildProjection(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  selectedFields: readonly string[] | undefined,
  tableRef = tableName,
): ProjectionItem[] {
  const columns =
    selectedFields && selectedFields.length > 0
      ? [...selectedFields]
      : resolveTableColumns(contract, tableName);

  return columns.map((column) => ProjectionItem.of(column, ColumnRef.of(tableRef, column)));
}

function toOrderBy(
  tableName: string,
  orderBy: readonly OrderExpr[] | undefined,
): ReadonlyArray<OrderByItem> | undefined {
  if (!orderBy || orderBy.length === 0) {
    return undefined;
  }

  return orderBy.map(
    (entry) => new OrderByItem(ColumnRef.of(tableName, entry.column), entry.direction),
  );
}

function createBoundaryExpr(tableName: string, entry: CursorOrderEntry): WhereExpr {
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
): WhereExpr {
  const branches = entries.map((entry, index): WhereExpr => {
    const branchExprs: WhereExpr[] = [];

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
      return branchExprs[0] as WhereExpr;
    }

    return AndExpr.of(branchExprs);
  });

  if (branches.length === 1) {
    return branches[0] as WhereExpr;
  }

  return OrExpr.of(branches);
}

function buildCursorWhere(
  tableName: string,
  orderBy: readonly OrderExpr[] | undefined,
  cursor: Readonly<Record<string, unknown>> | undefined,
): WhereExpr | undefined {
  if (!cursor || !orderBy || orderBy.length === 0) {
    return undefined;
  }

  const entries: CursorOrderEntry[] = [];
  for (const order of orderBy) {
    const value = cursor[order.column];
    if (value === undefined) {
      throw new Error(`Missing cursor value for orderBy column "${order.column}"`);
    }
    entries.push({
      ...order,
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
      if (source.alias === fromTable) return TableSource.named(source.name, toTable);
      if (!source.alias && source.name === fromTable)
        return TableSource.named(source.name, toTable);
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
  tableName: string,
  state: CollectionState,
  options?: {
    readonly filterTableName?: string;
  },
): BoundWhereExpr | undefined {
  const cursorWhere = buildCursorWhere(tableName, state.orderBy, state.cursor);
  const filterTableName = options?.filterTableName;
  const remappedFilters =
    filterTableName && filterTableName !== tableName
      ? state.filters.map((filter) => ({
          ...filter,
          expr: filter.expr.rewrite(createTableRefRemapper(filterTableName, tableName)),
        }))
      : state.filters;
  const filters = cursorWhere
    ? [...remappedFilters, createBoundWhereExpr(cursorWhere)]
    : remappedFilters;
  return combineWhereFilters(filters);
}

function buildIncludeOrderArtifacts(
  relationName: string,
  childTableRef: string,
  rowAlias: string,
  orderBy: readonly OrderExpr[] | undefined,
): {
  readonly childOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
} {
  const childOrderBy = toOrderBy(childTableRef, orderBy);
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

function buildIncludeChildRowsSelect(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  paramOffset = 0,
): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<OrderByItem> | undefined;
  readonly params: readonly unknown[];
  readonly paramDescriptors: BoundWhereExpr['paramDescriptors'];
} {
  const childState = include.nested;
  const childTableAlias =
    include.relatedTableName === parentTableName ? `${include.relationName}__child` : undefined;
  const childTableRef = childTableAlias ?? include.relatedTableName;
  const rowsAlias = `${include.relationName}__rows`;
  const childProjection = buildProjection(
    contract,
    include.relatedTableName,
    childState.selectedFields,
    childTableRef,
  );
  const { childOrderBy, hiddenOrderProjection, aggregateOrderBy } = buildIncludeOrderArtifacts(
    include.relationName,
    childTableRef,
    rowsAlias,
    childState.orderBy,
  );
  const childWhere = buildStateWhere(childTableRef, childState, {
    filterTableName: include.relatedTableName,
  });
  const joinExpr = BinaryExpr.eq(
    ColumnRef.of(childTableRef, include.fkColumn),
    ColumnRef.of(parentTableName, include.parentPkColumn),
  );
  const shiftedChildWhere =
    childWhere && paramOffset > 0 ? offsetBoundWhereExpr(childWhere, paramOffset) : childWhere;
  const whereExpr = shiftedChildWhere ? AndExpr.of([joinExpr, shiftedChildWhere.expr]) : joinExpr;

  let childRows = SelectAst.from(TableSource.named(include.relatedTableName, childTableAlias))
    .withProject([...childProjection, ...hiddenOrderProjection])
    .withWhere(whereExpr);

  if (childOrderBy) {
    childRows = childRows.withOrderBy(childOrderBy);
  }
  if (childState.distinctOn && childState.distinctOn.length > 0) {
    childRows = childRows.withDistinctOn(
      childState.distinctOn.map((column) => ColumnRef.of(childTableRef, column)),
    );
  } else if (childState.distinct && childState.distinct.length > 0) {
    childRows = childRows.withDistinct(true);
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
    params: shiftedChildWhere?.params ?? [],
    paramDescriptors: shiftedChildWhere?.paramDescriptors ?? [],
  };
}

function buildLateralIncludeArtifacts(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  paramOffset = 0,
): {
  readonly join: JoinAst;
  readonly projection: ProjectionItem;
  readonly params: readonly unknown[];
  readonly paramDescriptors: BoundWhereExpr['paramDescriptors'];
} {
  const { childRows, childProjection, rowsAlias, aggregateOrderBy, params, paramDescriptors } =
    buildIncludeChildRowsSelect(contract, parentTableName, include, paramOffset);
  const lateralAlias = `${include.relationName}_lateral`;
  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    childProjection.map((item) =>
      JsonObjectExpr.entry(item.alias, ColumnRef.of(rowsAlias, item.alias)),
    ),
  );

  const aggregateQuery = SelectAst.from(DerivedTableSource.as(rowsAlias, childRows)).withProject([
    ProjectionItem.of(
      include.relationName,
      JsonArrayAggExpr.of(jsonObjectExpr, 'emptyArray', aggregateOrderBy),
    ),
  ]);

  return {
    join: JoinAst.left(DerivedTableSource.as(lateralAlias, aggregateQuery), AndExpr.true(), true),
    projection: ProjectionItem.of(
      include.relationName,
      ColumnRef.of(lateralAlias, include.relationName),
    ),
    params,
    paramDescriptors,
  };
}

function buildCorrelatedIncludeProjection(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
  paramOffset = 0,
): {
  readonly projection: ProjectionItem;
  readonly params: readonly unknown[];
  readonly paramDescriptors: BoundWhereExpr['paramDescriptors'];
} {
  const { childRows, childProjection, rowsAlias, aggregateOrderBy, params, paramDescriptors } =
    buildIncludeChildRowsSelect(contract, parentTableName, include, paramOffset);
  const jsonObjectExpr = JsonObjectExpr.fromEntries(
    childProjection.map((item) =>
      JsonObjectExpr.entry(item.alias, ColumnRef.of(rowsAlias, item.alias)),
    ),
  );
  const aggregateQuery = SelectAst.from(DerivedTableSource.as(rowsAlias, childRows)).withProject([
    ProjectionItem.of(
      include.relationName,
      JsonArrayAggExpr.of(jsonObjectExpr, 'emptyArray', aggregateOrderBy),
    ),
  ]);

  return {
    projection: ProjectionItem.of(include.relationName, SubqueryExpr.of(aggregateQuery)),
    params,
    paramDescriptors,
  };
}

function buildSelectAst(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  options: {
    readonly joins?: ReadonlyArray<JoinAst>;
    readonly includeProjection?: ReadonlyArray<ProjectionItem>;
    readonly extraParams?: readonly unknown[];
    readonly extraParamDescriptors?: BoundWhereExpr['paramDescriptors'];
    readonly where?: BoundWhereExpr;
  } = {},
): {
  readonly ast: SelectAst;
  readonly params: readonly unknown[];
  readonly paramDescriptors: BoundWhereExpr['paramDescriptors'];
} {
  const scalarProjection = buildProjection(contract, tableName, state.selectedFields);
  const projection = [...scalarProjection, ...(options.includeProjection ?? [])];
  const where = options.where ?? buildStateWhere(tableName, state);
  const orderBy = toOrderBy(tableName, state.orderBy);

  let ast = SelectAst.from(TableSource.named(tableName)).withProject(projection);
  if (where) {
    ast = ast.withWhere(where.expr);
  }
  if (orderBy) {
    ast = ast.withOrderBy(orderBy);
  }
  if (state.selectedFields === undefined) {
    ast = ast.withSelectAllIntent({ table: tableName });
  }
  if (state.distinctOn && state.distinctOn.length > 0) {
    ast = ast.withDistinctOn(state.distinctOn.map((column) => ColumnRef.of(tableName, column)));
  } else if (state.distinct && state.distinct.length > 0) {
    ast = ast.withDistinct(true);
  }
  if (state.limit !== undefined) {
    ast = ast.withLimit(state.limit);
  }
  if (state.offset !== undefined) {
    ast = ast.withOffset(state.offset);
  }
  if (options.joins && options.joins.length > 0) {
    ast = ast.withJoins(options.joins);
  }

  return {
    ast,
    params: [...(where?.params ?? []), ...(options.extraParams ?? [])],
    paramDescriptors: [
      ...(where?.paramDescriptors ?? []),
      ...(options.extraParamDescriptors ?? []),
    ],
  };
}

export function compileSelect(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  state: CollectionState,
): SqlQueryPlan<Record<string, unknown>> {
  const built = buildSelectAst(contract, tableName, {
    ...state,
    includes: [],
  });

  return buildOrmQueryPlan(contract, built.ast, built.params, built.paramDescriptors);
}

export function compileRelationSelect(
  contract: SqlContract<SqlStorage>,
  relatedTableName: string,
  fkColumn: string,
  parentPks: readonly unknown[],
  nestedState: CollectionState,
): SqlQueryPlan<Record<string, unknown>> {
  const inFilter: WhereExpr = BinaryExpr.in(
    ColumnRef.of(relatedTableName, fkColumn),
    ListLiteralExpr.fromValues(parentPks),
  );

  return compileSelect(contract, relatedTableName, {
    ...nestedState,
    includes: [],
    limit: undefined,
    offset: undefined,
    filters: [createBoundWhereExpr(inFilter), ...nestedState.filters],
  });
}

export function compileSelectWithIncludeStrategy(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  strategy: 'lateral' | 'correlated',
): SqlQueryPlan<Record<string, unknown>> {
  if (
    state.includes.some((include) => include.scalar !== undefined || include.combine !== undefined)
  ) {
    throw new Error(
      'single-query include strategy does not support scalar include selectors or combine()',
    );
  }

  const includeJoins: JoinAst[] = [];
  const includeProjection: ProjectionItem[] = [];
  const topLevelWhere = buildStateWhere(tableName, state);
  const includeParams: unknown[] = [];
  const includeParamDescriptors: Array<BoundWhereExpr['paramDescriptors'][number]> = [];
  let nextParamOffset = topLevelWhere?.params.length ?? 0;

  for (const include of state.includes) {
    if (strategy === 'lateral') {
      const artifact = buildLateralIncludeArtifacts(contract, tableName, include, nextParamOffset);
      includeJoins.push(artifact.join);
      includeProjection.push(artifact.projection);
      includeParams.push(...artifact.params);
      includeParamDescriptors.push(...artifact.paramDescriptors);
      nextParamOffset += artifact.params.length;
      continue;
    }
    const artifact = buildCorrelatedIncludeProjection(
      contract,
      tableName,
      include,
      nextParamOffset,
    );
    includeProjection.push(artifact.projection);
    includeParams.push(...artifact.params);
    includeParamDescriptors.push(...artifact.paramDescriptors);
    nextParamOffset += artifact.params.length;
  }

  const built = buildSelectAst(
    contract,
    tableName,
    {
      ...state,
      includes: [],
    },
    {
      joins: includeJoins,
      includeProjection,
      extraParams: includeParams,
      extraParamDescriptors: includeParamDescriptors,
      ...(topLevelWhere ? { where: topLevelWhere } : {}),
    },
  );

  return buildOrmQueryPlan(contract, built.ast, built.params, built.paramDescriptors);
}
