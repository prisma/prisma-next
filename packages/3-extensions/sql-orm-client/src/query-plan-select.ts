import type {
  BinaryOp,
  Expression,
  FromSource,
  JoinAst,
  JoinOnExpr,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  createAndExpr,
  createBinaryExpr,
  createColumnRef,
  createDerivedTableSource,
  createJsonArrayAggExpr,
  createJsonObjectEntry,
  createJsonObjectExpr,
  createJoin,
  createListLiteralExpr,
  createLiteralExpr,
  createOrExpr,
  createOrderByItem,
  createProjectionItem,
  createSelectAstBuilder,
  createSubqueryExpr,
  createTableSource,
  createTrueExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { ifDefined } from '@prisma-next/utils/defined';
import { buildOrmQueryPlan } from './query-plan-meta';
import type { CollectionState, IncludeExpr, OrderExpr } from './types';
import { combineWhereFilters } from './where-utils';

type CursorOrderEntry = OrderExpr & {
  readonly value: unknown;
};

function resolveTableColumns(contract: SqlContract<SqlStorage>, tableName: string): string[] {
  const table = contract.storage.tables[tableName];
  if (!table) {
    throw new Error(`Unknown table "${tableName}" in SQL ORM query planner`);
  }
  return Object.keys(table.columns);
}

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

  return orderBy.map((entry) => createOrderByItem(createColumnRef(tableName, entry.column), entry.direction));
}

