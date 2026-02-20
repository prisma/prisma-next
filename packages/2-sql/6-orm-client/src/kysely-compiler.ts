import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import type {
  Expression as AstExpression,
  BinaryExpr,
  JoinAst,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  SelectAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import {
  type CompiledQuery,
  DummyDriver,
  type ExpressionBuilder,
  Kysely,
  type OperandExpression,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type SelectQueryBuilder,
  type SqlBool,
  sql,
} from 'kysely';
import type { CollectionState, OrderExpr } from './types';

type AnyDB = Record<string, Record<string, unknown>>;
type AnySelectQueryBuilder = SelectQueryBuilder<AnyDB, string, Record<string, unknown>>;
type SqlComparable = AstExpression | ParamRef | LiteralExpr | ListLiteralExpr;
type SqlPredicate = OperandExpression<SqlBool>;
type SqlValueExpression = OperandExpression<unknown>;
type CursorOrderEntry = OrderExpr & {
  readonly value: unknown;
};

const queryCompiler = new Kysely<AnyDB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

const comparisonOpToSql: Record<BinaryExpr['op'], string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
  like: 'like',
  ilike: 'ilike',
  in: 'in',
  notIn: 'not in',
};

export function compileSelect(tableName: string, state: CollectionState): CompiledQuery {
  let qb = queryCompiler.selectFrom(tableName);
  qb = applyDistinct(qb, tableName, state.distinct, state.distinctOn);
  qb = applyProjection(qb, tableName, state.selectedFields);
  qb = applyWhereFilters(qb, state.filters);
  qb = applyCursorPagination(qb, tableName, state.orderBy, state.cursor);

  if (state.orderBy) {
    for (const o of state.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  if (state.limit !== undefined) {
    qb = qb.limit(state.limit);
  }

  if (state.offset !== undefined) {
    qb = qb.offset(state.offset);
  }

  return qb.compile();
}

export function compileRelationSelect(
  relatedTableName: string,
  fkColumn: string,
  parentPks: readonly unknown[],
  nestedState: CollectionState,
): CompiledQuery {
  let qb = queryCompiler.selectFrom(relatedTableName).where(fkColumn, 'in', [...parentPks]);
  qb = applyDistinct(qb, relatedTableName, nestedState.distinct, nestedState.distinctOn);
  qb = applyProjection(qb, relatedTableName, nestedState.selectedFields);
  qb = applyWhereFilters(qb, nestedState.filters);
  qb = applyCursorPagination(qb, relatedTableName, nestedState.orderBy, nestedState.cursor);

  if (nestedState.orderBy) {
    for (const o of nestedState.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  return qb.compile();
}

export function compileInsertReturning(
  tableName: string,
  values: readonly Record<string, unknown>[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const qb = queryCompiler.insertInto(tableName).values(values);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileInsertCount(
  tableName: string,
  values: readonly Record<string, unknown>[],
): CompiledQuery {
  return queryCompiler.insertInto(tableName).values(values).compile();
}

export function compileUpdateReturning(
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);

  if (whereExpr) {
    const qb = queryCompiler
      .updateTable(tableName)
      .set(setValues)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr));

    if (returningColumns && returningColumns.length > 0) {
      return qb.returning(returningColumns).compile();
    }

    return qb.returningAll().compile();
  }

  const qb = queryCompiler.updateTable(tableName).set(setValues);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileUpdateCount(
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    return queryCompiler
      .updateTable(tableName)
      .set(setValues)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr))
      .compile();
  }

  return queryCompiler.updateTable(tableName).set(setValues).compile();
}

export function compileDeleteReturning(
  tableName: string,
  filters: readonly WhereExpr[],
  returningColumns: readonly string[] | undefined,
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);

  if (whereExpr) {
    const qb = queryCompiler
      .deleteFrom(tableName)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr));

    if (returningColumns && returningColumns.length > 0) {
      return qb.returning(returningColumns).compile();
    }

    return qb.returningAll().compile();
  }

  const qb = queryCompiler.deleteFrom(tableName);

  if (returningColumns && returningColumns.length > 0) {
    return qb.returning(returningColumns).compile();
  }

  return qb.returningAll().compile();
}

export function compileDeleteCount(
  tableName: string,
  filters: readonly WhereExpr[],
): CompiledQuery {
  const whereExpr = combineWhereFilters(filters);
  if (whereExpr) {
    return queryCompiler
      .deleteFrom(tableName)
      .where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr))
      .compile();
  }

  return queryCompiler.deleteFrom(tableName).compile();
}

export function createExecutionPlan<Row>(
  compiled: CompiledQuery,
  contract: ContractBase,
): ExecutionPlan<Row> {
  return {
    sql: compiled.sql,
    params: [...compiled.parameters],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storageHash,
      lane: 'orm-client',
      paramDescriptors: [],
    },
  };
}

