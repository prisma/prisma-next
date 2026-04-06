import type { MongoAggAccumulator, MongoAggExpr } from './aggregation-expressions';
import { MongoAstNode } from './ast-node';
import type { MongoFilterExpr } from './filter-expressions';
import type {
  MongoAggExprRewriter,
  MongoStageRewriterContext,
  MongoStageVisitor,
} from './visitors';

export type MongoGroupId = null | MongoAggExpr | Readonly<Record<string, MongoAggExpr>>;
export type MongoProjectionValue = 0 | 1 | MongoAggExpr;

function isAggExpr(value: MongoProjectionValue): value is MongoAggExpr {
  return typeof value === 'object' && value !== null && 'kind' in value;
}

function rewriteGroupId(groupId: MongoGroupId, rewriter: MongoAggExprRewriter): MongoGroupId {
  if (groupId === null) return null;
  if ('kind' in groupId) return (groupId as MongoAggExpr).rewrite(rewriter);
  const result: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(groupId)) {
    result[key] = val.rewrite(rewriter);
  }
  return result;
}

function rewriteExprRecord(
  fields: Readonly<Record<string, MongoAggExpr>>,
  rewriter: MongoAggExprRewriter,
): Record<string, MongoAggExpr> {
  const result: Record<string, MongoAggExpr> = {};
  for (const [key, val] of Object.entries(fields)) {
    result[key] = val.rewrite(rewriter);
  }
  return result;
}

abstract class MongoStageNode extends MongoAstNode {
  abstract accept<R>(visitor: MongoStageVisitor<R>): R;
  abstract rewrite(context: MongoStageRewriterContext): MongoReadStage;
}

export class MongoMatchStage extends MongoStageNode {
  readonly kind = 'match' as const;
  readonly filter: MongoFilterExpr;

  constructor(filter: MongoFilterExpr) {
    super();
    this.filter = filter;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.match(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    return new MongoMatchStage(this.filter.rewrite(context.filter ?? {}));
  }
}

export class MongoProjectStage extends MongoStageNode {
  readonly kind = 'project' as const;
  readonly projection: Readonly<Record<string, MongoProjectionValue>>;

  constructor(projection: Record<string, MongoProjectionValue>) {
    super();
    this.projection = Object.freeze({ ...projection });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.project(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    let hasExpr = false;
    for (const val of Object.values(this.projection)) {
      if (isAggExpr(val)) {
        hasExpr = true;
        break;
      }
    }
    if (!hasExpr) return this;
    const newProjection: Record<string, MongoProjectionValue> = {};
    for (const [key, val] of Object.entries(this.projection)) {
      newProjection[key] = isAggExpr(val) ? val.rewrite(rewriter) : val;
    }
    return new MongoProjectStage(newProjection);
  }
}

export class MongoSortStage extends MongoStageNode {
  readonly kind = 'sort' as const;
  readonly sort: Readonly<Record<string, 1 | -1>>;

