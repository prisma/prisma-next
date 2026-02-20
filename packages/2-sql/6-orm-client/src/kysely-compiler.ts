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
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type SelectQueryBuilder,
  type SqlBool,
  sql,
} from 'kysely';
import type { CollectionState } from './types';

type AnyDB = Record<string, Record<string, unknown>>;
type AnySelectQueryBuilder = SelectQueryBuilder<AnyDB, string, Record<string, unknown>>;
type SqlComparable = AstExpression | ParamRef | LiteralExpr | ListLiteralExpr;

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
  let qb = queryCompiler.selectFrom(tableName).selectAll();
  qb = applyWhereFilters(qb, state.filters);

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
  let qb = queryCompiler
    .selectFrom(relatedTableName)
    .selectAll()
    .where(fkColumn, 'in', [...parentPks]);
  qb = applyWhereFilters(qb, nestedState.filters);

  if (nestedState.orderBy) {
    for (const o of nestedState.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  return qb.compile();
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
  if (filters.length === 0) {
    return qb;
  }

  const whereExpr: WhereExpr =
    filters.length === 1 ? filters[0]! : { kind: 'and', exprs: [...filters] };

  return qb.where((eb) =>
    whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, whereExpr),
  ) as QueryBuilder;
}

function whereExprToKysely(eb: ExpressionBuilder<AnyDB, string>, expr: WhereExpr): unknown {
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

function binaryExprToKysely(expr: BinaryExpr): unknown {
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

function nullCheckExprToKysely(expr: AstExpression, isNull: boolean): unknown {
  const operand = astExpressionToKysely(expr);
  return isNull ? sql<SqlBool>`${operand} is null` : sql<SqlBool>`${operand} is not null`;
}

function existsExprToKysely(subquery: SelectAst, not: boolean): unknown {
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

    const projected = expr.kind === 'literal' ? sql`${expr.value}` : astExpressionToKysely(expr);
    return projected.as(projection.alias || `_p${index}`);
  });

  qb = qb.select(projectSql.length > 0 ? projectSql : [sql`1`.as('_exists')]);

  if (ast.where) {
    qb = qb.where((eb) => whereExprToKysely(eb as ExpressionBuilder<AnyDB, string>, ast.where));
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

function astExpressionToKysely(expr: AstExpression): unknown {
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

function sqlComparableToKysely(value: Exclude<SqlComparable, ListLiteralExpr>): unknown {
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
