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

  #resolveDocument(expr: MongoExpr): Document {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(expr)) {
      result[key] = resolveValue(val, this.#codecs);
    }
    return result;
  }

  #lowerUpdate(update: MongoUpdateSpec): Document | ReadonlyArray<Document> {
    if (isUpdatePipeline(update)) {
      return update.map((stage) => lowerStage(stage));
    }
    return this.#resolveDocument(update);
  }

  lower(plan: MongoQueryPlan): AnyMongoWireCommand {
    const { command } = plan;
    switch (command.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(
          command.collection,
          this.#resolveDocument(command.document),
        );
      case 'updateOne':
        return new UpdateOneWireCommand(
          command.collection,
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
          command.upsert,
        );
      case 'insertMany':
        return new InsertManyWireCommand(
          command.collection,
          command.documents.map((doc) => this.#resolveDocument(doc)),
        );
      case 'updateMany':
        return new UpdateManyWireCommand(
          command.collection,
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
          command.upsert,
        );
      case 'deleteOne':
        return new DeleteOneWireCommand(command.collection, lowerFilter(command.filter));
      case 'deleteMany':
        return new DeleteManyWireCommand(command.collection, lowerFilter(command.filter));
      case 'findOneAndUpdate':
        return new FindOneAndUpdateWireCommand(
          command.collection,
          lowerFilter(command.filter),
          this.#lowerUpdate(command.update),
          command.upsert,
        );
      case 'findOneAndDelete':
        return new FindOneAndDeleteWireCommand(command.collection, lowerFilter(command.filter));
      case 'aggregate':
        return new AggregateWireCommand(command.collection, lowerPipeline(command.pipeline));
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
        );
      case 'rawFindOneAndDelete':
        return new FindOneAndDeleteWireCommand(command.collection, command.filter);
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
