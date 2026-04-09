import type { MongoSchemaIndex } from './schema-index';
import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaCollectionOptions {
  readonly name: string;
  readonly indexes?: ReadonlyArray<MongoSchemaIndex>;
}

export class MongoSchemaCollection extends MongoSchemaNode {
  readonly kind = 'collection' as const;
  readonly name: string;
  readonly indexes: ReadonlyArray<MongoSchemaIndex>;

  constructor(options: MongoSchemaCollectionOptions) {
    super();
    this.name = options.name;
    this.indexes = options.indexes ?? [];
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.collection(this);
  }
}
