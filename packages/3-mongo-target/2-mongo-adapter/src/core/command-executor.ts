import type {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
} from '@prisma-next/mongo-query-ast/control';
import { keysToKeySpec } from '@prisma-next/mongo-query-ast/control';
import { type Db, type Document, MongoServerError } from 'mongodb';

export class MongoCommandExecutor implements MongoDdlCommandVisitor<Promise<void>> {
  constructor(private readonly db: Db) {}

  async createIndex(cmd: CreateIndexCommand): Promise<void> {
    const keySpec: Document = keysToKeySpec(cmd.keys);
    const options: Record<string, unknown> = {};
    if (cmd.unique !== undefined) options['unique'] = cmd.unique;
    if (cmd.sparse !== undefined) options['sparse'] = cmd.sparse;
    if (cmd.expireAfterSeconds !== undefined)
      options['expireAfterSeconds'] = cmd.expireAfterSeconds;
    if (cmd.partialFilterExpression !== undefined)
      options['partialFilterExpression'] = cmd.partialFilterExpression;
    if (cmd.name !== undefined) options['name'] = cmd.name;
    if (cmd.wildcardProjection !== undefined)
      options['wildcardProjection'] = cmd.wildcardProjection;
    if (cmd.collation !== undefined) options['collation'] = cmd.collation;
    if (cmd.weights !== undefined) options['weights'] = cmd.weights;
    if (cmd.default_language !== undefined) options['default_language'] = cmd.default_language;
    if (cmd.language_override !== undefined) options['language_override'] = cmd.language_override;
    await this.db.collection(cmd.collection).createIndex(keySpec, options);
  }

  async dropIndex(cmd: DropIndexCommand): Promise<void> {
    await this.db.collection(cmd.collection).dropIndex(cmd.name);
  }

  async createCollection(cmd: CreateCollectionCommand): Promise<void> {
    const options: Record<string, unknown> = {};
    if (cmd.capped !== undefined) options['capped'] = cmd.capped;
    if (cmd.size !== undefined) options['size'] = cmd.size;
    if (cmd.max !== undefined) options['max'] = cmd.max;
    if (cmd.timeseries !== undefined) options['timeseries'] = cmd.timeseries;
    if (cmd.collation !== undefined) options['collation'] = cmd.collation;
    if (cmd.clusteredIndex !== undefined) options['clusteredIndex'] = cmd.clusteredIndex;
    if (cmd.validator !== undefined) options['validator'] = cmd.validator;
    if (cmd.validationLevel !== undefined) options['validationLevel'] = cmd.validationLevel;
    if (cmd.validationAction !== undefined) options['validationAction'] = cmd.validationAction;
    if (cmd.changeStreamPreAndPostImages !== undefined)
      options['changeStreamPreAndPostImages'] = cmd.changeStreamPreAndPostImages;
    await this.db.createCollection(cmd.collection, options);
  }

  async dropCollection(cmd: DropCollectionCommand): Promise<void> {
    await this.db.collection(cmd.collection).drop();
  }

  async collMod(cmd: CollModCommand): Promise<void> {
    const command: Record<string, unknown> = { collMod: cmd.collection };
    if (cmd.validator !== undefined) command['validator'] = cmd.validator;
    if (cmd.validationLevel !== undefined) command['validationLevel'] = cmd.validationLevel;
    if (cmd.validationAction !== undefined) command['validationAction'] = cmd.validationAction;
    if (cmd.changeStreamPreAndPostImages !== undefined)
      command['changeStreamPreAndPostImages'] = cmd.changeStreamPreAndPostImages;
    await this.db.command(command);
  }
}

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
