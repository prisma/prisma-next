import type { MongoSchemaCollection } from './schema-collection';
import type { MongoSchemaIndex } from './schema-index';

export type AnyMongoSchemaNode = MongoSchemaCollection | MongoSchemaIndex;
