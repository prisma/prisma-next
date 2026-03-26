import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  type AnyFromSource,
  type AnySqlComparable,
  type AnyWhereExpr,
  BinaryExpr,
  type BoundWhereExpr,
  type ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  type ExpressionRewriter,
  JoinAst,
  ListLiteralExpr,
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
  expr: AnyWhereExpr,
): BoundWhereExpr {
  return {
    expr: bindWhereExprNode(contract, expr),
  };
}

function bindWhereExprNode(
  contract: SqlContract<SqlStorage>,
  expr: AnyWhereExpr,
): AnyWhereExpr {
  return expr.accept<AnyWhereExpr>({
    binary(expr) {
      const left = bindExpression(contract, expr.left);
      const bindingColumn = left.kind === 'column-ref' ? left : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn),
      );
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
  });
}

function bindComparable(
  contract: SqlContract<SqlStorage>,
  comparable: AnySqlComparable,
  bindingColumn: ColumnRef | undefined,
): AnySqlComparable {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list-literal'
        ? comparable
        : bindExpression(contract, comparable);
  }

  if (comparable.kind === 'literal') {
    return createParamRef(contract, bindingColumn, comparable.value);
  }

  if (comparable.kind === 'list-literal') {
    return ListLiteralExpr.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? createParamRef(contract, bindingColumn, value.value)
          : value,
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
  const columnMeta = contract.storage.tables[columnRef.table]?.columns[columnRef.column];
  return ParamRef.of(value, {
    name: columnRef.column,
    ...(columnMeta?.codecId !== undefined && { codecId: columnMeta.codecId }),
  });
}

function createExpressionBinder(
  contract: SqlContract<SqlStorage>,
): ExpressionRewriter {
  return {
    select: (ast) => bindSelectAst(contract, ast),
  };
}

function bindExpression(
  contract: SqlContract<SqlStorage>,
  expr: AnyExpression,
): AnyExpression {
  return expr.rewrite(createExpressionBinder(contract));
}

function bindProjectionExpr(
  contract: SqlContract<SqlStorage>,
  expr: ProjectionExpr,
): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr);
}

function bindOrderByItem(
  contract: SqlContract<SqlStorage>,
  orderItem: OrderByItem,
): OrderByItem {
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

function bindFromSource(
  contract: SqlContract<SqlStorage>,
  source: AnyFromSource,
): AnyFromSource {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return node;
    case 'derived-table-source':
      return DerivedTableSource.as(node.alias, bindSelectAst(contract, node.query));
    // v8 ignore next 4
    default:
      throw new Error(
        `Unsupported source kind: ${(node satisfies never as { kind: string }).kind}`,
      );
  }
}

function bindSelectAst(
  contract: SqlContract<SqlStorage>,
  ast: SelectAst,
): SelectAst {
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
