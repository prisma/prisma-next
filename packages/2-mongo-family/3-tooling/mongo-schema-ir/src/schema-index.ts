import type { MongoIndexKey } from '@prisma-next/mongo-contract';
import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaIndexOptions {
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean | undefined;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly wildcardProjection?: Record<string, 0 | 1> | undefined;
  readonly collation?: Record<string, unknown> | undefined;
  readonly weights?: Record<string, number> | undefined;
  readonly default_language?: string | undefined;
  readonly language_override?: string | undefined;
}

export class MongoSchemaIndex extends MongoSchemaNode {
  readonly kind = 'index' as const;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean | undefined;
  readonly expireAfterSeconds?: number | undefined;
  readonly partialFilterExpression?: Record<string, unknown> | undefined;
  readonly wildcardProjection?: Record<string, 0 | 1> | undefined;
  readonly collation?: Record<string, unknown> | undefined;
  readonly weights?: Record<string, number> | undefined;
  readonly default_language?: string | undefined;
  readonly language_override?: string | undefined;

  constructor(options: MongoSchemaIndexOptions) {
    super();
    this.keys = options.keys;
    this.unique = options.unique ?? false;
    this.sparse = options.sparse;
    this.expireAfterSeconds = options.expireAfterSeconds;
    this.partialFilterExpression = options.partialFilterExpression;
    this.wildcardProjection = options.wildcardProjection;
    this.collation = options.collation;
    this.weights = options.weights;
    this.default_language = options.default_language;
    this.language_override = options.language_override;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.index(this);
  }
}
