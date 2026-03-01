import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BoundWhereExpr,
  Expression,
  JoinOnExpr,
  ListLiteralExpr,
  OperationExpr,
  ParamRef,
  SelectAst,
  ToWhereExpr,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import type { CompiledQuery } from 'kysely';
import type { BuildKyselyPlanOptions } from './plan';
import { buildKyselyPlan } from './plan';

class LaneWhereExpr implements ToWhereExpr {
  readonly #bound: BoundWhereExpr;

  constructor(bound: BoundWhereExpr) {
    this.#bound = bound;
  }

  toWhereExpr(): BoundWhereExpr {
    return this.#bound;
  }
}

export function buildKyselyWhereExpr<Row>(
  contract: SqlContract<SqlStorage>,
  compiledQuery: CompiledQuery<Row>,
  options: BuildKyselyPlanOptions = {},
): ToWhereExpr {
  const plan = buildKyselyPlan(contract, compiledQuery, options);
  if (plan.ast.kind !== 'select' || !plan.ast.where) {
    throw new Error('whereExpr(...) requires a select query with a where clause');
  }

  const indexes = [...new Set(collectParamRefIndexes(plan.ast.where))].sort((a, b) => a - b);
  if (indexes.length === 0) {
    return new LaneWhereExpr({
      expr: plan.ast.where,
      params: [],
      paramDescriptors: [],
    });
  }

  const remap = new Map<number, number>(indexes.map((index, i) => [index, i + 1]));
  const remappedExpr = remapWhereParamIndexes(plan.ast.where, remap);
  const params = indexes.map((index) => {
    if (index <= 0 || index > plan.params.length) {
      throw new Error(`whereExpr(...) payload is invalid: missing param value for index ${index}`);
    }
    return plan.params[index - 1];
  });
  const paramDescriptors = indexes.map((index, i) => {
    const descriptor = findDescriptorByIndex(plan.meta.paramDescriptors, index);
    return {
      ...descriptor,
      index: i + 1,
    };
  });

  return new LaneWhereExpr({
    expr: remappedExpr,
    params,
    paramDescriptors,
  });
}

function findDescriptorByIndex(
  descriptors: readonly ParamDescriptor[],
  index: number,
): ParamDescriptor {
  const byArrayPosition = descriptors[index - 1];
  if (byArrayPosition) {
    return byArrayPosition;
  }
  const byExplicitIndex = descriptors.find((descriptor) => descriptor.index === index);
  if (byExplicitIndex) {
    return byExplicitIndex;
  }
  throw new Error(`whereExpr(...) payload is invalid: missing param descriptor for index ${index}`);
}

function remapParamIndex(index: number, remap: ReadonlyMap<number, number>): number {
  const remapped = remap.get(index);
  if (!remapped) {
    throw new Error(`whereExpr(...) payload is invalid: unknown ParamRef index ${index}`);
  }
  return remapped;
}

