import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryOp,
  BoundWhereExpr,
  Expression,
  JoinAst,
  ProjectionItem,
  SelectAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAndExpr,
  createBinaryExpr,
  createColumnRef,
  createDerivedTableSource,
  createJoin,
  createJsonAggExpr,
  createJsonBuildObjectExpr,
  createLiteralExpr,
  createLiteralListFromValues,
  createOrderByItem,
  createOrExpr,
  createProjectionItem,
  createSelectAstBuilder,
  createSubqueryExpr,
  createTableSource,
  createTrueExpr,
  mapExpressionDeep,
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

  return columns.map((column) => createProjectionItem(column, createColumnRef(tableRef, column)));
}

function toOrderBy(
  tableName: string,
  orderBy: readonly OrderExpr[] | undefined,
): ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined {
  if (!orderBy || orderBy.length === 0) {
    return undefined;
  }

  return orderBy.map((entry) =>
    createOrderByItem(createColumnRef(tableName, entry.column), entry.direction),
  );
}

function createBoundaryExpr(tableName: string, entry: CursorOrderEntry): WhereExpr {
  const comparator: BinaryOp = entry.direction === 'asc' ? 'gt' : 'lt';
  return createBinaryExpr(
    comparator,
    createColumnRef(tableName, entry.column),
    createLiteralExpr(entry.value),
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
        createBinaryExpr(
          'eq',
          createColumnRef(tableName, prefixEntry.column),
          createLiteralExpr(prefixEntry.value),
        ),
      );
    }

    branchExprs.push(createBoundaryExpr(tableName, entry));
    if (branchExprs.length === 1) {
      return branchExprs[0] as WhereExpr;
    }

    return createAndExpr(branchExprs);
  });

  if (branches.length === 1) {
    return branches[0] as WhereExpr;
  }

  return createOrExpr(branches);
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

function createTableRefRemapper(fromTable: string, toTable: string) {
  return mapExpressionDeep({
    col: (col) => (col.table === fromTable ? createColumnRef(toTable, col.column) : col),
    tableSource: (source) => {
      if (source.alias === fromTable) return createTableSource(source.name, toTable);
      if (!source.alias && source.name === fromTable)
        return createTableSource(source.name, toTable);
      return source;
    },
    joinOnEqCol: (on) => ({
      ...on,
      left: on.left.table === fromTable ? createColumnRef(toTable, on.left.column) : on.left,
      right: on.right.table === fromTable ? createColumnRef(toTable, on.right.column) : on.right,
    }),
  });
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
          expr: createTableRefRemapper(filterTableName, tableName).where(filter.expr),
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
  readonly childOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
  readonly hiddenOrderProjection: ReadonlyArray<ProjectionItem>;
  readonly aggregateOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
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
    createProjectionItem(`${relationName}__order_${index}`, orderItem.expr),
  );
  const aggregateOrderBy = hiddenOrderProjection.map((projection, index) => {
    const orderItem = childOrderBy[index];
    if (!orderItem) {
      throw new Error(`Missing include order metadata at index ${index}`);
    }
    return createOrderByItem(createColumnRef(rowAlias, projection.alias), orderItem.dir);
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
  readonly aggregateOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
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
  const joinExpr = createBinaryExpr(
    'eq',
    createColumnRef(childTableRef, include.fkColumn),
    createColumnRef(parentTableName, include.parentPkColumn),
  );
  const shiftedChildWhere =
    childWhere && paramOffset > 0 ? offsetBoundWhereExpr(childWhere, paramOffset) : childWhere;
  const whereExpr = shiftedChildWhere
    ? createAndExpr([joinExpr, shiftedChildWhere.expr])
    : joinExpr;

  const builder = createSelectAstBuilder(
    createTableSource(include.relatedTableName, childTableAlias),
  )
    .project([...childProjection, ...hiddenOrderProjection])
    .where(whereExpr);

  if (childOrderBy) {
    builder.orderBy(childOrderBy);
  }
  if (childState.distinctOn && childState.distinctOn.length > 0) {
    builder.distinctOn(
      childState.distinctOn.map((column) => createColumnRef(childTableRef, column)),
    );
  } else if (childState.distinct && childState.distinct.length > 0) {
    builder.distinct(true);
  }
  if (childState.limit !== undefined) {
    builder.limit(childState.limit);
  }
  if (childState.offset !== undefined) {
    builder.offset(childState.offset);
  }

  return {
    childRows: builder.build(),
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

  const aggregateQuery = createSelectAstBuilder(createDerivedTableSource(rowsAlias, childRows))
    .project([
      createProjectionItem(
        include.relationName,
        createJsonAggExpr(createJsonBuildObjectExpr(rowsAlias, childProjection), aggregateOrderBy),
      ),
    ])
    .build();

  return {
    join: createJoin(
      'left',
      createDerivedTableSource(lateralAlias, aggregateQuery),
      createTrueExpr(),
      true,
    ),
    projection: createProjectionItem(
      include.relationName,
      createColumnRef(lateralAlias, include.relationName),
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
  const aggregateQuery = createSelectAstBuilder(createDerivedTableSource(rowsAlias, childRows))
    .project([
      createProjectionItem(
        include.relationName,
        createJsonAggExpr(createJsonBuildObjectExpr(rowsAlias, childProjection), aggregateOrderBy),
      ),
    ])
    .build();

  return {
    projection: createProjectionItem(include.relationName, createSubqueryExpr(aggregateQuery)),
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

  const builder = createSelectAstBuilder(createTableSource(tableName)).project(projection);
  if (where) {
    builder.where(where.expr);
  }
  if (orderBy) {
    builder.orderBy(orderBy);
  }
  if (state.selectedFields === undefined) {
    builder.selectAllIntent({ table: tableName });
  }
  if (state.distinctOn && state.distinctOn.length > 0) {
    builder.distinctOn(state.distinctOn.map((column) => createColumnRef(tableName, column)));
  } else if (state.distinct && state.distinct.length > 0) {
    builder.distinct(true);
  }
  if (state.limit !== undefined) {
    builder.limit(state.limit);
  }
  if (state.offset !== undefined) {
    builder.offset(state.offset);
  }
  if (options.joins && options.joins.length > 0) {
    builder.joins(options.joins);
  }

  return {
    ast: builder.build(),
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
  const inFilter: WhereExpr = createBinaryExpr(
    'in',
    createColumnRef(relatedTableName, fkColumn),
    createLiteralListFromValues(parentPks),
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
