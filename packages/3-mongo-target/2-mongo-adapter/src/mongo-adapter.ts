import { createMongoCodecRegistry, type MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoAdapter } from '@prisma-next/mongo-lowering';
import type {
  MongoQueryPlan,
  MongoUpdatePipelineStage,
  MongoUpdateSpec,
} from '@prisma-next/mongo-query-ast/execution';
import type { Document, MongoExpr } from '@prisma-next/mongo-value';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';
import {
  AggregateWireCommand,
  DeleteManyWireCommand,
  DeleteOneWireCommand,
  FindOneAndDeleteWireCommand,
  FindOneAndUpdateWireCommand,
  InsertManyWireCommand,
  InsertOneWireCommand,
  UpdateManyWireCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-wire';
import { lowerFilter, lowerPipeline, lowerStage } from './lowering';
import { resolveValue } from './resolve-value';

function isUpdatePipeline(
  update: MongoUpdateSpec,
): update is ReadonlyArray<MongoUpdatePipelineStage> {
  return Array.isArray(update);
}

class MongoAdapterImpl implements MongoAdapter {
  readonly #codecs: MongoCodecRegistry | undefined;

  constructor(codecs?: MongoCodecRegistry) {
    this.#codecs = codecs;
  }

  async #resolveDocument(expr: MongoExpr): Promise<Document> {
    const entries = Object.entries(expr);
    const resolved = await Promise.all(entries.map(([, val]) => resolveValue(val, this.#codecs)));
    const result: Record<string, unknown> = {};
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry) {
        result[entry[0]] = resolved[i];
      }
    }
    return result;
  }

  async #lowerUpdate(update: MongoUpdateSpec): Promise<Document | ReadonlyArray<Document>> {
    if (isUpdatePipeline(update)) {
      return Promise.all(update.map((stage) => lowerStage(stage)));
    }
    return this.#resolveDocument(update);
  }

  async lower(plan: MongoQueryPlan): Promise<AnyMongoWireCommand> {
    const { command } = plan;
    switch (command.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(
          command.collection,
          await this.#resolveDocument(command.document),
        );
      case 'updateOne': {
        const [filter, update] = await Promise.all([
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
        ]);
        return new UpdateOneWireCommand(command.collection, filter, update, command.upsert);
      }
      case 'insertMany':
        return new InsertManyWireCommand(
          command.collection,
          await Promise.all(command.documents.map((doc) => this.#resolveDocument(doc))),
        );
      case 'updateMany': {
        const [filter, update] = await Promise.all([
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
        ]);
        return new UpdateManyWireCommand(command.collection, filter, update, command.upsert);
      }
      case 'deleteOne':
        return new DeleteOneWireCommand(command.collection, await lowerFilter(command.filter));
      case 'deleteMany':
        return new DeleteManyWireCommand(command.collection, await lowerFilter(command.filter));
      case 'findOneAndUpdate': {
        const [filter, update] = await Promise.all([
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
        ]);
        return new FindOneAndUpdateWireCommand(
          command.collection,
          filter,
          update,
          command.upsert,
          command.sort,
          command.returnDocument,
        );
      }
      case 'findOneAndDelete':
        return new FindOneAndDeleteWireCommand(
          command.collection,
          await lowerFilter(command.filter),
          command.sort,
        );
      case 'aggregate':
        return new AggregateWireCommand(command.collection, await lowerPipeline(command.pipeline));
      case 'rawAggregate':
        return new AggregateWireCommand(command.collection, command.pipeline);
      case 'rawInsertOne':
        return new InsertOneWireCommand(command.collection, command.document);
      case 'rawInsertMany':
        return new InsertManyWireCommand(command.collection, command.documents);
      case 'rawUpdateOne':
        return new UpdateOneWireCommand(command.collection, command.filter, command.update);
      case 'rawUpdateMany':
        return new UpdateManyWireCommand(command.collection, command.filter, command.update);
      case 'rawDeleteOne':
        return new DeleteOneWireCommand(command.collection, command.filter);
      case 'rawDeleteMany':
        return new DeleteManyWireCommand(command.collection, command.filter);
      case 'rawFindOneAndUpdate':
        return new FindOneAndUpdateWireCommand(
          command.collection,
          command.filter,
          command.update,
          command.upsert,
          command.sort,
          command.returnDocument,
        );
      case 'rawFindOneAndDelete':
        return new FindOneAndDeleteWireCommand(command.collection, command.filter, command.sort);
      // v8 ignore next 4
      default: {
        const _exhaustive: never = command;
        throw new Error(`Unknown command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }
}

import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoDoubleCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from './core/codecs';

function defaultCodecRegistry(): MongoCodecRegistry {
  const registry = createMongoCodecRegistry();
  for (const codec of [
    mongoObjectIdCodec,
    mongoStringCodec,
    mongoDoubleCodec,
    mongoInt32Codec,
    mongoBooleanCodec,
    mongoDateCodec,
    mongoVectorCodec,
  ]) {
    registry.register(codec);
  }
  return registry;
}

export function createMongoAdapter(codecs?: MongoCodecRegistry): MongoAdapter {
  return new MongoAdapterImpl(codecs ?? defaultCodecRegistry());
}
