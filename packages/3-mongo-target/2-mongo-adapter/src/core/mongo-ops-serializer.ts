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

type JsonRecord = Record<string, unknown>;

function deserializeFilterExpr(json: JsonRecord): MongoFilterExpr {
  const kind = json['kind'] as string;
  switch (kind) {
    case 'field':
      return MongoFieldFilter.of(
        json['field'] as string,
        json['op'] as string,
        json['value'] as never,
      );
    case 'and':
      return MongoAndExpr.of((json['exprs'] as JsonRecord[]).map(deserializeFilterExpr));
    case 'or':
      return MongoOrExpr.of((json['exprs'] as JsonRecord[]).map(deserializeFilterExpr));
    case 'not':
      return new MongoNotExpr(deserializeFilterExpr(json['expr'] as JsonRecord));
    case 'exists':
      return new MongoExistsExpr(json['field'] as string, json['exists'] as boolean);
    default:
      throw new Error(`Unknown filter expression kind: ${kind}`);
  }
}

function deserializeDdlCommand(json: JsonRecord): AnyMongoDdlCommand {
  const kind = json['kind'] as string;
  switch (kind) {
    case 'createIndex':
      return new CreateIndexCommand(
        json['collection'] as string,
        json['keys'] as ReadonlyArray<{
          field: string;
          direction: 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';
        }>,
        {
          unique: json['unique'] as boolean | undefined,
          sparse: json['sparse'] as boolean | undefined,
          expireAfterSeconds: json['expireAfterSeconds'] as number | undefined,
          partialFilterExpression: json['partialFilterExpression'] as
            | Record<string, unknown>
            | undefined,
          name: json['name'] as string | undefined,
        },
      );
    case 'dropIndex':
      return new DropIndexCommand(json['collection'] as string, json['name'] as string);
    default:
      throw new Error(`Unknown DDL command kind: ${kind}`);
  }
}

function deserializeInspectionCommand(json: JsonRecord): AnyMongoInspectionCommand {
  const kind = json['kind'] as string;
  switch (kind) {
    case 'listIndexes':
      return new ListIndexesCommand(json['collection'] as string);
    case 'listCollections':
      return new ListCollectionsCommand();
    default:
      throw new Error(`Unknown inspection command kind: ${kind}`);
  }
}

function deserializeCheck(json: JsonRecord): MongoMigrationCheck {
  return {
    description: json['description'] as string,
    source: deserializeInspectionCommand(json['source'] as JsonRecord),
    filter: deserializeFilterExpr(json['filter'] as JsonRecord),
    expect: json['expect'] as 'exists' | 'notExists',
  };
}

function deserializeStep(json: JsonRecord): MongoMigrationStep {
  return {
    description: json['description'] as string,
    command: deserializeDdlCommand(json['command'] as JsonRecord),
  };
}

export function deserializeMongoOp(json: JsonRecord): MongoMigrationPlanOperation {
  return {
    id: json['id'] as string,
    label: json['label'] as string,
    operationClass: json['operationClass'] as MigrationOperationClass,
    precheck: (json['precheck'] as JsonRecord[]).map(deserializeCheck),
    execute: (json['execute'] as JsonRecord[]).map(deserializeStep),
    postcheck: (json['postcheck'] as JsonRecord[]).map(deserializeCheck),
  };
}

export function deserializeMongoOps(json: readonly unknown[]): MongoMigrationPlanOperation[] {
  return (json as JsonRecord[]).map(deserializeMongoOp);
}

export function serializeMongoOps(ops: readonly MongoMigrationPlanOperation[]): string {
  return JSON.stringify(ops, null, 2);
}
