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
import { type ExpressionBuilder, type SqlBool, sql } from 'kysely';
import type {
  AnyDB,
  AnySelectQueryBuilder,
  SqlComparable,
  SqlPredicate,
  SqlValueExpression,
} from './kysely-compiler-shared';
import { queryCompiler } from './kysely-compiler-shared';

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

export function combineWhereFilters(filters: readonly WhereExpr[]): WhereExpr | undefined {
  if (filters.length === 0) {
    return undefined;
  }

  const firstFilter = filters[0];
  if (filters.length === 1 && firstFilter !== undefined) {
    return firstFilter;
  }

  return { kind: 'and', exprs: [...filters] };
}

export function whereExprToKysely(
  eb: ExpressionBuilder<AnyDB, string>,
  expr: WhereExpr,
): SqlPredicate {
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
