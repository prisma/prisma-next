import type {
  BoundWhereExpr,
  Expression,
  JoinOnExpr,
  ListLiteralExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  ToWhereExpr,
  WhereArg,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';

export function normalizeWhereArg(arg: WhereArg): WhereExpr {
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
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function selectContainsParamRef(ast: SelectAst): boolean {
  const whereHasParams = ast.where ? whereExprContainsParamRef(ast.where) : false;
  const projectHasParams = ast.project.some((p) => {
    if (p.expr.kind === 'includeRef' || p.expr.kind === 'literal') {
      return false;
    }
    return expressionContainsParamRef(p.expr);
  });
  const orderByHasParams = (ast.orderBy ?? []).some((order) =>
    expressionContainsParamRef(order.expr),
  );
  const joinsHaveParams = (ast.joins ?? []).some((join) => joinOnContainsParamRef(join.on));
  const includesHaveParams = (ast.includes ?? []).some((inc) => {
    const child = inc.child;
    const childWhereHasParams = child.where ? whereExprContainsParamRef(child.where) : false;
    const childOrderHasParams = (child.orderBy ?? []).some((order) =>
      expressionContainsParamRef(order.expr),
    );
    const childProjectHasParams = child.project.some((p) => expressionContainsParamRef(p.expr));
    return childWhereHasParams || childOrderHasParams || childProjectHasParams;
  });
  return (
    whereHasParams || projectHasParams || orderByHasParams || joinsHaveParams || includesHaveParams
  );
}

function joinOnContainsParamRef(joinOn: JoinOnExpr): boolean {
  if (joinOn.kind === 'eqCol') {
    return false;
  }
  return whereExprContainsParamRef(joinOn);
}

function expressionContainsParamRef(expr: Expression): boolean {
  if (expr.kind !== 'operation') {
    return false;
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
}

function sqlComparableContainsParamRef(
  value: Expression | ParamRef | ListLiteralExpr | { kind: 'literal'; value: unknown },
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
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function replaceParamsInSelect(ast: SelectAst, params: readonly unknown[]): SelectAst {
  return {
    ...ast,
    joins: ast.joins?.map((join) => ({
      ...join,
      on: replaceParamsInJoinOn(join.on, params),
    })),
    includes: ast.includes?.map((inc) => ({
      ...inc,
      child: {
        ...inc.child,
        where: inc.child.where ? replaceBoundParams(inc.child.where, params) : undefined,
        orderBy: inc.child.orderBy?.map((order) => ({
          ...order,
          expr: replaceParamsInExpression(order.expr, params),
        })),
        project: inc.child.project.map((projection) => ({
          ...projection,
          expr: replaceParamsInExpression(projection.expr, params),
        })),
      },
    })),
    project: ast.project.map((projection) => {
      if (projection.expr.kind === 'includeRef' || projection.expr.kind === 'literal') {
        return projection;
      }
      return {
        ...projection,
        expr: replaceParamsInExpression(projection.expr, params),
      };
    }),
    where: ast.where ? replaceBoundParams(ast.where, params) : undefined,
    orderBy: ast.orderBy?.map((order) => ({
      ...order,
      expr: replaceParamsInExpression(order.expr, params),
    })),
  };
}

function replaceParamsInJoinOn(joinOn: JoinOnExpr, params: readonly unknown[]): JoinOnExpr {
  if (joinOn.kind === 'eqCol') {
    return joinOn;
  }
  return replaceBoundParams(joinOn, params);
}

function replaceParamsInExpression(expr: Expression, params: readonly unknown[]): Expression {
  if (expr.kind !== 'operation') {
    return expr;
  }
  return {
    ...expr,
    args: expr.args.map((arg) => {
      if (arg.kind === 'param') {
        return paramRefToLiteral(arg, params);
      }
      if (arg.kind === 'literal') {
        return arg;
      }
      return replaceParamsInExpression(arg, params);
    }),
  } as OperationExpr;
}

function replaceParamsInComparable(
  value: Expression | ParamRef | ListLiteralExpr | { kind: 'literal'; value: unknown },
  params: readonly unknown[],
): Expression | { kind: 'literal'; value: unknown } | ListLiteralExpr {
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
): { kind: 'literal'; value: unknown } {
  const idx = paramRef.index - 1;
  if (idx < 0 || idx >= params.length) {
    throw new Error(
      `ToWhereExpr payload is invalid: ParamRef index ${paramRef.index} is out of bounds for ${params.length} params`,
    );
  }
  return {
    kind: 'literal',
    value: params[idx],
  };
}

function collectParamRefIndexes(expr: WhereExpr): number[] {
  const indexes: number[] = [];

  const visitComparable = (
    value: Expression | ParamRef | ListLiteralExpr | { kind: 'literal'; value: unknown },
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
    if (value.kind !== 'operation') {
      return;
    }
    for (const arg of value.args) {
      if (arg.kind === 'param') {
        indexes.push(arg.index);
      } else if (arg.kind !== 'literal') {
        visitExpression(arg);
      }
    }
  };

  const visitJoinOn = (joinOn: JoinOnExpr): void => {
    if (joinOn.kind === 'eqCol') {
      return;
    }
    visitWhere(joinOn);
  };

  const visitSelect = (ast: SelectAst): void => {
    if (ast.where) {
      visitWhere(ast.where);
    }
    for (const projection of ast.project) {
      if (projection.expr.kind !== 'includeRef' && projection.expr.kind !== 'literal') {
        visitExpression(projection.expr);
      }
    }
    for (const orderBy of ast.orderBy ?? []) {
      visitExpression(orderBy.expr);
    }
    for (const join of ast.joins ?? []) {
      visitJoinOn(join.on);
    }
    for (const include of ast.includes ?? []) {
      const child = include.child;
      if (child.where) {
        visitWhere(child.where);
      }
      for (const childProjection of child.project) {
        if (childProjection.expr.kind !== 'includeRef' && childProjection.expr.kind !== 'literal') {
          visitExpression(childProjection.expr);
        }
      }
      for (const childOrderBy of child.orderBy ?? []) {
        visitExpression(childOrderBy.expr);
      }
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
