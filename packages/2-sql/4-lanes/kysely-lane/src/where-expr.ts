import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type BoundWhereExpr,
  ListLiteralExpr,
  type SelectAst,
  type ToWhereExpr,
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

  const indexes = [...new Set(collectParamIndexes(plan.ast.where))].sort((a, b) => a - b);
  if (indexes.length === 0) {
    return new LaneWhereExpr({
      expr: plan.ast.where,
      params: [],
      paramDescriptors: [],
    });
  }

  const remap = new Map<number, number>(indexes.map((index, i) => [index, i + 1]));
  const remappedExpr = remapParamIndexes(plan.ast.where, remap);
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

function remapParamIndexes(
  expr: BoundWhereExpr['expr'],
  remap: ReadonlyMap<number, number>,
): BoundWhereExpr['expr'] {
  return expr.rewrite({
    paramRef: (paramRef) => {
      const newIndex = remap.get(paramRef.index);
      if (newIndex === undefined) {
        throw new Error(
          `whereExpr(...) payload is invalid: unknown ParamRef index ${paramRef.index}`,
        );
      }
      return paramRef.withIndex(newIndex);
    },
    listLiteral: (list) =>
      new ListLiteralExpr(
        list.values.map((value) => {
          if (value.kind !== 'param-ref') {
            return value;
          }
          const newIndex = remap.get(value.index);
          if (newIndex === undefined) {
            throw new Error(
              `whereExpr(...) payload is invalid: unknown ParamRef index ${value.index}`,
            );
          }
          return value.withIndex(newIndex);
        }),
      ),
  });
}

function collectParamIndexes(expr: BoundWhereExpr['expr']): number[] {
  return expr.collectParamRefs().map((paramRef) => paramRef.index);
}
