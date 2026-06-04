import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
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
import { codecRefForStorageColumn } from '@prisma-next/sql-relational-core/codec-descriptor-registry';

export function bindWhereExpr(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  namespaceId?: string,
): AnyExpression {
  return bindWhereExprNode(contract, expr, namespaceId);
}

function bindWhereExprNode(
  contract: Contract<SqlStorage>,
  expr: AnyExpression,
  namespaceId?: string,
): AnyExpression {
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
    windowFunc(expr) {
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
    preparedParam(expr) {
      return expr;
    },
    list(expr) {
      return bindExpression(contract, expr);
    },
    binary(expr) {
      const left = bindExpression(contract, expr.left);
      const bindingColumn = left.kind === 'column-ref' ? (left as ColumnRef) : undefined;

      return new BinaryExpr(
        expr.op,
        left,
        bindComparable(contract, expr.right, bindingColumn, namespaceId),
      );
    },
    and(expr) {
      return AndExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, namespaceId)));
    },
    or(expr) {
      return OrExpr.of(expr.exprs.map((part) => bindWhereExprNode(contract, part, namespaceId)));
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
      return new NotExpr(bindWhereExprNode(contract, expr.expr, namespaceId));
    },
    rawExpr(expr) {
      return expr;
    },
  });
}

function bindComparable(
  contract: Contract<SqlStorage>,
  comparable: AnyExpression,
  bindingColumn: ColumnRef | undefined,
  namespaceId?: string,
): AnyExpression {
  if (comparable.kind === 'param-ref' || bindingColumn === undefined) {
    return comparable.kind === 'param-ref'
      ? comparable
      : comparable.kind === 'literal' || comparable.kind === 'list'
        ? comparable
        : bindExpression(contract, comparable);
  }

  if (comparable.kind === 'literal') {
    return createParamRef(contract, bindingColumn, comparable.value, namespaceId);
  }

  if (comparable.kind === 'list') {
    return ListExpression.of(
      comparable.values.map((value) =>
        value.kind === 'literal'
          ? createParamRef(contract, bindingColumn, value.value, namespaceId)
          : value,
      ),
    );
  }

  return bindExpression(contract, comparable);
}

function createParamRef(
  contract: Contract<SqlStorage>,
  columnRef: ColumnRef,
  value: unknown,
  namespaceId?: string,
): ParamRef {
  // `bindWhereExpr` binds AST that can reach into nested subqueries spanning
  // namespaces, so the namespace coordinate is genuinely absent on the deep
  // recursion. Resolve the column's owning namespace here — directly when the
  // coordinate is supplied, otherwise by scanning storage — and feed that
  // resolved id to the namespace-leading `codecRefForStorageColumn`.
  const namespaces = contract.storage.namespaces;
  const resolvedNamespaceId =
    namespaceId ??
    Object.keys(namespaces).find(
      (ns) => namespaces[ns]?.entries.table[columnRef.table] !== undefined,
    );
  if (resolvedNamespaceId === undefined) {
    throw new Error(`Unknown column "${columnRef.column}" in table "${columnRef.table}"`);
  }
  const tableInAnyNs = namespaces[resolvedNamespaceId]?.entries.table[columnRef.table] as
    | StorageTable
    | undefined;
  if (!tableInAnyNs?.columns[columnRef.column]) {
    throw new Error(`Unknown column "${columnRef.column}" in table "${columnRef.table}"`);
  }
  const codec = codecRefForStorageColumn(
    contract.storage,
    resolvedNamespaceId,
    columnRef.table,
    columnRef.column,
  );
  return ParamRef.of(value, codec ? { codec } : undefined);
}

function createExpressionBinder(contract: Contract<SqlStorage>): ExpressionRewriter {
  return {
    select: (ast) => bindSelectAst(contract, ast),
  };
}

function bindExpression(contract: Contract<SqlStorage>, expr: AnyExpression): AnyExpression {
  return expr.rewrite(createExpressionBinder(contract));
}

function bindProjectionExpr(contract: Contract<SqlStorage>, expr: ProjectionExpr): ProjectionExpr {
  return expr.kind === 'literal' ? expr : bindExpression(contract, expr);
}

function bindOrderByItem(contract: Contract<SqlStorage>, orderItem: OrderByItem): OrderByItem {
  return new OrderByItem(bindExpression(contract, orderItem.expr), orderItem.dir);
}

function bindJoin(contract: Contract<SqlStorage>, join: JoinAst): JoinAst {
  return new JoinAst(
    join.joinType,
    bindFromSource(contract, join.source),
    join.on.kind === 'eq-col-join-on' ? join.on : bindWhereExprNode(contract, join.on),
    join.lateral,
  );
}

function bindFromSource(contract: Contract<SqlStorage>, source: AnyFromSource): AnyFromSource {
  if (source.kind === 'table-source') {
    return source;
  }
  if (source.kind === 'derived-table-source') {
    const derived = source as DerivedTableSource;
    return DerivedTableSource.as(derived.alias, bindSelectAst(contract, derived.query));
  }

  return source;
}

function bindSelectAst(contract: Contract<SqlStorage>, ast: SelectAst): SelectAst {
  return new SelectAst({
    from: bindFromSource(contract, ast.from),
    joins: ast.joins?.map((join) => bindJoin(contract, join)),
    projection: ast.projection.map(
      (projection) =>
        new ProjectionItem(
          projection.alias,
          bindProjectionExpr(contract, projection.expr),
          projection.codec,
        ),
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
