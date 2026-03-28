import type {
  AnyMongoCommand,
  AnyMongoWireCommand,
  Document,
  MongoAdapter,
  MongoExecutionPlan,
  MongoExpr,
  MongoLoweringContext,
  MongoQueryPlan,
  MongoValue,
} from '@prisma-next/mongo-core';
import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  FindWireCommand,
  InsertOneWireCommand,
  MongoParamRef,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';

function resolveValue(value: MongoValue): unknown {
  if (value instanceof MongoParamRef) {
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(resolveValue);
  }
  return resolveDocument(value as MongoExpr);
}

function resolveDocument(expr: MongoExpr): Document {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(expr)) {
    result[key] = resolveValue(val);
  }
  return result;
}

function lowerCommand(command: AnyMongoCommand): AnyMongoWireCommand {
  switch (command.kind) {
    case 'find': {
      const options: {
        projection?: Document;
        sort?: Document;
        limit?: number;
        skip?: number;
      } = {};
      if (command.projection) options.projection = { ...command.projection };
      if (command.sort) options.sort = { ...command.sort };
      if (command.limit !== undefined) options.limit = command.limit;
      if (command.skip !== undefined) options.skip = command.skip;
      return new FindWireCommand(
        command.collection,
        command.filter ? resolveDocument(command.filter) : undefined,
        options,
      );
    }
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

class MongoAdapterImpl implements MongoAdapter {
  lower<Row>(
    queryPlan: MongoQueryPlan<Row>,
    _context: MongoLoweringContext,
  ): MongoExecutionPlan<Row> {
    const wireCommand = lowerCommand(queryPlan.command);
    return Object.freeze({
      wireCommand,
      command: queryPlan.command,
      meta: queryPlan.meta,
    });
  }
}

export function createMongoAdapter(): MongoAdapter {
  return new MongoAdapterImpl();
}