function applyWhereFilters<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  filters: readonly WhereExpr[],
): QueryBuilder {
  const whereExpr = combineWhereFilters(filters);
  if (!whereExpr) {
    return qb;
  }

  return qb.where((eb) =>
    whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr),
  ) as QueryBuilder;
}

function combineWhereFilters(filters: readonly WhereExpr[]): WhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const firstFilter = filters[0];
  if (filters.length === 1 && firstFilter !== undefined) {
    return firstFilter;
  }

  return { kind: 'and', exprs: [...filters] };
}

function applyProjection<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  selectedFields: readonly string[] | undefined,
): QueryBuilder {
  if (!selectedFields || selectedFields.length === 0) {
    return qb.selectAll() as QueryBuilder;
  }

  const qualified = selectedFields.map((column) => `${tableName}.${column}`);
  return qb.select(qualified) as QueryBuilder;
}

function applyDistinct<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  distinct: readonly string[] | undefined,
  distinctOn: readonly string[] | undefined,
): QueryBuilder {
  if (distinctOn && distinctOn.length > 0) {
    const qualified = distinctOn.map((column) => `${tableName}.${column}`);
    return qb.distinctOn(qualified) as QueryBuilder;
  }

  if (distinct && distinct.length > 0) {
    return qb.distinct() as QueryBuilder;
  }

  return qb;
}

function applyCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  orderBy: readonly OrderExpr[] | undefined,
  cursor: Readonly<Record<string, unknown>> | undefined,
): QueryBuilder {
  if (!cursor || !orderBy || orderBy.length === 0) {
    return qb;
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
    return applySingleCursorPagination(qb, tableName, firstEntry);
  }

  const firstDirection = entries[0]?.direction;
  const isUniformDirection =
    firstDirection !== undefined && entries.every((entry) => entry.direction === firstDirection);

  if (isUniformDirection) {
    return applyTupleCursorPagination(qb, tableName, entries, firstDirection === 'asc' ? '>' : '<');
  }

  return applyLexicographicCursorPagination(qb, tableName, entries);
}

function applySingleCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  cursor: CursorOrderEntry,
): QueryBuilder {
  const comparator = cursor.direction === 'asc' ? '>' : '<';
  const columnRef = sql.ref(`${tableName}.${cursor.column}`);
  const cursorValue = sql`${cursor.value}`;
  return qb.where(sql<SqlBool>`${columnRef} ${sql.raw(comparator)} ${cursorValue}`) as QueryBuilder;
}

function applyTupleCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  entries: readonly CursorOrderEntry[],
  comparator: '>' | '<',
): QueryBuilder {
  const tupleColumns = sql.join(entries.map((entry) => sql.ref(`${tableName}.${entry.column}`)));
  const tupleValues = sql.join(entries.map((entry) => sql`${entry.value}`));
  return qb.where(
    sql<SqlBool>`(${tupleColumns}) ${sql.raw(comparator)} (${tupleValues})`,
  ) as QueryBuilder;
}

function applyLexicographicCursorPagination<QueryBuilder extends AnySelectQueryBuilder>(
  qb: QueryBuilder,
  tableName: string,
  entries: readonly CursorOrderEntry[],
): QueryBuilder {
  const branches = entries.map((entry, index) => {
    const equalities = entries.slice(0, index).map((prefixEntry) => {
      const columnRef = sql.ref(`${tableName}.${prefixEntry.column}`);
      return sql<SqlBool>`${columnRef} = ${sql`${prefixEntry.value}`}`;
    });

    const comparator = entry.direction === 'asc' ? '>' : '<';
    const boundary = sql<SqlBool>`${sql.ref(`${tableName}.${entry.column}`)} ${sql.raw(comparator)} ${sql`${entry.value}`}`;

    if (equalities.length === 0) {
      return boundary;
    }

    return sql<SqlBool>`(${sql.join([...equalities, boundary], sql` and `)})`;
  });

  return qb.where(sql<SqlBool>`${sql.join(branches, sql` or `)}`) as QueryBuilder;
}

