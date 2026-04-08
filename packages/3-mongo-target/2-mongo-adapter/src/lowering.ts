import type {
  MongoAggExpr,
  MongoAggExprVisitor,
  MongoFilterExpr,
  MongoGroupId,
  MongoPipelineStage,
  MongoProjectionValue,
  MongoWindowField,
} from '@prisma-next/mongo-query-ast';
import { isExprArray, isRecordArgs } from '@prisma-next/mongo-query-ast';
import type { Document } from '@prisma-next/mongo-value';
import { resolveValue } from './resolve-value';

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
    let loweredArgs: unknown;
    if (isExprArray(args)) {
      loweredArgs = args.map((a) => lowerAggExpr(a));
    } else if (isRecordArgs(args)) {
      loweredArgs = lowerExprRecord(args);
    } else {
      loweredArgs = lowerAggExpr(args);
    }
    return { [expr.op]: loweredArgs };
  },

  accumulator(expr) {
    if (expr.arg === null) {
      return { [expr.op]: {} };
    }
    if (isRecordArgs(expr.arg)) {
      return { [expr.op]: lowerExprRecord(expr.arg) };
    }
    return { [expr.op]: lowerAggExpr(expr.arg) };
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

function isAggExprNode(value: object): value is MongoAggExpr {
  return 'accept' in value && typeof value.accept === 'function';
}

function lowerGroupId(groupId: MongoGroupId): unknown {
  if (groupId === null) return null;
  if (isAggExprNode(groupId)) return lowerAggExpr(groupId);
  return lowerExprRecord(groupId);
}

function lowerExprRecord(
  fields: Readonly<Record<string, MongoAggExpr | ReadonlyArray<MongoAggExpr>>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(fields)) {
    if (Array.isArray(val)) {
      result[key] = val.map((v: MongoAggExpr) => lowerAggExpr(v));
    } else {
      result[key] = lowerAggExpr(val as MongoAggExpr);
    }
  }
  return result;
}

function lowerProjectionValue(value: MongoProjectionValue): unknown {
  if (typeof value === 'number') return value;
  return lowerAggExpr(value);
}

function lowerWindowField(wf: MongoWindowField): Record<string, unknown> {
  const lowered = lowerAggExpr(wf.operator);
  if (typeof lowered !== 'object' || lowered === null) {
    throw new Error('Window field operator must lower to an object');
  }
  const result: Record<string, unknown> = { ...lowered };
  if (wf.window) {
    result['window'] = { ...wf.window };
  }
  return result;
}

