import type {
  CreateIndexCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
} from '@prisma-next/mongo-query-ast/control';
import { keysToKeySpec } from '@prisma-next/mongo-query-ast/control';
import type { Db, Document } from 'mongodb';

export class MongoCommandExecutor implements MongoDdlCommandVisitor<Promise<void>> {
  constructor(private readonly db: Db) {}

  async createIndex(cmd: CreateIndexCommand): Promise<void> {
    const keySpec = keysToKeySpec(cmd.keys);
    const options: Record<string, unknown> = {};
    if (cmd.unique !== undefined) options['unique'] = cmd.unique;
    if (cmd.sparse !== undefined) options['sparse'] = cmd.sparse;
    if (cmd.expireAfterSeconds !== undefined)
      options['expireAfterSeconds'] = cmd.expireAfterSeconds;
    if (cmd.partialFilterExpression !== undefined)
      options['partialFilterExpression'] = cmd.partialFilterExpression;
    if (cmd.name !== undefined) options['name'] = cmd.name;
    await this.db.collection(cmd.collection).createIndex(keySpec, options);
  }

  async dropIndex(cmd: DropIndexCommand): Promise<void> {
    await this.db.collection(cmd.collection).dropIndex(cmd.name);
  }
}

export class MongoInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Document[]>> {
  constructor(private readonly db: Db) {}

  async listIndexes(cmd: ListIndexesCommand): Promise<Document[]> {
    try {
      return await this.db.collection(cmd.collection).listIndexes().toArray();
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('ns does not exist')) {
        return [];
      }
      throw error;
    }
  }

  async listCollections(_cmd: ListCollectionsCommand): Promise<Document[]> {
    return this.db.listCollections().toArray();
  }
}
