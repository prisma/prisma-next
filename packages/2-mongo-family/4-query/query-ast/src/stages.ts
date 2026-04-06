import { MongoAstNode } from './ast-node';
import type { MongoFilterExpr } from './filter-expressions';
import type { MongoStageRewriterContext, MongoStageVisitor } from './visitors';

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
  readonly projection: Readonly<Record<string, 0 | 1>>;

  constructor(projection: Record<string, 0 | 1>) {
    super();
    this.projection = Object.freeze({ ...projection });
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.project(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
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
  readonly localField: string;
  readonly foreignField: string;
  readonly as: string;
  readonly pipeline: ReadonlyArray<MongoReadStage> | undefined;

  constructor(options: {
    from: string;
    localField: string;
    foreignField: string;
    as: string;
    pipeline?: ReadonlyArray<MongoReadStage>;
  }) {
    super();
    this.from = options.from;
    this.localField = options.localField;
    this.foreignField = options.foreignField;
    this.as = options.as;
    this.pipeline = options.pipeline ? Object.freeze([...options.pipeline]) : undefined;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.lookup(this);
  }

  rewrite(context: MongoStageRewriterContext): MongoReadStage {
    if (!this.pipeline) return this;
    return new MongoLookupStage({
      from: this.from,
      localField: this.localField,
      foreignField: this.foreignField,
      as: this.as,
      pipeline: this.pipeline.map((stage) => stage.rewrite(context)),
    });
  }
}

export class MongoUnwindStage extends MongoStageNode {
  readonly kind = 'unwind' as const;
  readonly path: string;
  readonly preserveNullAndEmptyArrays: boolean;

  constructor(path: string, preserveNullAndEmptyArrays: boolean) {
    super();
    this.path = path;
    this.preserveNullAndEmptyArrays = preserveNullAndEmptyArrays;
    this.freeze();
  }

  accept<R>(visitor: MongoStageVisitor<R>): R {
    return visitor.unwind(this);
  }

  rewrite(_context: MongoStageRewriterContext): MongoReadStage {
    return this;
  }
}

export type MongoReadStage =
  | MongoMatchStage
  | MongoProjectStage
  | MongoSortStage
  | MongoLimitStage
  | MongoSkipStage
  | MongoLookupStage
  | MongoUnwindStage;
