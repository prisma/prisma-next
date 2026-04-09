import type { MongoIndexKey } from '@prisma-next/mongo-contract';
import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaIndexOptions {
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique?: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;
}

export class MongoSchemaIndex extends MongoSchemaNode {
  readonly kind = 'index' as const;
  readonly keys: ReadonlyArray<MongoIndexKey>;
  readonly unique: boolean;
  readonly sparse?: boolean;
  readonly expireAfterSeconds?: number;
  readonly partialFilterExpression?: Record<string, unknown>;

  constructor(options: MongoSchemaIndexOptions) {
    super();
    this.keys = options.keys;
    this.unique = options.unique ?? false;
    if (options.sparse !== undefined) this.sparse = options.sparse;
    if (options.expireAfterSeconds !== undefined)
      this.expireAfterSeconds = options.expireAfterSeconds;
    if (options.partialFilterExpression !== undefined)
      this.partialFilterExpression = options.partialFilterExpression;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.index(this);
  }
}
