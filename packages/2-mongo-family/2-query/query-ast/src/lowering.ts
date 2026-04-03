import type { Document, MongoValue } from '@prisma-next/mongo-core';
import { MongoParamRef } from '@prisma-next/mongo-core';
import type { MongoFilterExpr } from './filter-expressions';
import type { MongoReadStage } from './stages';

function resolveValue(value: MongoValue): unknown {
  if (value instanceof MongoParamRef) {
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = resolveValue(val);
  }
  return result;
}

export function lowerFilter(filter: MongoFilterExpr): Document {
  switch (filter.kind) {
    case 'field':
      return { [filter.field]: { [filter.op]: resolveValue(filter.value) } };
    case 'and':
      return { $and: filter.exprs.map((e) => lowerFilter(e)) };
    case 'or':
      return { $or: filter.exprs.map((e) => lowerFilter(e)) };
    case 'not':
      return { $not: lowerFilter(filter.expr) };
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
