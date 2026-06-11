import type {
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoInspectionCommandVisitor,
} from '@prisma-next/mongo-query-ast/control';
import { type Db, type Document, MongoServerError } from 'mongodb';

export class MongoInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Document[]>> {
  constructor(private readonly db: Db) {}

  async listIndexes(cmd: ListIndexesCommand): Promise<Document[]> {
    try {
      return await this.db.collection(cmd.collection).listIndexes().toArray();
    } catch (error: unknown) {
      if (error instanceof MongoServerError && error.code === 26) {
        return [];
      }
      throw error;
    }
  }

  async listCollections(_cmd: ListCollectionsCommand): Promise<Document[]> {
    return this.db.listCollections().toArray();
  }
}
