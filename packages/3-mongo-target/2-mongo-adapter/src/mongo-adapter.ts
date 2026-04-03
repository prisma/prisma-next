import type {
  AnyMongoCommand,
  AnyMongoWireCommand,
  Document,
  MongoAdapter,
  MongoExpr,
  MongoLoweringContext,
  MongoValue,
} from '@prisma-next/mongo-core';
import {
  AggregateWireCommand,
  DeleteOneWireCommand,
  InsertOneWireCommand,
  MongoParamRef,
  UpdateOneWireCommand,
} from '@prisma-next/mongo-core';

class MongoAdapterImpl implements MongoAdapter {
  lowerCommand(command: AnyMongoCommand, _context: MongoLoweringContext): AnyMongoWireCommand {
    switch (command.kind) {
      case 'insertOne':
        return new InsertOneWireCommand(
          command.collection,
          this.#resolveDocument(command.document),
        );
      case 'updateOne':
        return new UpdateOneWireCommand(
          command.collection,
          this.#resolveDocument(command.filter),
          this.#resolveDocument(command.update),
        );
      case 'deleteOne':
        return new DeleteOneWireCommand(command.collection, this.#resolveDocument(command.filter));
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

  #resolveValue(value: MongoValue): unknown {
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
      return value.map((v) => this.#resolveValue(v));
    }
    return this.#resolveDocument(value as MongoExpr);
  }

  #resolveDocument(expr: MongoExpr): Document {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(expr)) {
      result[key] = this.#resolveValue(val);
    }
    return result;
  }
}

export function createMongoAdapter(): MongoAdapter {
  return new MongoAdapterImpl();
}
