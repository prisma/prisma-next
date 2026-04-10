import type { MigrationOperationClass } from '@prisma-next/framework-components/control';
import {
  type AnyMongoDdlCommand,
  type AnyMongoInspectionCommand,
  CreateIndexCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoFilterExpr,
  type MongoMigrationCheck,
  type MongoMigrationPlanOperation,
  type MongoMigrationStep,
  MongoNotExpr,
  MongoOrExpr,
} from '@prisma-next/mongo-query-ast/control';
import { type } from 'arktype';

const IndexKeyDirection = type('1 | -1 | "text" | "2dsphere" | "2d" | "hashed"');
const IndexKeyJson = type({ field: 'string', direction: IndexKeyDirection });

const CreateIndexJson = type({
  kind: '"createIndex"',
  collection: 'string',
  keys: IndexKeyJson.array().atLeastLength(1),
  'unique?': 'boolean',
  'sparse?': 'boolean',
  'expireAfterSeconds?': 'number',
  'partialFilterExpression?': 'Record<string, unknown>',
  'name?': 'string',
});

const DropIndexJson = type({
  kind: '"dropIndex"',
  collection: 'string',
  name: 'string',
});

const ListIndexesJson = type({
  kind: '"listIndexes"',
  collection: 'string',
});

const ListCollectionsJson = type({
  kind: '"listCollections"',
});

const FieldFilterJson = type({
  kind: '"field"',
  field: 'string',
  op: 'string',
  value: 'unknown',
});

const ExistsFilterJson = type({
  kind: '"exists"',
  field: 'string',
  exists: 'boolean',
});

const CheckJson = type({
  description: 'string',
  source: 'Record<string, unknown>',
  filter: 'Record<string, unknown>',
  expect: '"exists" | "notExists"',
});

const StepJson = type({
  description: 'string',
  command: 'Record<string, unknown>',
});

const OperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"additive" | "widening" | "destructive"',
  precheck: 'Record<string, unknown>[]',
  execute: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});

function validate<T>(schema: { assert: (data: unknown) => T }, data: unknown, context: string): T {
  try {
    return schema.assert(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid ${context}: ${message}`);
  }
}

function deserializeFilterExpr(json: unknown): MongoFilterExpr {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'field': {
      const data = validate(FieldFilterJson, json, 'field filter');
      return MongoFieldFilter.of(data.field, data.op, data.value as never);
    }
    case 'and': {
      const exprs = record['exprs'];
      if (!Array.isArray(exprs)) throw new Error('Invalid and filter: missing exprs array');
      return MongoAndExpr.of(exprs.map(deserializeFilterExpr));
    }
    case 'or': {
      const exprs = record['exprs'];
      if (!Array.isArray(exprs)) throw new Error('Invalid or filter: missing exprs array');
      return MongoOrExpr.of(exprs.map(deserializeFilterExpr));
    }
    case 'not': {
      const expr = record['expr'];
      if (!expr || typeof expr !== 'object') throw new Error('Invalid not filter: missing expr');
      return new MongoNotExpr(deserializeFilterExpr(expr));
    }
    case 'exists': {
      const data = validate(ExistsFilterJson, json, 'exists filter');
      return new MongoExistsExpr(data.field, data.exists);
    }
    default:
      throw new Error(`Unknown filter expression kind: ${kind}`);
  }
}

function deserializeDdlCommand(json: unknown): AnyMongoDdlCommand {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'createIndex': {
      const data = validate(CreateIndexJson, json, 'createIndex command');
      return new CreateIndexCommand(data.collection, data.keys, {
        unique: data.unique,
        sparse: data.sparse,
        expireAfterSeconds: data.expireAfterSeconds,
        partialFilterExpression: data.partialFilterExpression,
        name: data.name,
      });
    }
    case 'dropIndex': {
      const data = validate(DropIndexJson, json, 'dropIndex command');
      return new DropIndexCommand(data.collection, data.name);
    }
    default:
      throw new Error(`Unknown DDL command kind: ${kind}`);
  }
}

function deserializeInspectionCommand(json: unknown): AnyMongoInspectionCommand {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'listIndexes': {
      const data = validate(ListIndexesJson, json, 'listIndexes command');
      return new ListIndexesCommand(data.collection);
    }
    case 'listCollections': {
      validate(ListCollectionsJson, json, 'listCollections command');
      return new ListCollectionsCommand();
    }
    default:
      throw new Error(`Unknown inspection command kind: ${kind}`);
  }
}

function deserializeCheck(json: unknown): MongoMigrationCheck {
  const data = validate(CheckJson, json, 'migration check');
  return {
    description: data.description,
    source: deserializeInspectionCommand(data.source),
    filter: deserializeFilterExpr(data.filter),
    expect: data.expect,
  };
}

function deserializeStep(json: unknown): MongoMigrationStep {
  const data = validate(StepJson, json, 'migration step');
  return {
    description: data.description,
    command: deserializeDdlCommand(data.command),
  };
}

export function deserializeMongoOp(json: unknown): MongoMigrationPlanOperation {
  const data = validate(OperationJson, json, 'migration operation');
  return {
    id: data.id,
    label: data.label,
    operationClass: data.operationClass as MigrationOperationClass,
    precheck: data.precheck.map(deserializeCheck),
    execute: data.execute.map(deserializeStep),
    postcheck: data.postcheck.map(deserializeCheck),
  };
}

export function deserializeMongoOps(json: readonly unknown[]): MongoMigrationPlanOperation[] {
  return json.map(deserializeMongoOp);
}

export function serializeMongoOps(ops: readonly MongoMigrationPlanOperation[]): string {
  return JSON.stringify(ops, null, 2);
}
