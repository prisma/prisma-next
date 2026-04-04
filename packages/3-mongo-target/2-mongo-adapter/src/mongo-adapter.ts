import type {
  AnyMongoCommand,
  AnyMongoWireCommand,
  Document,
  MongoAdapter,
  MongoExpr,
  MongoLoweringContext,
  MongoReadPlanLike,
} from '@prisma-next/mongo-core';
import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  InsertOneWireCommand,
  resolveValue,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';
import type { MongoReadStage } from '@prisma-next/mongo-query-ast';
import { lowerPipeline } from '@prisma-next/mongo-query-ast';

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

  lowerCommand(command: AnyMongoCommand, _context: MongoLoweringContext): AnyMongoWireCommand {
    switch (command.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(command.collection, resolveDocument(command.document));
      case 'updateOne':
        return new UpdateOneWireCommand(
          command.collection,
          resolveDocument(command.filter),
          resolveDocument(command.update),
        );
      case 'deleteOne':
        return new DeleteOneWireCommand(command.collection, resolveDocument(command.filter));
      case 'aggregate':
        return new AggregateWireCommand(
          command.collection,
          command.pipeline.map((stage) => ({ ...stage })),
        );
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
