import type {
  BoundWhereExpr,
  ToWhereExpr,
  WhereArg,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { foldExpressionDeep } from '@prisma-next/sql-relational-core/ast';

export function normalizeWhereArg(arg: undefined): undefined;
export function normalizeWhereArg(arg: WhereArg): BoundWhereExpr;
export function normalizeWhereArg(arg: WhereArg | undefined): BoundWhereExpr | undefined;
export function normalizeWhereArg(arg: WhereArg | undefined): BoundWhereExpr | undefined {
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
    return {
      expr: bound.expr,
      params: [...bound.params],
      paramDescriptors: bound.paramDescriptors.map((descriptor, index) => ({
        ...descriptor,
        index: index + 1,
      })),
    };
  }

  assertBareWhereExprIsParamFree(arg);
  return {
    expr: arg,
    params: [],
    paramDescriptors: [],
  };
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

const detector = foldExpressionDeep<boolean>({
  empty: false,
  combine: (a, b) => a || b,
  isAbsorbing: (v) => v,
  param: () => true,
  listLiteral: (list) => list.values.some((v) => v.kind === 'param'),
});

function whereExprContainsParamRef(expr: WhereExpr): boolean {
  return detector.where(expr);
}

const collector = foldExpressionDeep<number[]>({
  empty: [],
  combine: (a, b) => [...a, ...b],
  param: (p) => [p.index],
  listLiteral: (list) => list.values.flatMap((v) => (v.kind === 'param' ? [v.index] : [])),
});

function collectParamRefIndexes(expr: WhereExpr): number[] {
  return collector.where(expr);
}
