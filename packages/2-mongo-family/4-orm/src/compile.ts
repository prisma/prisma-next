import type { PlanMeta } from '@prisma-next/contract/types';
import type { MongoReadPlan, MongoReadStage } from '@prisma-next/mongo-query-ast';
import {
  MongoAndExpr,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@prisma-next/mongo-query-ast';
import type { MongoCollectionState, MongoIncludeExpr } from './collection-state';

function compileIncludes(includes: readonly MongoIncludeExpr[]): MongoReadStage[] {
  const stages: MongoReadStage[] = [];

  for (const inc of includes) {
    stages.push(
      new MongoLookupStage({
        from: inc.from,
        localField: inc.localField,
        foreignField: inc.foreignField,
        as: inc.relationName,
      }),
    );

    if (inc.cardinality === 'N:1' || inc.cardinality === '1:1') {
      stages.push(new MongoUnwindStage(`$${inc.relationName}`, true));
    }
  }

  return stages;
}

export function compileMongoQuery<Row = unknown>(
  collection: string,
  state: MongoCollectionState,
  storageHash: string,
): MongoReadPlan<Row> {
  const stages: MongoReadStage[] = [];

  const singleFilter = state.filters.length === 1 ? state.filters[0] : undefined;
  if (singleFilter) {
    stages.push(new MongoMatchStage(singleFilter));
  } else if (state.filters.length > 1) {
    stages.push(new MongoMatchStage(MongoAndExpr.of([...state.filters])));
  }

  if (state.includes.length > 0) {
    stages.push(...compileIncludes(state.includes));
  }

  if (state.orderBy) {
    stages.push(new MongoSortStage(state.orderBy));
  }

  if (state.offset !== undefined) {
    stages.push(new MongoSkipStage(state.offset));
  }

  if (state.limit !== undefined) {
    stages.push(new MongoLimitStage(state.limit));
  }

  if (state.selectedFields) {
    const projection: Record<string, 1> = {};
    for (const field of state.selectedFields) {
      projection[field] = 1;
    }
    stages.push(new MongoProjectStage(projection));
  }

  const meta: PlanMeta = {
    target: 'mongo',
    storageHash,
    lane: 'mongo-orm',
    paramDescriptors: [],
  };
  return { collection, stages, meta };
}
