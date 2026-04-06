import type {
  AggregatePipelineEntry,
  MongoAggExpr,
  MongoAggExprVisitor,
  MongoFilterExpr,
  MongoGroupId,
  MongoProjectionValue,
  MongoReadStage,
} from '@prisma-next/mongo-query-ast';
import type { Document } from '@prisma-next/mongo-value';
import { resolveValue } from './resolve-value';

function isExprArray(
  args: MongoAggExpr | ReadonlyArray<MongoAggExpr>,
): args is ReadonlyArray<MongoAggExpr> {
  return Array.isArray(args);
}

// Biome flags `{ then: ... }` as a thenable object (noThenProperty). Build via Object.fromEntries to avoid.
const THEN_KEY = 'then';

function condBranch(
  caseOrIf: MongoAggExpr,
  thenExpr: MongoAggExpr,
  elseExpr?: MongoAggExpr,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [
    [elseExpr ? 'if' : 'case', lowerAggExpr(caseOrIf)],
    [THEN_KEY, lowerAggExpr(thenExpr)],
  ];
  if (elseExpr) {
    entries.push(['else', lowerAggExpr(elseExpr)]);
  }
  return Object.fromEntries(entries);
}

const aggExprLoweringVisitor: MongoAggExprVisitor<unknown> = {
  fieldRef(expr) {
    return `$${expr.path}`;
  },

  literal(expr) {
    return needsLiteralWrap(expr.value) ? { $literal: expr.value } : expr.value;
  },

  operator(expr) {
    const { args } = expr;
    const loweredArgs = isExprArray(args) ? args.map((a) => lowerAggExpr(a)) : lowerAggExpr(args);
    return { [expr.op]: loweredArgs };
  },

  accumulator(expr) {
    return { [expr.op]: expr.arg ? lowerAggExpr(expr.arg) : {} };
  },

  cond(expr) {
    return { $cond: condBranch(expr.condition, expr.then_, expr.else_) };
  },

  switch_(expr) {
    return {
      $switch: {
        branches: expr.branches.map((b) => condBranch(b.case_, b.then_)),
        default: lowerAggExpr(expr.default_),
      },
    };
  },

  filter(expr) {
    return {
      $filter: {
        input: lowerAggExpr(expr.input),
        cond: lowerAggExpr(expr.cond),
        as: expr.as,
      },
    };
  },

  map(expr) {
    return {
      $map: {
        input: lowerAggExpr(expr.input),
        in: lowerAggExpr(expr.in_),
        as: expr.as,
      },
    };
  },

  reduce(expr) {
    return {
      $reduce: {
        input: lowerAggExpr(expr.input),
        initialValue: lowerAggExpr(expr.initialValue),
        in: lowerAggExpr(expr.in_),
      },
    };
  },

  let_(expr) {
    const vars: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(expr.vars)) {
      vars[key] = lowerAggExpr(val);
    }
    return { $let: { vars, in: lowerAggExpr(expr.in_) } };
  },

  mergeObjects(expr) {
    return { $mergeObjects: expr.exprs.map((e) => lowerAggExpr(e)) };
  },
};

function needsLiteralWrap(value: unknown): boolean {
  if (typeof value === 'string' && value.startsWith('$')) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((v) => needsLiteralWrap(v));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).some(
      ([k, v]) => k.startsWith('$') || needsLiteralWrap(v),
    );
  }
  return false;
}

export function lowerAggExpr(expr: MongoAggExpr): unknown {
  return expr.accept(aggExprLoweringVisitor);
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
      return { $nor: [lowerFilter(filter.expr)] };
    case 'exists':
      return { [filter.field]: { $exists: filter.exists } };
    case 'expr':
      return { $expr: lowerAggExpr(filter.aggExpr) };
    default: {
      const _exhaustive: never = filter;
      throw new Error(`Unhandled filter kind: ${(_exhaustive as MongoFilterExpr).kind}`);
    }
  }
}

function lowerGroupId(groupId: MongoGroupId): unknown {
  if (groupId === null) return null;
  if ('kind' in groupId) return lowerAggExpr(groupId as MongoAggExpr);
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(groupId)) {
    result[key] = lowerAggExpr(val);
  }
  return result;
}

function lowerExprRecord(fields: Readonly<Record<string, MongoAggExpr>>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = lowerAggExpr(val);
  }
  return result;
}

function lowerProjectionValue(value: MongoProjectionValue): unknown {
  if (typeof value === 'number') return value;
  return lowerAggExpr(value);
}

export function lowerStage(stage: MongoReadStage): Record<string, unknown> {
  switch (stage.kind) {
    case 'match':
      return { $match: lowerFilter(stage.filter) };
    case 'project': {
      const projection: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(stage.projection)) {
        projection[key] = lowerProjectionValue(val);
      }
      return { $project: projection };
    }
    case 'sort':
      return { $sort: { ...stage.sort } };
    case 'limit':
      return { $limit: stage.limit };
    case 'skip':
      return { $skip: stage.skip };
    case 'lookup': {
      const lookup: Record<string, unknown> = {
        from: stage.from,
        as: stage.as,
      };
      if (stage.localField !== undefined) lookup['localField'] = stage.localField;
      if (stage.foreignField !== undefined) lookup['foreignField'] = stage.foreignField;
      if (stage.pipeline) {
        lookup['pipeline'] = stage.pipeline.map((s) => lowerStage(s));
      }
      if (stage.let_) {
        lookup['let'] = lowerExprRecord(stage.let_);
      }
      return { $lookup: lookup };
    }
    case 'unwind': {
      const unwind: Record<string, unknown> = {
        path: stage.path,
        preserveNullAndEmptyArrays: stage.preserveNullAndEmptyArrays,
      };
      if (stage.includeArrayIndex !== undefined) {
        unwind['includeArrayIndex'] = stage.includeArrayIndex;
      }
      return { $unwind: unwind };
    }
    case 'group': {
      const group: Record<string, unknown> = { _id: lowerGroupId(stage.groupId) };
      for (const [key, acc] of Object.entries(stage.accumulators)) {
        group[key] = lowerAggExpr(acc);
      }
      return { $group: group };
    }
    case 'addFields':
      return { $addFields: lowerExprRecord(stage.fields) };
    case 'replaceRoot':
      return { $replaceRoot: { newRoot: lowerAggExpr(stage.newRoot) } };
    case 'count':
      return { $count: stage.field };
    case 'sortByCount':
      return { $sortByCount: lowerAggExpr(stage.expr) };
    case 'sample':
      return { $sample: { size: stage.size } };
    case 'redact':
      return { $redact: lowerAggExpr(stage.expr) };
  }
}

function isTypedStage(entry: AggregatePipelineEntry): entry is MongoReadStage {
  return typeof (entry as MongoReadStage).kind === 'string' && 'accept' in entry;
}

export function lowerPipeline(
  entries: ReadonlyArray<AggregatePipelineEntry>,
): Array<Record<string, unknown>> {
  return entries.map((entry) => (isTypedStage(entry) ? lowerStage(entry) : { ...entry }));
}