  constructor(sort: Record<string, 1 | -1>) {
    super();
    this.sort = Object.freeze({ ...sort });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sort(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoLimitStage extends MongoStageNode {
  readonly kind = 'limit' as const;
  readonly limit: number;

  constructor(limit: number) {
    super();
    if (!Number.isInteger(limit) || limit < 0) {
      throw new RangeError('limit must be a non-negative integer');
    }
    this.limit = limit;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.limit(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoSkipStage extends MongoStageNode {
  readonly kind = 'skip' as const;
  readonly skip: number;

  constructor(skip: number) {
    super();
    if (!Number.isInteger(skip) || skip < 0) {
      throw new RangeError('skip must be a non-negative integer');
    }
    this.skip = skip;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.skip(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoLookupStage extends MongoStageNode {
  readonly kind = 'lookup' as const;
  readonly from: string;
  readonly localField: string | undefined;
  readonly foreignField: string | undefined;
  readonly as: string;
  readonly pipeline: ReadonlyArray<MongoReadStage> | undefined;
  readonly let_: Readonly<Record<string, MongoAggExpr>> | undefined;

  constructor(options: {
    from: string;
    localField?: string;
    foreignField?: string;
    as: string;
    pipeline?: ReadonlyArray<MongoReadStage>;
    let_?: Record<string, MongoAggExpr>;
  }) {
    super();
    this.from = options.from;
    this.localField = options.localField;
    this.foreignField = options.foreignField;
    this.as = options.as;
    this.pipeline = options.pipeline ? Object.freeze([...options.pipeline]) : undefined;
    this.let_ = options.let_ ? Object.freeze({ ...options.let_ }) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.lookup(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    if (!this.pipeline && !this.let_) return this;
    const rewrittenLet =
      this.let_ && context.aggExpr ? rewriteExprRecord(this.let_, context.aggExpr) : this.let_;
    const options: {
      from: string;
      localField?: string;
      foreignField?: string;
      as: string;
      pipeline?: ReadonlyArray<MongoReadStage>;
      let_?: Record<string, MongoAggExpr>;
    } = { from: this.from, as: this.as };
    if (this.localField !== undefined) options.localField = this.localField;
    if (this.foreignField !== undefined) options.foreignField = this.foreignField;
    if (this.pipeline) options.pipeline = this.pipeline.map((stage) => stage.rewrite(context));
    if (rewrittenLet) options.let_ = { ...rewrittenLet };
    return new MongoLookupStage(options);
  }
}

export class MongoUnwindStage extends MongoStageNode {
  readonly kind = 'unwind' as const;
  readonly path: string;
  readonly preserveNullAndEmptyArrays: boolean;
  readonly includeArrayIndex: string | undefined;

  constructor(path: string, preserveNullAndEmptyArrays: boolean, includeArrayIndex?: string) {
    super();
    this.path = path;
    this.preserveNullAndEmptyArrays = preserveNullAndEmptyArrays;
    this.includeArrayIndex = includeArrayIndex;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.unwind(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoGroupStage extends MongoStageNode {
  readonly kind = 'group' as const;
  readonly groupId: MongoGroupId;
  readonly accumulators: Readonly<Record<string, MongoAggAccumulator>>;

  constructor(groupId: MongoGroupId, accumulators: Record<string, MongoAggAccumulator>) {
    super();
    this.groupId = groupId;
    this.accumulators = Object.freeze({ ...accumulators });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.group(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    const newAccumulators: Record<string, MongoAggAccumulator> = {};
    for (const [key, acc] of Object.entries(this.accumulators)) {
      newAccumulators[key] = acc.rewrite(rewriter) as MongoAggAccumulator;
    }
    return new MongoGroupStage(rewriteGroupId(this.groupId, rewriter), newAccumulators);
  }
}

export class MongoAddFieldsStage extends MongoStageNode {
  readonly kind = 'addFields' as const;
  readonly fields: Readonly<Record<string, MongoAggExpr>>;

  constructor(fields: Record<string, MongoAggExpr>) {
    super();
    this.fields = Object.freeze({ ...fields });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.addFields(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoAddFieldsStage(rewriteExprRecord(this.fields, rewriter));
  }
}

export class MongoReplaceRootStage extends MongoStageNode {
  readonly kind = 'replaceRoot' as const;
  readonly newRoot: MongoAggExpr;

  constructor(newRoot: MongoAggExpr) {
    super();
    this.newRoot = newRoot;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.replaceRoot(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoReplaceRootStage(this.newRoot.rewrite(rewriter));
  }
}

export class MongoCountStage extends MongoStageNode {
  readonly kind = 'count' as const;
  readonly field: string;

  constructor(field: string) {
    super();
    this.field = field;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.count(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoSortByCountStage extends MongoStageNode {
  readonly kind = 'sortByCount' as const;
  readonly expr: MongoAggExpr;

  constructor(expr: MongoAggExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sortByCount(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoSortByCountStage(this.expr.rewrite(rewriter));
  }
}

export class MongoSampleStage extends MongoStageNode {
  readonly kind = 'sample' as const;
  readonly size: number;

  constructor(size: number) {
    super();
    if (!Number.isInteger(size) || size < 0) {
      throw new RangeError('size must be a non-negative integer');
    }
    this.size = size;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.sample(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export class MongoRedactStage extends MongoStageNode {
  readonly kind = 'redact' as const;
  readonly expr: MongoAggExpr;

  constructor(expr: MongoAggExpr) {
    super();
    this.expr = expr;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.redact(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    const rewriter = context.aggExpr;
    if (!rewriter) return this;
    return new MongoRedactStage(this.expr.rewrite(rewriter));
  }
}

export type MongoReadStage =
  | MongoMatchStage
  | MongoProjectStage
  | MongoSortStage
  | MongoLimitStage
  | MongoSkipStage
  | MongoLookupStage
  | MongoUnwindStage
  | MongoGroupStage
  | MongoAddFieldsStage
  | MongoReplaceRootStage
  | MongoCountStage
  | MongoSortByCountStage
  | MongoSampleStage
  | MongoRedactStage;
