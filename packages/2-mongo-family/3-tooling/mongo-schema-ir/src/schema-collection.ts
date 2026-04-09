import type { MongoSchemaCollectionOptionsNode } from './schema-collection-options';
import type { MongoSchemaIndex } from './schema-index';
import { MongoSchemaNode } from './schema-node';
import type { MongoSchemaValidator } from './schema-validator';
import type { MongoSchemaVisitor } from './visitor';

export interface MongoSchemaCollectionCtorOptions {
  readonly name: string;
  readonly indexes?: ReadonlyArray<MongoSchemaIndex>;
  readonly validator?: MongoSchemaValidator;
  readonly options?: MongoSchemaCollectionOptionsNode;
}

export class MongoSchemaCollection extends MongoSchemaNode {
  readonly kind = 'collection' as const;
  readonly name: string;
  readonly indexes: ReadonlyArray<MongoSchemaIndex>;
  readonly validator?: MongoSchemaValidator | undefined;
  readonly options?: MongoSchemaCollectionOptionsNode | undefined;

  constructor(options: MongoSchemaCollectionCtorOptions) {
    super();
    this.name = options.name;
    this.indexes = options.indexes ?? [];
    this.validator = options.validator;
    this.options = options.options;
    this.freeze();
  }

  accept<R>(visitor: MongoSchemaVisitor<R>): R {
    return visitor.collection(this);
  }
}
