import type { DocumentContract } from '@prisma-next/contract/types';
import {
  AggregateCommand,
  AggregateWireCommand,
  DeleteOneCommand,
  DeleteOneWireCommand,
  type Document,
  FindCommand,
  FindWireCommand,
  InsertOneCommand,
  InsertOneWireCommand,
  type MongoCommand,
  type MongoExecutionPlan,
  type MongoExpr,
  MongoParamRef,
  type MongoQueryPlan,
  type MongoValue,
  type MongoWireCommand,
  UpdateOneCommand,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';

export interface MongoLoweringContext {
  readonly contract: DocumentContract;
}

export interface MongoAdapter {
  lower<Row>(
    queryPlan: MongoQueryPlan<Row>,
    context: MongoLoweringContext,
  ): MongoExecutionPlan<Row>;
}

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

function lowerCommand(command: MongoCommand): MongoWireCommand {
  if (command instanceof FindCommand) {
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
  if (command instanceof InsertOneCommand) {
    return new InsertOneWireCommand(command.collection, resolveDocument(command.document));
  }
  if (command instanceof UpdateOneCommand) {
    return new UpdateOneWireCommand(
      command.collection,
      resolveDocument(command.filter),
      resolveDocument(command.update),
    );
  }
  if (command instanceof DeleteOneCommand) {
    return new DeleteOneWireCommand(command.collection, resolveDocument(command.filter));
  }
  if (command instanceof AggregateCommand) {
    return new AggregateWireCommand(
      command.collection,
      command.pipeline.map((stage) => ({ ...stage })),
    );
  }
  throw new Error(`Unknown command type: ${command.constructor.name}`);
}

export function createMongoAdapter(): MongoAdapter {
  return {
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
    },
  };
}
