import type {
  BoundWhereExpr,
  Expression,
  FromSource,
  JoinOnExpr,
  ListLiteralExpr,
  LiteralExpr,
  ParamRef,
  SelectAst,
  ToWhereExpr,
  WhereArg,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { createLiteralExpr } from '@prisma-next/sql-relational-core/ast';
import { ifDefined } from '@prisma-next/utils/defined';

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: WhereArg): WhereExpr;
export function normalizeWhereArg(arg: WhereArg | undefined): WhereExpr | undefined;
export function normalizeWhereArg(arg: WhereArg | undefined): WhereExpr | undefined {
  if (arg === undefined) {
    return undefined;
  }
  if (arg === null) {
    throw new Error(
      'WhereArg cannot be null. Pass undefined or a valid WhereExpr/ToWhereExpr payload.',
    );
  }

  if (isToWhereExpr(arg)) {
    const bound = arg.toWhereExpr();
    assertBoundPayload(bound);
    return replaceBoundParams(bound.expr, bound.params);
  }

  assertBareWhereExprIsParamFree(arg);
  return arg;
}

function isToWhereExpr(arg: WhereArg): arg is ToWhereExpr {
  return typeof arg === 'object' && arg !== null && 'toWhereExpr' in arg;
}

function assertBoundPayload(bound: BoundWhereExpr): void {
  if (bound.params.length !== bound.paramDescriptors.length) {
    throw new Error(
      `ToWhereExpr payload is invalid: params (${bound.params.length}) and paramDescriptors (${bound.paramDescriptors.length}) must align`,
    );
  }

  const indexes = collectParamRefIndexes(bound.expr);
  if (indexes.length === 0) {
    if (bound.params.length > 0) {
      throw new Error(
        'ToWhereExpr payload is invalid: expr does not contain ParamRef entries but params were provided',
      );
    }
    return;
  }

  const unique = [...new Set(indexes)].sort((a, b) => a - b);
  const minIndex = unique[0];
  const maxIndex = unique[unique.length - 1];

  if (minIndex !== 1) {
    throw new Error(
      `ToWhereExpr payload is invalid: ParamRef indices must start at 1, found min index ${String(minIndex)}`,
    );
  }
  if (maxIndex !== bound.params.length) {
    throw new Error(
      `ToWhereExpr payload is invalid: max ParamRef index (${String(maxIndex)}) must equal params length (${bound.params.length})`,
    );
  }
  if (unique.length !== bound.params.length) {
    throw new Error(
      `ToWhereExpr payload is invalid: ParamRef indices must be contiguous with no gaps for params length ${bound.params.length}`,
    );
  }

  for (let i = 0; i < unique.length; i++) {
    if (unique[i] !== i + 1) {
      /* c8 ignore next 3 -- redundant safety net after prior min/max/length checks */
      throw new Error(
        `ToWhereExpr payload is invalid: ParamRef indices must be contiguous from 1..${bound.params.length}`,
      );
    }
  }
}

function assertBareWhereExprIsParamFree(expr: WhereExpr): void {
  if (whereExprContainsParamRef(expr)) {
    throw new Error(
      'Bare WhereExpr cannot contain ParamRef. Use ToWhereExpr.toWhereExpr() for bound parameter payloads.',
    );
  }
}

function sourceContainsParamRef(source: FromSource): boolean {
  if (source.kind === 'table') {
    return false;
  }
  return selectContainsParamRef(source.query);
}

