import type { MongoDriver } from '@prisma-next/mongo-lowering';
import type {
  AggregateWireCommand,
  AnyMongoWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import type { Db } from 'mongodb';

export class MigrationMongoDriver implements MongoDriver {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  execute<Row = Record<string, unknown>>(wireCommand: AnyMongoWireCommand): AsyncIterable<Row> {
    switch (wireCommand.kind) {
      case 'insertOne':
        return this.#insertOne(wireCommand) as AsyncIterable<Row>;
      case 'insertMany':
        return this.#insertMany(wireCommand) as AsyncIterable<Row>;
      case 'updateOne':
        return this.#updateOne(wireCommand) as AsyncIterable<Row>;
      case 'updateMany':
        return this.#updateMany(wireCommand) as AsyncIterable<Row>;
      case 'deleteOne':
        return this.#deleteOne(wireCommand) as AsyncIterable<Row>;
      case 'deleteMany':
        return this.#deleteMany(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndUpdate':
        return this.#findOneAndUpdate(wireCommand) as AsyncIterable<Row>;
      case 'findOneAndDelete':
        return this.#findOneAndDelete(wireCommand) as AsyncIterable<Row>;
      case 'aggregate':
        return this.#aggregate<Row>(wireCommand);
      default: {
        const _exhaustive: never = wireCommand;
        throw new Error(`Unknown wire command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }

  async close(): Promise<void> {
    // Connection lifecycle managed externally
  }

  async *#insertOne(cmd: InsertOneWireCommand) {
    const result = await this.#db.collection(cmd.collection).insertOne(cmd.document);
    yield { insertedId: result.insertedId };
  }

  async *#insertMany(cmd: InsertManyWireCommand) {
    const result = await this.#db
      .collection(cmd.collection)
      .insertMany(cmd.documents as Record<string, unknown>[]);
    yield { insertedIds: Object.values(result.insertedIds), insertedCount: result.insertedCount };
  }

  async *#updateOne(cmd: UpdateOneWireCommand) {
    const result = await this.#db.collection(cmd.collection).updateOne(cmd.filter, cmd.update);
    yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async *#updateMany(cmd: UpdateManyWireCommand) {
    const result = await this.#db.collection(cmd.collection).updateMany(cmd.filter, cmd.update);
    yield { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount };
  }

  async *#deleteOne(cmd: DeleteOneWireCommand) {
    const result = await this.#db.collection(cmd.collection).deleteOne(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  async *#deleteMany(cmd: DeleteManyWireCommand) {
    const result = await this.#db.collection(cmd.collection).deleteMany(cmd.filter);
    yield { deletedCount: result.deletedCount };
  }

  async *#findOneAndUpdate(cmd: FindOneAndUpdateWireCommand) {
    const result = await this.#db
      .collection(cmd.collection)
      .findOneAndUpdate(cmd.filter, cmd.update, {
        returnDocument: 'after',
        upsert: cmd.upsert,
      });
    if (result) yield result as Record<string, unknown>;
  }

  async *#findOneAndDelete(cmd: FindOneAndDeleteWireCommand) {
    const result = await this.#db.collection(cmd.collection).findOneAndDelete(cmd.filter);
    if (result) yield result as Record<string, unknown>;
  }

  async *#aggregate<Row>(cmd: AggregateWireCommand): AsyncIterable<Row> {
    const cursor = this.#db
      .collection(cmd.collection)
      .aggregate(cmd.pipeline as Record<string, unknown>[]);
    yield* cursor as AsyncIterable<Row>;
  }
}