function remapWhereParamIndexes(expr: WhereExpr, remap: ReadonlyMap<number, number>): WhereExpr {
  switch (expr.kind) {
    case 'bin':
      return {
        ...expr,
        left: remapExpressionParamIndexes(expr.left, remap),
        right: remapComparableParamIndexes(expr.right, remap),
      };
    case 'nullCheck':
      return {
        ...expr,
        expr: remapExpressionParamIndexes(expr.expr, remap),
      };
    case 'and':
      return {
        ...expr,
        exprs: expr.exprs.map((child) => remapWhereParamIndexes(child, remap)),
      };
    case 'or':
      return {
        ...expr,
        exprs: expr.exprs.map((child) => remapWhereParamIndexes(child, remap)),
      };
    case 'exists':
      return {
        ...expr,
        subquery: remapSelectParamIndexes(expr.subquery, remap),
      };
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function remapExpressionParamIndexes(
  expr: Expression,
  remap: ReadonlyMap<number, number>,
): Expression {
  if (expr.kind !== 'operation') {
    return expr;
  }
  return {
    ...expr,
    args: expr.args.map((arg) => {
      if (arg.kind === 'param') {
        return {
          ...arg,
          index: remapParamIndex(arg.index, remap),
        };
      }
      if (arg.kind === 'literal') {
        return arg;
      }
      return remapExpressionParamIndexes(arg, remap);
    }),
  } as OperationExpr;
}

function remapComparableParamIndexes(
  value: Expression | ParamRef | ListLiteralExpr | { kind: 'literal'; value: unknown },
  remap: ReadonlyMap<number, number>,
): Expression | ParamRef | { kind: 'literal'; value: unknown } | ListLiteralExpr {
  if (value.kind === 'param') {
    return {
      ...value,
      index: remapParamIndex(value.index, remap),
    };
  }
  if (value.kind === 'literal') {
    return value;
  }
  if (value.kind === 'listLiteral') {
    return {
      ...value,
      values: value.values.map((entry) =>
        entry.kind === 'param' ? { ...entry, index: remapParamIndex(entry.index, remap) } : entry,
      ),
    };
  }
  return remapExpressionParamIndexes(value, remap);
}

function remapSelectParamIndexes(ast: SelectAst, remap: ReadonlyMap<number, number>): SelectAst {
  const joins = ast.joins?.map((join) => ({
    ...join,
    on: remapJoinOnParamIndexes(join.on, remap),
  }));
  const includes = ast.includes?.map((inc) => ({
    ...inc,
    child: {
      ...inc.child,
      ...(inc.child.where ? { where: remapWhereParamIndexes(inc.child.where, remap) } : {}),
      ...(inc.child.orderBy
        ? {
            orderBy: inc.child.orderBy.map((order) => ({
              ...order,
              expr: remapExpressionParamIndexes(order.expr, remap),
            })),
          }
        : {}),
      project: inc.child.project.map((projection) => ({
        ...projection,
        expr: remapExpressionParamIndexes(projection.expr, remap),
      })),
    },
  }));
  const project = ast.project.map((projection) => {
    if (projection.expr.kind === 'includeRef' || projection.expr.kind === 'literal') {
      return projection;
    }
    return {
      ...projection,
      expr: remapExpressionParamIndexes(projection.expr, remap),
    };
  });
  const where = ast.where ? remapWhereParamIndexes(ast.where, remap) : undefined;
  const orderBy = ast.orderBy?.map((order) => ({
    ...order,
    expr: remapExpressionParamIndexes(order.expr, remap),
  }));

  return {
    kind: ast.kind,
    from: ast.from,
    project,
    ...(joins ? { joins } : {}),
    ...(includes ? { includes } : {}),
    ...(where ? { where } : {}),
    ...(orderBy ? { orderBy } : {}),
    ...(ast.limit !== undefined ? { limit: ast.limit } : {}),
    ...(ast.selectAllIntent ? { selectAllIntent: ast.selectAllIntent } : {}),
  };
}

function remapJoinOnParamIndexes(
  joinOn: JoinOnExpr,
  remap: ReadonlyMap<number, number>,
): JoinOnExpr {
  if (joinOn.kind === 'eqCol') {
    return joinOn;
  }
  return remapWhereParamIndexes(joinOn, remap);
}

function collectParamRefIndexes(expr: WhereExpr): number[] {
  switch (expr.kind) {
    case 'bin':
      return [
        ...collectExpressionParamIndexes(expr.left),
        ...collectComparableParamIndexes(expr.right),
      ];
    case 'nullCheck':
      return collectExpressionParamIndexes(expr.expr);
    case 'and':
    case 'or':
      return expr.exprs.flatMap(collectParamRefIndexes);
    case 'exists':
      return collectSelectParamIndexes(expr.subquery);
    default: {
      const neverExpr: never = expr;
      throw new Error(`Unsupported where expression kind: ${String(neverExpr)}`);
    }
  }
}

function collectSelectParamIndexes(ast: SelectAst): number[] {
  const where = ast.where ? collectParamRefIndexes(ast.where) : [];
  const project = ast.project.flatMap((projection) => {
    if (projection.expr.kind === 'includeRef' || projection.expr.kind === 'literal') {
      return [];
    }
    return collectExpressionParamIndexes(projection.expr);
  });
  const orderBy = (ast.orderBy ?? []).flatMap((order) => collectExpressionParamIndexes(order.expr));
  const joins = (ast.joins ?? []).flatMap((join) => collectJoinOnParamIndexes(join.on));
  const includes = (ast.includes ?? []).flatMap((include) => {
    const childWhere = include.child.where ? collectParamRefIndexes(include.child.where) : [];
    const childOrder = (include.child.orderBy ?? []).flatMap((order) =>
      collectExpressionParamIndexes(order.expr),
    );
    const childProject = include.child.project.flatMap((projection) =>
      collectExpressionParamIndexes(projection.expr),
    );
    return [...childWhere, ...childOrder, ...childProject];
  });
  return [...where, ...project, ...orderBy, ...joins, ...includes];
}

function collectJoinOnParamIndexes(joinOn: JoinOnExpr): number[] {
  if (joinOn.kind === 'eqCol') {
    return [];
  }
  return collectParamRefIndexes(joinOn);
}

function collectExpressionParamIndexes(expr: Expression): number[] {
  if (expr.kind !== 'operation') {
    return [];
  }
  return expr.args.flatMap((arg) => {
    if (arg.kind === 'param') {
      return [arg.index];
    }
    if (arg.kind === 'literal') {
      return [];
    }
    return collectExpressionParamIndexes(arg);
  });
}

function collectComparableParamIndexes(
  value: Expression | ParamRef | ListLiteralExpr | { kind: 'literal'; value: unknown },
): number[] {
  if (value.kind === 'param') {
    return [value.index];
  }
  if (value.kind === 'literal') {
    return [];
  }
  if (value.kind === 'listLiteral') {
    return value.values.flatMap((item) => (item.kind === 'param' ? [item.index] : []));
  }
  return collectExpressionParamIndexes(value);
}
