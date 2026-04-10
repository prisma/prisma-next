import type { CreateIndexCommand, DropIndexCommand } from './ddl-commands';
import type { ListCollectionsCommand, ListIndexesCommand } from './inspection-commands';

export interface MongoDdlCommandVisitor<R> {
  createIndex(command: CreateIndexCommand): R;
  dropIndex(command: DropIndexCommand): R;
}

export interface MongoInspectionCommandVisitor<R> {
  listIndexes(command: ListIndexesCommand): R;
  listCollections(command: ListCollectionsCommand): R;
}
