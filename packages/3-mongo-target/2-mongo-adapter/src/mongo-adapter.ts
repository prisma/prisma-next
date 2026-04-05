import type { MongoAdapter, MongoQueryPlanLike } from '@prisma-next/mongo-lowering';
import type { AnyMongoCommand } from '@prisma-next/mongo-query-ast';
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
import { lowerFilter, lowerPipeline } from './lowering';
import { resolveValue } from './resolve-value';

function resolveDocument(expr: MongoExpr): Document {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(expr)) {
    result[key] = resolveValue(val);
  }
  return result;
}

class MongoAdapterImpl implements MongoAdapter {
  lower(plan: MongoQueryPlanLike): AnyMongoWireCommand {
    const command = plan.command as AnyMongoCommand;
    switch (command.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(command.collection, resolveDocument(command.document));
      case 'updateOne':
        return new UpdateOneWireCommand(
          command.collection,
          lowerFilter(command.filter),
          resolveDocument(command.update),
        );
      case 'insertMany':
        return new InsertManyWireCommand(
          command.collection,
          command.documents.map((doc) => resolveDocument(doc)),
        );
      case 'updateMany':
        return new UpdateManyWireCommand(
          command.collection,
          lowerFilter(command.filter),
          resolveDocument(command.update),
        );
      case 'deleteOne':
        return new DeleteOneWireCommand(command.collection, lowerFilter(command.filter));
      case 'deleteMany':
        return new DeleteManyWireCommand(command.collection, lowerFilter(command.filter));
      case 'findOneAndUpdate':
        return new FindOneAndUpdateWireCommand(
          command.collection,
          lowerFilter(command.filter),
          resolveDocument(command.update),
          command.upsert,
        );
      case 'findOneAndDelete':
        return new FindOneAndDeleteWireCommand(command.collection, lowerFilter(command.filter));
      case 'aggregate':
        return new AggregateWireCommand(command.collection, lowerPipeline(command.pipeline));
      // v8 ignore next 4
      default: {
        const _exhaustive: never = command;
        throw new Error(`Unknown command kind: ${(_exhaustive as { kind: string }).kind}`);
      }
    }
  }
}

export function createMongoAdapter(): MongoAdapter {
  return new MongoAdapterImpl();
}