function whereExprContainsParamRef(expr: WhereExpr): boolean {
  switch (expr.kind) {
    case 'bin':
      return expressionContainsParamRef(expr.left) || sqlComparableContainsParamRef(expr.right);
    case 'nullCheck':
      return expressionContainsParamRef(expr.expr);
    case 'and':
    case 'or':
      return expr.exprs.some(whereExprContainsParamRef);
    case 'exists':
      return selectContainsParamRef(expr.subquery);
    /* c8 ignore next 3 -- exhaustive guard for forward-compat malformed nodes */
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function selectContainsParamRef(ast: SelectAst): boolean {
  const whereHasParams = ast.where ? whereExprContainsParamRef(ast.where) : false;
  const havingHasParams = ast.having ? whereExprContainsParamRef(ast.having) : false;
  const fromHasParams = sourceContainsParamRef(ast.from);
  const projectHasParams = ast.project.some((p) => {
    if (p.expr.kind === 'literal') {
      return false;
    }
    return expressionContainsParamRef(p.expr);
  });
  const distinctOnHasParams = (ast.distinctOn ?? []).some((expr) => expressionContainsParamRef(expr));
  const groupByHasParams = (ast.groupBy ?? []).some((expr) => expressionContainsParamRef(expr));
  const orderByHasParams = (ast.orderBy ?? []).some((order) =>
    expressionContainsParamRef(order.expr),
  );
  const joinsHaveParams = (ast.joins ?? []).some(
    (join) => joinOnContainsParamRef(join.on) || sourceContainsParamRef(join.source),
  );
  return (
    fromHasParams ||
    whereHasParams ||
    havingHasParams ||
    projectHasParams ||
    distinctOnHasParams ||
    groupByHasParams ||
    orderByHasParams ||
    joinsHaveParams
  );
}

function joinOnContainsParamRef(joinOn: JoinOnExpr): boolean {
  if (joinOn.kind === 'eqCol') {
    return false;
  }
  return whereExprContainsParamRef(joinOn);
}

function expressionContainsParamRef(expr: Expression): boolean {
  switch (expr.kind) {
    case 'col':
      return false;
    case 'subquery':
      return selectContainsParamRef(expr.query);
    case 'aggregate':
      return expr.expr ? expressionContainsParamRef(expr.expr) : false;
    case 'jsonArrayAgg':
      return (
        expressionContainsParamRef(expr.expr) ||
        (expr.orderBy ?? []).some((order) => expressionContainsParamRef(order.expr))
      );
    case 'jsonObject':
      return expr.entries.some((entry) => {
        if (entry.value.kind === 'literal') {
          return false;
        }
        return expressionContainsParamRef(entry.value);
      });
    case 'operation':
      if (expressionContainsParamRef(expr.self)) {
        return true;
      }
      return expr.args.some((arg) => {
        if (arg.kind === 'param') {
          return true;
        }
        if (arg.kind === 'literal') {
          return false;
        }
        return expressionContainsParamRef(arg);
      });
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported expression kind: ${String(neverExpr)}`);
    }
  }
}

function sqlComparableContainsParamRef(
  value: Expression | ParamRef | ListLiteralExpr | LiteralExpr,
): boolean {
  if (value.kind === 'param') {
    return true;
  }
  if (value.kind === 'literal') {
    return false;
  }
  if (value.kind === 'listLiteral') {
    return value.values.some((item) => item.kind === 'param');
  }
  return expressionContainsParamRef(value);
}

function replaceBoundParams(expr: WhereExpr, params: readonly unknown[]): WhereExpr {
  switch (expr.kind) {
    case 'bin':
      return {
        ...expr,
        left: replaceParamsInExpression(expr.left, params),
        right: replaceParamsInComparable(expr.right, params),
      };
    case 'nullCheck':
      return {
        ...expr,
        expr: replaceParamsInExpression(expr.expr, params),
      };
    case 'and':
      return {
        ...expr,
        exprs: expr.exprs.map((child) => replaceBoundParams(child, params)),
      };
    case 'or':
      return {
        ...expr,
        exprs: expr.exprs.map((child) => replaceBoundParams(child, params)),
      };
    case 'exists':
      return {
        ...expr,
        subquery: replaceParamsInSelect(expr.subquery, params),
      };
    /* c8 ignore next 3 -- exhaustive guard for forward-compat malformed nodes */
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function replaceParamsInFromSource(source: FromSource, params: readonly unknown[]): FromSource {
  if (source.kind === 'table') {
    return source;
  }
  return {
    ...source,
    query: replaceParamsInSelect(source.query, params),
  };
}

function replaceParamsInSelect(ast: SelectAst, params: readonly unknown[]): SelectAst {
  const from = replaceParamsInFromSource(ast.from, params);
  const joins = ast.joins?.map((join) => ({
    ...join,
    source: replaceParamsInFromSource(join.source, params),
    on: replaceParamsInJoinOn(join.on, params),
  }));
  const project = ast.project.map((projection) => {
    if (projection.expr.kind === 'literal') {
      return projection;
    }
    return {
      ...projection,
      expr: replaceParamsInExpression(projection.expr, params),
    };
  });
  const where = ast.where ? replaceBoundParams(ast.where, params) : undefined;
  const having = ast.having ? replaceBoundParams(ast.having, params) : undefined;
  const orderBy = ast.orderBy?.map((order) => ({
    ...order,
    expr: replaceParamsInExpression(order.expr, params),
  }));
  const distinctOn = ast.distinctOn?.map((expr) => replaceParamsInExpression(expr, params));
  const groupBy = ast.groupBy?.map((expr) => replaceParamsInExpression(expr, params));

  return {
    kind: ast.kind,
    from,
    project,
    ...ifDefined('joins', joins),
    ...ifDefined('where', where),
    ...ifDefined('having', having),
    ...ifDefined('orderBy', orderBy),
    ...ifDefined('distinct', ast.distinct),
    ...ifDefined('distinctOn', distinctOn),
    ...ifDefined('groupBy', groupBy),
    ...ifDefined('limit', ast.limit),
    ...ifDefined('offset', ast.offset),
    ...ifDefined('selectAllIntent', ast.selectAllIntent),
  };
}

function replaceParamsInJoinOn(joinOn: JoinOnExpr, params: readonly unknown[]): JoinOnExpr {
  if (joinOn.kind === 'eqCol') {
    return joinOn;
  }
  return replaceBoundParams(joinOn, params);
}

function replaceParamsInExpression(expr: Expression, params: readonly unknown[]): Expression {
  switch (expr.kind) {
    case 'col':
      return expr;
    case 'subquery':
      return {
        ...expr,
        query: replaceParamsInSelect(expr.query, params),
      };
    case 'aggregate':
      return {
        ...expr,
        ...ifDefined('expr', expr.expr ? replaceParamsInExpression(expr.expr, params) : undefined),
      };
    case 'jsonArrayAgg':
      return {
        ...expr,
        expr: replaceParamsInExpression(expr.expr, params),
        ...(expr.orderBy
          ? {
              orderBy: expr.orderBy.map((order) => ({
                ...order,
                expr: replaceParamsInExpression(order.expr, params),
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
              : replaceParamsInExpression(entry.value, params),
        })),
      };
    case 'operation':
      return {
        ...expr,
        self: replaceParamsInExpression(expr.self, params),
        args: expr.args.map((arg) => {
          if (arg.kind === 'param') {
            return paramRefToLiteral(arg, params);
          }
          if (arg.kind === 'literal') {
            return arg;
          }
          return replaceParamsInExpression(arg, params);
        }),
      };
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported expression kind: ${String(neverExpr)}`);
    }
  }
}

