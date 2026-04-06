import type {
  AggregatePipelineEntry,
  MongoAggExpr,
  MongoAggExprVisitor,
  MongoFilterExpr,
  MongoReadStage,
} from '@prisma-next/mongo-query-ast';
import type { Document } from '@prisma-next/mongo-value';
import { resolveValue } from './resolve-value';

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
    const loweredArgs = Array.isArray(args) ? args.map((a) => lowerAggExpr(a)) : lowerAggExpr(args);
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
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value).some((k) => k.startsWith('$'));
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
        lookup['pipeline'] = stage.pipeline.map((s) => lowerStage(s));
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

function isTypedStage(entry: AggregatePipelineEntry): entry is MongoReadStage {
  return typeof (entry as MongoReadStage).kind === 'string' && 'accept' in entry;
}

export function lowerPipeline(
  entries: ReadonlyArray<AggregatePipelineEntry>,
): Array<Record<string, unknown>> {
  return entries.map((entry) => (isTypedStage(entry) ? lowerStage(entry) : { ...entry }));
}
