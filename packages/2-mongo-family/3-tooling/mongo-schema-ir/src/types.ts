import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaCollectionOptions } from './schema-collection-options';
import type { MongoSchemaIndex } from './schema-index';
import type { MongoSchemaValidator } from './schema-validator';

export type AnyMongoSchemaNode =
  | MongoSchemaCollection
  | MongoSchemaCollectionOptions
  | MongoSchemaIndex
  | MongoSchemaValidator;