export function lowerStage(stage: MongoPipelineStage): Record<string, unknown> {
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
    case 'out':
      return { $out: stage.db ? { db: stage.db, coll: stage.collection } : stage.collection };
    case 'unionWith': {
      const unionWith: Record<string, unknown> = { coll: stage.collection };
      if (stage.pipeline) {
        unionWith['pipeline'] = stage.pipeline.map((s) => lowerStage(s));
      }
      return { $unionWith: unionWith };
    }
    case 'bucket': {
      const bucket: Record<string, unknown> = {
        groupBy: lowerAggExpr(stage.groupBy),
        boundaries: [...stage.boundaries],
      };
      if (stage.default_ !== undefined) bucket['default'] = stage.default_;
      if (stage.output) bucket['output'] = lowerExprRecord(stage.output);
      return { $bucket: bucket };
    }
    case 'bucketAuto': {
      const bucketAuto: Record<string, unknown> = {
        groupBy: lowerAggExpr(stage.groupBy),
        buckets: stage.buckets,
      };
      if (stage.output) bucketAuto['output'] = lowerExprRecord(stage.output);
      if (stage.granularity !== undefined) bucketAuto['granularity'] = stage.granularity;
      return { $bucketAuto: bucketAuto };
    }
    case 'geoNear': {
      const geoNear: Record<string, unknown> = {
        near: stage.near,
        distanceField: stage.distanceField,
      };
      if (stage.spherical !== undefined) geoNear['spherical'] = stage.spherical;
      if (stage.maxDistance !== undefined) geoNear['maxDistance'] = stage.maxDistance;
      if (stage.minDistance !== undefined) geoNear['minDistance'] = stage.minDistance;
      if (stage.query) geoNear['query'] = lowerFilter(stage.query);
      if (stage.key !== undefined) geoNear['key'] = stage.key;
      if (stage.distanceMultiplier !== undefined)
        geoNear['distanceMultiplier'] = stage.distanceMultiplier;
      if (stage.includeLocs !== undefined) geoNear['includeLocs'] = stage.includeLocs;
      return { $geoNear: geoNear };
    }
    case 'facet': {
      const facet: Record<string, unknown> = {};
      for (const [key, pipeline] of Object.entries(stage.facets)) {
        facet[key] = pipeline.map((s) => lowerStage(s));
      }
      return { $facet: facet };
    }
    case 'graphLookup': {
      const graphLookup: Record<string, unknown> = {
        from: stage.from,
        startWith: lowerAggExpr(stage.startWith),
        connectFromField: stage.connectFromField,
        connectToField: stage.connectToField,
        as: stage.as,
      };
      if (stage.maxDepth !== undefined) graphLookup['maxDepth'] = stage.maxDepth;
      if (stage.depthField !== undefined) graphLookup['depthField'] = stage.depthField;
      if (stage.restrictSearchWithMatch)
        graphLookup['restrictSearchWithMatch'] = lowerFilter(stage.restrictSearchWithMatch);
      return { $graphLookup: graphLookup };
    }
    case 'merge': {
      const merge: Record<string, unknown> = { into: stage.into };
      if (stage.on !== undefined) merge['on'] = stage.on;
      if (stage.whenMatched !== undefined) {
        merge['whenMatched'] = Array.isArray(stage.whenMatched)
          ? stage.whenMatched.map((s) => lowerStage(s))
          : stage.whenMatched;
      }
      if (stage.whenNotMatched !== undefined) merge['whenNotMatched'] = stage.whenNotMatched;
      return { $merge: merge };
    }
    case 'setWindowFields': {
      const swf: Record<string, unknown> = {};
      if (stage.partitionBy) swf['partitionBy'] = lowerAggExpr(stage.partitionBy);
      if (stage.sortBy) swf['sortBy'] = { ...stage.sortBy };
      const output: Record<string, unknown> = {};
      for (const [key, wf] of Object.entries(stage.output)) {
        output[key] = lowerWindowField(wf);
      }
      swf['output'] = output;
      return { $setWindowFields: swf };
    }
    case 'densify': {
      const densify: Record<string, unknown> = {
        field: stage.field,
        range: { ...stage.range },
      };
      if (stage.partitionByFields) densify['partitionByFields'] = [...stage.partitionByFields];
      return { $densify: densify };
    }
    case 'fill': {
      const fill: Record<string, unknown> = {};
      if (stage.partitionBy) fill['partitionBy'] = lowerAggExpr(stage.partitionBy);
      if (stage.partitionByFields) fill['partitionByFields'] = [...stage.partitionByFields];
      if (stage.sortBy) fill['sortBy'] = { ...stage.sortBy };
      const output: Record<string, unknown> = {};
      for (const [key, fo] of Object.entries(stage.output)) {
        const entry: Record<string, unknown> = {};
        if (fo.method !== undefined) entry['method'] = fo.method;
        if (fo.value !== undefined) entry['value'] = lowerAggExpr(fo.value);
        output[key] = entry;
      }
      fill['output'] = output;
      return { $fill: fill };
    }
    case 'search': {
      const search: Record<string, unknown> = { ...stage.config };
      if (stage.index !== undefined) search['index'] = stage.index;
      return { $search: search };
    }
    case 'searchMeta': {
      const searchMeta: Record<string, unknown> = { ...stage.config };
      if (stage.index !== undefined) searchMeta['index'] = stage.index;
      return { $searchMeta: searchMeta };
    }
    case 'vectorSearch': {
      const vs: Record<string, unknown> = {
        index: stage.index,
        path: stage.path,
        queryVector: [...stage.queryVector],
        numCandidates: stage.numCandidates,
        limit: stage.limit,
      };
      if (stage.filter) vs['filter'] = { ...stage.filter };
      return { $vectorSearch: vs };
    }
    default: {
      const _exhaustive: never = stage;
      throw new Error(`Unhandled stage kind: ${(_exhaustive as MongoPipelineStage).kind}`);
    }
  }
}

export function lowerPipeline(
  stages: ReadonlyArray<MongoPipelineStage>,
): Array<Record<string, unknown>> {
  return stages.map(lowerStage);
}
