import type { MongoSchemaCollection } from './schema-collection';

export interface MongoSchemaIR {
  readonly collections: Record<string, MongoSchemaCollection>;
}
