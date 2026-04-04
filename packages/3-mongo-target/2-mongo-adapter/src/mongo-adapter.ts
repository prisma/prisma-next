import type {
  AnyMongoWireCommand,
  Document,
  MongoAdapter,
  MongoCommandLike,
  MongoExpr,
  MongoLoweringContext,
  MongoReadPlanLike,
} from '@prisma-next/mongo-core';
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
} from '@prisma-next/mongo-core';
import type { AnyMongoCommand, MongoReadStage } from '@prisma-next/mongo-query-ast';
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
  lowerReadPlan(plan: MongoReadPlanLike): AggregateWireCommand {
    const rawPipeline = lowerPipeline(plan.stages as ReadonlyArray<MongoReadStage>);
    return new AggregateWireCommand(plan.collection, rawPipeline);
  }

  lowerCommand(commandLike: MongoCommandLike, _context: MongoLoweringContext): AnyMongoWireCommand {
    const command = commandLike as AnyMongoCommand;
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
          command.filter ? lowerFilter(command.filter) : {},
          resolveDocument(command.update),
          command.upsert,
        );
      case 'findOneAndDelete':
        return new FindOneAndDeleteWireCommand(command.collection, lowerFilter(command.filter));
      case 'aggregate':
        return new AggregateWireCommand(
          command.collection,
          command.pipeline.map((stage) => ({ ...stage })),
        );
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
