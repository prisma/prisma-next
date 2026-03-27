import type { ParamDescriptor } from '@prisma-next/contract/types';
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
import { createColumnParamDescriptor } from './param-descriptors';

interface BindState {
  readonly params: unknown[];
  readonly paramDescriptors: ParamDescriptor[];
}

export function bindWhereExpr(
  contract: SqlContract<SqlStorage>,
  expr: AnyWhereExpr,
): BoundWhereExpr {
  const state: BindState = {
    params: [],
    paramDescriptors: [],
  };

  return {
    expr: bindWhereExprNode(contract, expr, state),
    params: state.params,
    paramDescriptors: state.paramDescriptors,
  };
}

function bindWhereExprNode(
  contract: SqlContract<SqlStorage>,
  expr: AnyWhereExpr,
  state: BindState,
): AnyWhereExpr {
  return expr.accept<AnyWhereExpr>({
    binary(expr) {
      const left = bindExpression(contract, expr.left, state);
      const bindingColumn = left.kind === 'column-ref' ? (left as ColumnRef) : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn, state),
      );
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, state)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, state)));
    },
    exists(expr) {
      return expr.notExists
        ? ExistsExpr.notExists(bindSelectAst(contract, expr.subquery, state))
        : ExistsExpr.exists(bindSelectAst(contract, expr.subquery, state));
    },
    nullCheck(expr) {
      return expr.isNull
        ? NullCheckExpr.isNull(bindExpression(contract, expr.expr, state))
        : NullCheckExpr.isNotNull(bindExpression(contract, expr.expr, state));
    },
  });
}

function bindComparable(
  contract: SqlContract<SqlStorage>,
  comparable: AnySqlComparable,
  bindingColumn: ColumnRef | undefined,
  state: BindState,
): AnySqlComparable {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list-literal'
        ? comparable
        : bindExpression(contract, comparable, state);
  }

  if (comparable.kind === 'literal') {
    return createParamRef(contract, bindingColumn, comparable.value, state);
  }

  if (comparable.kind === 'list-literal') {
    return ListLiteralExpr.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? createParamRef(contract, bindingColumn, value.value, state)
          : value,
      ),
    );
  }

  return bindExpression(contract, comparable, state);
}

function createParamRef(
  contract: SqlContract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
  state: BindState,
): ParamRef {
  const index = state.params.push(value);
  state.paramDescriptors.push(
    createColumnParamDescriptor(contract, columnRef.table, columnRef.column, index),
  );
  return ParamRef.of(index, columnRef.column);
}

function createExpressionBinder(
  contract: SqlContract<SqlStorage>,
  state: BindState,
): ExpressionRewriter {
  return {
    select: (ast) => bindSelectAst(contract, ast, state),
  };
}

function bindExpression(
  contract: SqlContract<SqlStorage>,
  expr: AnyExpression,
  state: BindState,
): AnyExpression {
  return expr.rewrite(createExpressionBinder(contract, state));
}

function bindProjectionExpr(
  contract: SqlContract<SqlStorage>,
  expr: ProjectionExpr,
  state: BindState,
): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr, state);
}

function bindOrderByItem(
  contract: SqlContract<SqlStorage>,
  orderItem: OrderByItem,
  state: BindState,
): OrderByItem {
  return new OrderByItem(bindExpression(contract, orderItem.expr, state), orderItem.dir);
}

function bindJoin(contract: SqlContract<SqlStorage>, join: JoinAst, state: BindState): JoinAst {
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source, state),
    join.on.kind === 'eq-col-join-on' ? join.on : bindWhereExprNode(contract, join.on, state),
    join.lateral,
  );
}

function bindFromSource(
  contract: SqlContract<SqlStorage>,
  source: AnyFromSource,
  state: BindState,
): AnyFromSource {
  const node = source;
  switch (node.kind) {
    case 'table-source':
      return node;
    case 'derived-table-source':
      return DerivedTableSource.as(node.alias, bindSelectAst(contract, node.query, state));
    default: {
      const _exhaustive: never = node;
      throw new Error(`Unsupported source kind: ${(_exhaustive as { kind: string }).kind}`);
    }
  }
}

function bindSelectAst(
  contract: SqlContract<SqlStorage>,
  ast: SelectAst,
  state: BindState,
): SelectAst {
  return new SelectAst({
    from: bindFromSource(contract, ast.from, state),
    joins: ast.joins?.map((join) => bindJoin(contract, join, state)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(projection.alias, bindProjectionExpr(contract, projection.expr, state)),
    ),
    where: ast.where ? bindWhereExprNode(contract, ast.where, state) : undefined,
    orderBy: ast.orderBy?.map((orderItem) => bindOrderByItem(contract, orderItem, state)),
    distinct: ast.distinct,
    distinctOn: ast.distinctOn?.map((expr) => bindExpression(contract, expr, state)),
    groupBy: ast.groupBy?.map((expr) => bindExpression(contract, expr, state)),
    having: ast.having ? bindWhereExprNode(contract, ast.having, state) : undefined,
    limit: ast.limit,
    offset: ast.offset,
    selectAllIntent: ast.selectAllIntent,
  });
}
