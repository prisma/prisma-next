import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaCollectionOptionsNode } from './schema-collection-options';
import type { MongoSchemaIndex } from './schema-index';
import type { MongoSchemaValidator } from './schema-validator';

export interface MongoSchemaVisitor<R> {
  collection(node: MongoSchemaCollection): R;
  index(node: MongoSchemaIndex): R;
  validator(node: MongoSchemaValidator): R;
  collectionOptions(node: MongoSchemaCollectionOptionsNode): R;
}