function createBoundaryExpr(tableName: string, entry: CursorOrderEntry): WhereExpr {
  const comparator: BinaryOp = entry.direction === 'asc' ? 'gt' : 'lt';
  return createBinaryExpr(comparator, createColumnRef(tableName, entry.column), createLiteralExpr(entry.value));
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

function remapFromSourceTableRefs(
  source: FromSource,
  fromTable: string,
  toTable: string,
): FromSource {
  if (source.kind === 'table') {
    if (source.alias === fromTable) {
      return createTableSource(source.name, toTable);
    }
    if (!source.alias && source.name === fromTable) {
      return createTableSource(source.name, toTable);
    }
    return source;
  }
  return {
    ...source,
    query: remapSelectTableRefs(source.query, fromTable, toTable),
  };
}

function remapJoinOnTableRefs(
  joinOn: JoinOnExpr,
  fromTable: string,
  toTable: string,
): JoinOnExpr {
  if (joinOn.kind === 'eqCol') {
    return {
      ...joinOn,
      left: joinOn.left.table === fromTable ? createColumnRef(toTable, joinOn.left.column) : joinOn.left,
      right:
        joinOn.right.table === fromTable
          ? createColumnRef(toTable, joinOn.right.column)
          : joinOn.right,
    };
  }
  return remapWhereTableRefs(joinOn, fromTable, toTable);
}

function remapSelectTableRefs(
  ast: SelectAst,
  fromTable: string,
  toTable: string,
): SelectAst {
  const joins = ast.joins?.map((join) => ({
    ...join,
    source: remapFromSourceTableRefs(join.source, fromTable, toTable),
    on: remapJoinOnTableRefs(join.on, fromTable, toTable),
  }));
  const where = ast.where ? remapWhereTableRefs(ast.where, fromTable, toTable) : undefined;
  const orderBy = ast.orderBy?.map((orderBy) => ({
    ...orderBy,
    expr: remapExpressionTableRefs(orderBy.expr, fromTable, toTable),
  }));
  const distinctOn = ast.distinctOn?.map((expr) => remapExpressionTableRefs(expr, fromTable, toTable));
  const groupBy = ast.groupBy?.map((expr) => remapExpressionTableRefs(expr, fromTable, toTable));
  const having = ast.having ? remapWhereTableRefs(ast.having, fromTable, toTable) : undefined;

  return {
    kind: ast.kind,
    from: remapFromSourceTableRefs(ast.from, fromTable, toTable),
    project: ast.project.map((item) => ({
      ...item,
      expr:
        item.expr.kind === 'literal'
          ? item.expr
          : remapExpressionTableRefs(item.expr, fromTable, toTable),
    })),
    ...ifDefined('joins', joins),
    ...ifDefined('where', where),
    ...ifDefined('orderBy', orderBy),
    ...ifDefined('distinct', ast.distinct),
    ...ifDefined('distinctOn', distinctOn),
    ...ifDefined('groupBy', groupBy),
    ...ifDefined('having', having),
    ...ifDefined('limit', ast.limit),
    ...ifDefined('offset', ast.offset),
    ...ifDefined('selectAllIntent', ast.selectAllIntent),
  };
}

function remapExpressionTableRefs(
  expr: Expression,
  fromTable: string,
  toTable: string,
): Expression {
  switch (expr.kind) {
    case 'col':
      return expr.table === fromTable ? createColumnRef(toTable, expr.column) : expr;
    case 'operation':
      return {
        ...expr,
        self: remapExpressionTableRefs(expr.self, fromTable, toTable),
        args: expr.args.map((arg) => {
          if (arg.kind === 'literal' || arg.kind === 'param') {
            return arg;
          }
          return remapExpressionTableRefs(arg, fromTable, toTable);
        }),
      };
    case 'subquery':
      return {
        ...expr,
        query: remapSelectTableRefs(expr.query, fromTable, toTable),
      };
    case 'aggregate':
      return expr.expr
        ? {
            ...expr,
            expr: remapExpressionTableRefs(expr.expr, fromTable, toTable),
          }
        : expr;
    case 'jsonArrayAgg':
      return {
        ...expr,
        expr: remapExpressionTableRefs(expr.expr, fromTable, toTable),
        ...(expr.orderBy
          ? {
              orderBy: expr.orderBy.map((order) => ({
                ...order,
                expr: remapExpressionTableRefs(order.expr, fromTable, toTable),
              })),
            }
          : {}),
      };
    case 'jsonObject':
      return {
        ...expr,
        entries: expr.entries.map((entry) => ({
          ...entry,
          value:
            entry.value.kind === 'literal'
              ? entry.value
              : remapExpressionTableRefs(entry.value, fromTable, toTable),
        })),
      };
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported expression kind: ${String(neverExpr)}`);
    }
  }
}

function remapComparableTableRefs(
  value: Expression | ParamRef | ListLiteralExpr | LiteralExpr,
  fromTable: string,
  toTable: string,
): Expression | ParamRef | ListLiteralExpr | LiteralExpr {
  if (value.kind === 'param' || value.kind === 'literal') {
    return value;
  }
  if (value.kind === 'listLiteral') {
    return value;
  }
  return remapExpressionTableRefs(value, fromTable, toTable);
}

function remapWhereTableRefs(
  expr: WhereExpr,
  fromTable: string,
  toTable: string,
): WhereExpr {
  switch (expr.kind) {
    case 'bin':
      return {
        ...expr,
        left: remapExpressionTableRefs(expr.left, fromTable, toTable),
        right: remapComparableTableRefs(expr.right, fromTable, toTable),
      };
    case 'nullCheck':
      return {
        ...expr,
        expr: remapExpressionTableRefs(expr.expr, fromTable, toTable),
      };
    case 'and':
      return {
        ...expr,
        exprs: expr.exprs.map((nested) => remapWhereTableRefs(nested, fromTable, toTable)),
      };
    case 'or':
      return {
        ...expr,
        exprs: expr.exprs.map((nested) => remapWhereTableRefs(nested, fromTable, toTable)),
      };
    case 'exists':
      return {
        ...expr,
        subquery: remapSelectTableRefs(expr.subquery, fromTable, toTable),
      };
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function buildStateWhere(
  tableName: string,
  state: CollectionState,
  options?: {
    readonly filterTableName?: string;
  },
): WhereExpr | undefined {
  const cursorWhere = buildCursorWhere(tableName, state.orderBy, state.cursor);
  const filterTableName = options?.filterTableName;
  const remappedFilters =
    filterTableName && filterTableName !== tableName
      ? state.filters.map((filter) => remapWhereTableRefs(filter, filterTableName, tableName))
      : [...state.filters];
  const filters = cursorWhere ? [...remappedFilters, cursorWhere] : remappedFilters;
  return combineWhereFilters(filters);
}

function createJsonBuildObjectExpr(
  rowAlias: string,
  projectItems: ReadonlyArray<ProjectionItem>,
): Expression {
  if (projectItems.length === 0) {
    throw new Error('include child projection must contain at least one field');
  }

  return createJsonObjectExpr(
    projectItems.map((item) =>
      createJsonObjectEntry(item.alias, createColumnRef(rowAlias, item.alias)),
    ),
  );
}

function createJsonAggExpr(
  inputExpr: Expression,
  orderBy?: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }>,
): Expression {
  return createJsonArrayAggExpr(inputExpr, 'emptyArray', orderBy);
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
): {
  readonly childRows: SelectAst;
  readonly childProjection: ReadonlyArray<ProjectionItem>;
  readonly rowsAlias: string;
  readonly aggregateOrderBy: ReadonlyArray<{ expr: Expression; dir: 'asc' | 'desc' }> | undefined;
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
  const whereExpr = childWhere ? createAndExpr([joinExpr, childWhere]) : joinExpr;

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
  };
}

function buildLateralIncludeArtifacts(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
): {
  readonly join: JoinAst;
  readonly projection: ProjectionItem;
} {
  const { childRows, childProjection, rowsAlias, aggregateOrderBy } = buildIncludeChildRowsSelect(
    contract,
    parentTableName,
    include,
  );
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
  };
}

function buildCorrelatedIncludeProjection(
  contract: SqlContract<SqlStorage>,
  parentTableName: string,
  include: IncludeExpr,
): ProjectionItem {
  const { childRows, childProjection, rowsAlias, aggregateOrderBy } = buildIncludeChildRowsSelect(
    contract,
    parentTableName,
    include,
  );
  const aggregateQuery = createSelectAstBuilder(createDerivedTableSource(rowsAlias, childRows))
    .project([
      createProjectionItem(
        include.relationName,
        createJsonAggExpr(createJsonBuildObjectExpr(rowsAlias, childProjection), aggregateOrderBy),
      ),
    ])
    .build();

  return createProjectionItem(include.relationName, createSubqueryExpr(aggregateQuery));
}

function buildSelectAst(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  state: CollectionState,
  options: {
    readonly joins?: ReadonlyArray<JoinAst>;
    readonly includeProjection?: ReadonlyArray<ProjectionItem>;
  } = {},
): SelectAst {
  const scalarProjection = buildProjection(contract, tableName, state.selectedFields);
  const projection = [...scalarProjection, ...(options.includeProjection ?? [])];
  const whereExpr = buildStateWhere(tableName, state);
  const orderBy = toOrderBy(tableName, state.orderBy);

  const builder = createSelectAstBuilder(createTableSource(tableName)).project(projection);
  if (whereExpr) {
    builder.where(whereExpr);
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

  return builder.build();
}

export function compileSelect(
  contract: SqlContract<SqlStorage>,
  tableName: string,
  state: CollectionState,
): SqlQueryPlan<Record<string, unknown>> {
  const ast = buildSelectAst(contract, tableName, {
    ...state,
    includes: [],
  });

  return buildOrmQueryPlan(contract, ast, []);
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
    createListLiteralExpr(parentPks.map((value) => createLiteralExpr(value))),
  );

  return compileSelect(contract, relatedTableName, {
    ...nestedState,
    includes: [],
    limit: undefined,
    offset: undefined,
    filters: [inFilter, ...nestedState.filters],
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

  for (const include of state.includes) {
    if (strategy === 'lateral') {
      const artifact = buildLateralIncludeArtifacts(contract, tableName, include);
      includeJoins.push(artifact.join);
      includeProjection.push(artifact.projection);
      continue;
    }
    includeProjection.push(buildCorrelatedIncludeProjection(contract, tableName, include));
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
    },
  );

  return buildOrmQueryPlan(contract, ast, []);
}
