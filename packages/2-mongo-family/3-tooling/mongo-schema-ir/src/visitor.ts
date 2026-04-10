import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaCollectionOptions } from './schema-collection-options';
import type { MongoSchemaIndex } from './schema-index';
import type { MongoSchemaValidator } from './schema-validator';

export interface MongoSchemaVisitor<R> {
  collection(node: MongoSchemaCollection): R;
  index(node: MongoSchemaIndex): R;
  validator(node: MongoSchemaValidator): R;
  collectionOptions(node: MongoSchemaCollectionOptions): R;
}
