import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaCollectionOptionsNode } from './schema-collection-options';
import type { MongoSchemaIndex } from './schema-index';
import type { MongoSchemaValidator } from './schema-validator';

export type AnyMongoSchemaNode =
  | MongoSchemaCollection
  | MongoSchemaCollectionOptionsNode
  | MongoSchemaIndex
  | MongoSchemaValidator;