function replaceParamsInComparable(
  value: Expression | ParamRef | ListLiteralExpr | LiteralExpr,
  params: readonly unknown[],
): Expression | LiteralExpr | ListLiteralExpr {
  if (value.kind === 'param') {
    return paramRefToLiteral(value, params);
  }
  if (value.kind === 'literal') {
    return value;
  }
  if (value.kind === 'listLiteral') {
    return {
      ...value,
      values: value.values.map((entry) =>
        entry.kind === 'param' ? paramRefToLiteral(entry, params) : entry,
      ),
    };
  }
  return replaceParamsInExpression(value, params);
}

function paramRefToLiteral(
  paramRef: ParamRef,
  params: readonly unknown[],
): LiteralExpr {
  const idx = paramRef.index - 1;
  /* c8 ignore start -- validated in assertBoundPayload before replacement */
  if (idx < 0 || idx >= params.length) {
    throw new Error(
      `ToWhereExpr payload is invalid: ParamRef index ${paramRef.index} is out of bounds for ${params.length} params`,
    );
  }
  /* c8 ignore stop */
  return createLiteralExpr(params[idx]);
}

function collectParamRefIndexes(expr: WhereExpr): number[] {
  const indexes: number[] = [];

  const visitComparable = (
    value: Expression | ParamRef | ListLiteralExpr | LiteralExpr,
  ): void => {
    if (value.kind === 'param') {
      indexes.push(value.index);
      return;
    }
    if (value.kind === 'literal') {
      return;
    }
    if (value.kind === 'listLiteral') {
      for (const entry of value.values) {
        if (entry.kind === 'param') {
          indexes.push(entry.index);
        }
      }
      return;
    }
    visitExpression(value);
  };

  const visitExpression = (value: Expression): void => {
    switch (value.kind) {
      case 'col':
        return;
      case 'subquery':
        visitSelect(value.query);
        return;
      case 'aggregate':
        if (value.expr) {
          visitExpression(value.expr);
        }
        return;
      case 'jsonArrayAgg':
        visitExpression(value.expr);
        for (const order of value.orderBy ?? []) {
          visitExpression(order.expr);
        }
        return;
      case 'jsonObject':
        for (const entry of value.entries) {
          if (entry.value.kind !== 'literal') {
            visitExpression(entry.value);
          }
        }
        return;
      case 'operation':
        visitExpression(value.self);
        for (const arg of value.args) {
          if (arg.kind === 'param') {
            indexes.push(arg.index);
          } else if (arg.kind !== 'literal') {
            visitExpression(arg);
          }
        }
        return;
      default: {
        const neverExpr: never = value;
        throw new Error(`Unsupported expression kind: ${String(neverExpr)}`);
      }
    }
  };

  const visitJoinOn = (joinOn: JoinOnExpr): void => {
    if (joinOn.kind === 'eqCol') {
      return;
    }
    visitWhere(joinOn);
  };

  const visitSource = (source: FromSource): void => {
    if (source.kind === 'derivedTable') {
      visitSelect(source.query);
    }
  };

  const visitSelect = (ast: SelectAst): void => {
    visitSource(ast.from);
    if (ast.where) {
      visitWhere(ast.where);
    }
    if (ast.having) {
      visitWhere(ast.having);
    }
    for (const projection of ast.project) {
      if (projection.expr.kind !== 'literal') {
        visitExpression(projection.expr);
      }
    }
    for (const distinctOnExpr of ast.distinctOn ?? []) {
      visitExpression(distinctOnExpr);
    }
    for (const groupByExpr of ast.groupBy ?? []) {
      visitExpression(groupByExpr);
    }
    for (const orderBy of ast.orderBy ?? []) {
      visitExpression(orderBy.expr);
    }
    for (const join of ast.joins ?? []) {
      visitSource(join.source);
      visitJoinOn(join.on);
    }
  };

  const visitWhere = (value: WhereExpr): void => {
    switch (value.kind) {
      case 'bin':
        visitExpression(value.left);
        visitComparable(value.right);
        return;
      case 'nullCheck':
        visitExpression(value.expr);
        return;
      case 'and':
      case 'or':
        for (const nested of value.exprs) {
          visitWhere(nested);
        }
        return;
      case 'exists':
        visitSelect(value.subquery);
        return;
      default: {
        const neverExpr: never = value;
        throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
      }
    }
  };

  visitWhere(expr);
  return indexes;
}
