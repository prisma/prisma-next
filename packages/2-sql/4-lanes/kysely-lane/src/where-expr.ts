import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  type BoundWhereExpr,
  foldExpressionDeep,
  mapExpressionDeep,
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

  const collectIndexes = createParamIndexCollector();
  const indexes = [...new Set(collectIndexes.where(plan.ast.where))].sort((a, b) => a - b);
  if (indexes.length === 0) {
    return new LaneWhereExpr({
      expr: plan.ast.where,
      params: [],
      paramDescriptors: [],
    });
  }

  const remap = new Map<number, number>(indexes.map((index, i) => [index, i + 1]));
  const remapIndexes = createParamIndexRemapper(remap);
  const remappedExpr = remapIndexes.where(plan.ast.where);
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

function createParamIndexRemapper(remap: ReadonlyMap<number, number>) {
  return mapExpressionDeep({
    param: (p) => {
      const newIndex = remap.get(p.index);
      if (newIndex === undefined) {
        throw new Error(`whereExpr(...) payload is invalid: unknown ParamRef index ${p.index}`);
      }
      return { ...p, index: newIndex };
    },
    listLiteral: (list) => ({
      ...list,
      values: list.values.map((v) => {
        if (v.kind !== 'param') return v;
        const newIndex = remap.get(v.index);
        if (newIndex === undefined) {
          throw new Error(`whereExpr(...) payload is invalid: unknown ParamRef index ${v.index}`);
        }
        return { ...v, index: newIndex };
      }),
    }),
  });
}

function createParamIndexCollector() {
  return foldExpressionDeep<number[]>({
    empty: [],
    combine: (a, b) => [...a, ...b],
    param: (p) => [p.index],
    listLiteral: (list) => list.values.flatMap((v) => (v.kind === 'param' ? [v.index] : [])),
  });
}
