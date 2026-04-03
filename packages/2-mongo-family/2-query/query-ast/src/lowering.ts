import type { Document } from '@prisma-next/mongo-core';
import { resolveValue } from '@prisma-next/mongo-core';
import type { MongoFilterExpr } from './filter-expressions';
import type { MongoReadStage } from './stages';

export function lowerFilter(filter: MongoFilterExpr): Document {
  switch (filter.kind) {
    case 'field':
      return { [filter.field]: { [filter.op]: resolveValue(filter.value) } };
    case 'and':
      return { $and: filter.exprs.map((e) => lowerFilter(e)) };
    case 'or':
      return { $or: filter.exprs.map((e) => lowerFilter(e)) };
    case 'not':
      return { $nor: [lowerFilter(filter.expr)] };
    case 'exists':
      return { [filter.field]: { $exists: filter.exists } };
  }
}

export function lowerStage(stage: MongoReadStage): Record<string, unknown> {
  switch (stage.kind) {
    case 'match':
      return { $match: lowerFilter(stage.filter) };
    case 'project':
      return { $project: { ...stage.projection } };
    case 'sort':
      return { $sort: { ...stage.sort } };
    case 'limit':
      return { $limit: stage.limit };
    case 'skip':
      return { $skip: stage.skip };
    case 'lookup': {
      const lookup: Record<string, unknown> = {
        from: stage.from,
        localField: stage.localField,
        foreignField: stage.foreignField,
        as: stage.as,
      };
      if (stage.pipeline) {
        lookup.pipeline = stage.pipeline.map((s) => lowerStage(s));
      }
      return { $lookup: lookup };
    }
    case 'unwind':
      return {
        $unwind: {
          path: stage.path,
          preserveNullAndEmptyArrays: stage.preserveNullAndEmptyArrays,
        },
      };
  }
}

export function lowerPipeline(
  stages: ReadonlyArray<MongoReadStage>,
): Array<Record<string, unknown>> {
  return stages.map((stage) => lowerStage(stage));
}
