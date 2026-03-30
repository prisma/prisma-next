import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  BinaryExpr,
  type ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  type ExpressionRewriter,
  JoinAst,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  type ProjectionExpr,
  ProjectionItem,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';

export function bindWhereExpr(
  contract: SqlContract<SqlStorage>,
  expr: AnyExpression,
): AnyExpression {
  return bindWhereExprNode(contract, expr);
}

function bindWhereExprNode(contract: SqlContract<SqlStorage>, expr: AnyExpression): AnyExpression {
  return expr.accept<AnyExpression>({
    columnRef(expr) {
      return bindExpression(contract, expr);
    },
    identifierRef(expr) {
      return expr;
    },
    subquery(expr) {
      return bindExpression(contract, expr);
    },
    operation(expr) {
      return bindExpression(contract, expr);
    },
    aggregate(expr) {
      return bindExpression(contract, expr);
    },
    jsonObject(expr) {
      return bindExpression(contract, expr);
    },
    jsonArrayAgg(expr) {
      return bindExpression(contract, expr);
    },
    literal(expr) {
      return expr;
    },
    param(expr) {
      return expr;
    },
    list(expr) {
      return bindExpression(contract, expr);
    },
    binary(expr) {
      const left = bindExpression(contract, expr.left);
      const bindingColumn = left.kind === 'column-ref' ? (left as ColumnRef) : undefined;

      return new BinaryExpr(expr.op, left, bindComparable(contract, expr.right, bindingColumn));
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part)));
    },
    exists(expr) {
      return expr.notExists
        ? ExistsExpr.notExists(bindSelectAst(contract, expr.subquery))
        : ExistsExpr.exists(bindSelectAst(contract, expr.subquery));
    },
    nullCheck(expr) {
      return expr.isNull
        ? NullCheckExpr.isNull(bindExpression(contract, expr.expr))
        : NullCheckExpr.isNotNull(bindExpression(contract, expr.expr));
    },
    not(expr) {
      return new NotExpr(bindWhereExprNode(contract, expr.expr));
    },
  });
}

function bindComparable(
  contract: SqlContract<SqlStorage>,
  comparable: AnyExpression,
  bindingColumn: ColumnRef | undefined,
): AnyExpression {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list'
        ? comparable
        : bindExpression(contract, comparable);
  }

  if (comparable.kind === 'literal') {
    return createParamRef(contract, bindingColumn, comparable.value);
  }

  if (comparable.kind === 'list') {
    return ListExpression.of(
      comparable.values.map((value) =>
        value.kind === 'literal' ? createParamRef(contract, bindingColumn, value.value) : value,
      ),
    );
  }

  return bindExpression(contract, comparable);
}

function createParamRef(
  contract: SqlContract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
): ParamRef {
  const codecId = contract.storage.tables[columnRef.table]?.columns[columnRef.column]?.codecId;
  if (!codecId) {
    throw new Error(`Unknown column "${columnRef.column}" in table "${columnRef.table}"`);
  }
  return ParamRef.of(value, { name: columnRef.column, codecId });
}

function createExpressionBinder(contract: SqlContract<SqlStorage>): ExpressionRewriter {
  return {
    select: (ast) => bindSelectAst(contract, ast),
  };
}

function bindExpression(contract: SqlContract<SqlStorage>, expr: AnyExpression): AnyExpression {
  return expr.rewrite(createExpressionBinder(contract));
}

function bindProjectionExpr(
  contract: SqlContract<SqlStorage>,
  expr: ProjectionExpr,
): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr);
}

function bindOrderByItem(contract: SqlContract<SqlStorage>, orderItem: OrderByItem): OrderByItem {
  return new OrderByItem(bindExpression(contract, orderItem.expr), orderItem.dir);
}

function bindJoin(contract: SqlContract<SqlStorage>, join: JoinAst): JoinAst {
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source),
    join.on.kind === 'eq-col-join-on' ? join.on : bindWhereExprNode(contract, join.on),
    join.lateral,
  );
}

function bindFromSource(contract: SqlContract<SqlStorage>, source: AnyFromSource): AnyFromSource {
  if (source.kind === 'table-source') {
    return source;
  }
  if (source.kind === 'derived-table-source') {
    const derived = source as DerivedTableSource;
    return DerivedTableSource.as(derived.alias, bindSelectAst(contract, derived.query));
  }

  return source;
}

function bindSelectAst(contract: SqlContract<SqlStorage>, ast: SelectAst): SelectAst {
  return new SelectAst({
    from: bindFromSource(contract, ast.from),
    joins: ast.joins?.map((join) => bindJoin(contract, join)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(projection.alias, bindProjectionExpr(contract, projection.expr)),
    ),
    where: ast.where ? bindWhereExprNode(contract, ast.where) : undefined,
    orderBy: ast.orderBy?.map((orderItem) => bindOrderByItem(contract, orderItem)),
    distinct: ast.distinct,
    distinctOn: ast.distinctOn?.map((expr) => bindExpression(contract, expr)),
    groupBy: ast.groupBy?.map((expr) => bindExpression(contract, expr)),
    having: ast.having ? bindWhereExprNode(contract, ast.having) : undefined,
    limit: ast.limit,
    offset: ast.offset,
    selectAllIntent: ast.selectAllIntent,
  });
}
