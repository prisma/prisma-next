import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaIndex } from './schema-index';

export interface MongoSchemaVisitor<R> {
  collection(node: MongoSchemaCollection): R;
  index(node: MongoSchemaIndex): R;
}