function whereExprToKysely(eb: ExpressionBuilder<AnyDB, string>, expr: WhereExpr): SqlPredicate {
  switch (expr.kind) {
    case 'bin':
      return binaryExprToKysely(expr);
    case 'nullCheck':
      return nullCheckExprToKysely(expr.expr, expr.isNull);
    case 'and':
      return eb.and(expr.exprs.map((child) => whereExprToKysely(eb, child)));
    case 'or':
      return eb.or(expr.exprs.map((child) => whereExprToKysely(eb, child)));
    case 'exists':
      return existsExprToKysely(expr.subquery, expr.not);
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function binaryExprToKysely(expr: BinaryExpr): SqlPredicate {
  const left = astExpressionToKysely(expr.left);

  if (expr.op === 'in' || expr.op === 'notIn') {
    const listValues = toListValues(expr.right);
    const listSql = sql.join(listValues.map((item) => sqlComparableToKysely(item)));
    return expr.op === 'in'
      ? sql<SqlBool>`${left} in (${listSql})`
      : sql<SqlBool>`${left} not in (${listSql})`;
  }

  if (expr.right.kind === 'listLiteral') {
    throw new Error(`Operator "${expr.op}" does not support list literals`);
  }

  const right = sqlComparableToKysely(expr.right);
  const op = comparisonOpToSql[expr.op];
  return sql<SqlBool>`${left} ${sql.raw(op)} ${right}`;
}

function nullCheckExprToKysely(expr: AstExpression, isNull: boolean): SqlPredicate {
  const operand = astExpressionToKysely(expr);
  return isNull ? sql<SqlBool>`${operand} is null` : sql<SqlBool>`${operand} is not null`;
}

function existsExprToKysely(subquery: SelectAst, not: boolean): SqlPredicate {
  const existsSql = sql<SqlBool>`exists (${buildSelectQuery(subquery)})`;
  return not ? sql<SqlBool>`not (${existsSql})` : existsSql;
}

function buildSelectQuery(ast: SelectAst): AnySelectQueryBuilder {
  let qb = queryCompiler.selectFrom(ast.from.name);

  for (const join of ast.joins ?? []) {
    qb = applyJoin(qb, join);
  }

  const projectSql = ast.project.map((projection, index) => {
    const expr = projection.expr;

    if (expr.kind === 'includeRef') {
      throw new Error(
        `Include refs are not supported inside EXISTS subqueries (alias "${projection.alias}")`,
      );
    }

    const projected =
      expr.kind === 'literal' ? sql`${expr.value}` : sql`${astExpressionToKysely(expr)}`;
    return projected.as(projection.alias || `_p${index}`);
  });

  qb = qb.select(projectSql.length > 0 ? projectSql : [sql`1`.as('_exists')]);

  const astWhere = ast.where;
  if (astWhere !== undefined) {
    qb = qb.where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, astWhere));
  }

  if (ast.orderBy) {
    for (const order of ast.orderBy) {
      if (order.expr.kind !== 'col') {
        throw new Error('Operation expressions are not supported in subquery orderBy clauses');
      }
      qb = qb.orderBy(`${order.expr.table}.${order.expr.column}`, order.dir);
    }
  }

  if (ast.limit !== undefined) {
    qb = qb.limit(ast.limit);
  }

  return qb as AnySelectQueryBuilder;
}

function applyJoin(qb: AnySelectQueryBuilder, join: JoinAst): AnySelectQueryBuilder {
  const left = `${join.on.left.table}.${join.on.left.column}`;
  const right = `${join.on.right.table}.${join.on.right.column}`;

  switch (join.joinType) {
    case 'inner':
      return qb.innerJoin(join.table.name, left, right) as AnySelectQueryBuilder;
    case 'left':
      return qb.leftJoin(join.table.name, left, right) as AnySelectQueryBuilder;
    case 'right':
      return qb.rightJoin(join.table.name, left, right) as AnySelectQueryBuilder;
    case 'full':
      return qb.fullJoin(join.table.name, left, right) as AnySelectQueryBuilder;
    default: {
      const neverJoinType: never = join.joinType;
      throw new Error(`Unsupported join type: ${String(neverJoinType)}`);
    }
  }
}

function astExpressionToKysely(expr: AstExpression): SqlValueExpression {
  switch (expr.kind) {
    case 'col':
      return sql.ref(`${expr.table}.${expr.column}`);
    case 'operation':
      throw new Error('Operation expressions are not yet supported in orm-client filters');
    default: {
      const neverExpression: never = expr;
      throw new Error(`Unsupported expression kind: ${String(neverExpression)}`);
    }
  }
}

function sqlComparableToKysely(value: Exclude<SqlComparable, ListLiteralExpr>): SqlValueExpression {
  switch (value.kind) {
    case 'col':
    case 'operation':
      return astExpressionToKysely(value);
    case 'literal':
      return sql`${value.value}`;
    case 'param':
      throw new Error(
        `ParamRef "${value.name ?? value.index}" is not supported by orm-client filter compilation`,
      );
    default: {
      const neverValue: never = value;
      throw new Error(`Unsupported SQL comparable kind: ${String(neverValue)}`);
    }
  }
}

function toListValues(right: SqlComparable): ReadonlyArray<AstExpression | ParamRef | LiteralExpr> {
  if (right.kind === 'listLiteral') {
    return right.values;
  }

  if (right.kind === 'literal' && Array.isArray(right.value)) {
    return right.value.map(
      (item): LiteralExpr => ({
        kind: 'literal',
        value: item,
      }),
    );
  }

  return [right];
}
