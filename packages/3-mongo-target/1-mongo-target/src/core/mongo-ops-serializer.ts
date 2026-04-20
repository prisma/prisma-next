import type { PlanMeta } from '@prisma-next/contract/types';
import type { MigrationOperationClass } from '@prisma-next/framework-components/control';
import {
  type AnyMongoDdlCommand,
  type AnyMongoInspectionCommand,
  type AnyMongoMigrationOperation,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  type MongoDataTransformCheck,
  type MongoDataTransformOperation,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoFilterExpr,
  type MongoMigrationCheck,
  type MongoMigrationPlanOperation,
  type MongoMigrationStep,
  MongoNotExpr,
  MongoOrExpr,
} from '@prisma-next/mongo-query-ast/control';
import {
  AggregateCommand,
  type AnyMongoCommand,
  MongoAddFieldsStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  type MongoPipelineStage,
  MongoProjectStage,
  type MongoQueryPlan,
  MongoSortStage,
  type MongoUpdatePipelineStage,
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { ifDefined } from '@prisma-next/utils/defined';
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
  'wildcardProjection?': 'Record<string, unknown>',
  'collation?': 'Record<string, unknown>',
  'weights?': 'Record<string, unknown>',
  'default_language?': 'string',
  'language_override?': 'string',
});

const DropIndexJson = type({
  kind: '"dropIndex"',
  collection: 'string',
  name: 'string',
});

const CreateCollectionJson = type({
  kind: '"createCollection"',
  collection: 'string',
  'validator?': 'Record<string, unknown>',
  'validationLevel?': '"strict" | "moderate"',
  'validationAction?': '"error" | "warn"',
  'capped?': 'boolean',
  'size?': 'number',
  'max?': 'number',
  'timeseries?': 'Record<string, unknown>',
  'collation?': 'Record<string, unknown>',
  'changeStreamPreAndPostImages?': 'Record<string, unknown>',
  'clusteredIndex?': 'Record<string, unknown>',
});

const DropCollectionJson = type({
  kind: '"dropCollection"',
  collection: 'string',
});

const CollModJson = type({
  kind: '"collMod"',
  collection: 'string',
  'validator?': 'Record<string, unknown>',
  'validationLevel?': '"strict" | "moderate"',
  'validationAction?': '"error" | "warn"',
  'changeStreamPreAndPostImages?': 'Record<string, unknown>',
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

// ============================================================================
// DML command schemas
// ============================================================================

const RawInsertOneJson = type({
  kind: '"rawInsertOne"',
  collection: 'string',
  document: 'Record<string, unknown>',
});

const RawInsertManyJson = type({
  kind: '"rawInsertMany"',
  collection: 'string',
  documents: 'Record<string, unknown>[]',
});

const RawUpdateOneJson = type({
  kind: '"rawUpdateOne"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
});

const RawUpdateManyJson = type({
  kind: '"rawUpdateMany"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
});

const RawDeleteOneJson = type({
  kind: '"rawDeleteOne"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const RawDeleteManyJson = type({
  kind: '"rawDeleteMany"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const RawAggregateJson = type({
  kind: '"rawAggregate"',
  collection: 'string',
  pipeline: 'Record<string, unknown>[]',
});

const RawFindOneAndUpdateJson = type({
  kind: '"rawFindOneAndUpdate"',
  collection: 'string',
  filter: 'Record<string, unknown>',
  update: 'Record<string, unknown> | Record<string, unknown>[]',
  upsert: 'boolean',
});

const RawFindOneAndDeleteJson = type({
  kind: '"rawFindOneAndDelete"',
  collection: 'string',
  filter: 'Record<string, unknown>',
});

const TypedAggregateJson = type({
  kind: '"aggregate"',
  collection: 'string',
  pipeline: 'Record<string, unknown>[]',
});

const PlanMetaJson = type({
  target: 'string',
  storageHash: 'string',
  lane: 'string',
  paramDescriptors: 'unknown[]',
  'targetFamily?': 'string',
  'profileHash?': 'string',
  'annotations?': 'Record<string, unknown>',
  'refs?': 'Record<string, unknown>',
  'projection?': 'Record<string, string> | string[]',
  'projectionTypes?': 'Record<string, string>',
});

const QueryPlanJson = type({
  collection: 'string',
  command: 'Record<string, unknown>',
  meta: PlanMetaJson,
});

// ============================================================================
// DDL check/step schemas
// ============================================================================

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

const DdlOperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"additive" | "widening" | "destructive"',
  precheck: 'Record<string, unknown>[]',
  execute: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});

const DataTransformCheckJson = type({
  description: 'string',
  source: 'Record<string, unknown>',
  filter: 'Record<string, unknown>',
  expect: '"exists" | "notExists"',
});

const DataTransformOperationJson = type({
  id: 'string',
  label: 'string',
  operationClass: '"data"',
  name: 'string',
  precheck: 'Record<string, unknown>[]',
  run: 'Record<string, unknown>[]',
  postcheck: 'Record<string, unknown>[]',
});

function validate<T>(schema: { assert: (data: unknown) => T }, data: unknown, context: string): T {
  try {
    return schema.assert(data);
  } catch (error) {
    /* v8 ignore start -- assertion libraries always throw Error instances */
    const message = error instanceof Error ? error.message : String(error);
    /* v8 ignore stop */
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

// ============================================================================
// Pipeline stage deserialization
// ============================================================================

export function deserializePipelineStage(json: unknown): MongoPipelineStage {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'match':
      return new MongoMatchStage(deserializeFilterExpr(record['filter']));
    case 'limit':
      return new MongoLimitStage(record['limit'] as number);
    case 'sort':
      return new MongoSortStage(record['sort'] as Record<string, 1 | -1>);
    case 'project':
      return new MongoProjectStage(record['projection'] as Record<string, 0 | 1>);
    case 'addFields':
      return new MongoAddFieldsStage(record['fields'] as Record<string, never>);
    case 'lookup': {
      const opts: {
        from: string;
        as: string;
        localField?: string;
        foreignField?: string;
        pipeline?: ReadonlyArray<MongoPipelineStage>;
        let_?: Record<string, never>;
      } = {
        from: record['from'] as string,
        as: record['as'] as string,
      };
      if (record['localField'] !== undefined) opts.localField = record['localField'] as string;
      if (record['foreignField'] !== undefined)
        opts.foreignField = record['foreignField'] as string;
      if (record['pipeline'] !== undefined)
        opts.pipeline = (record['pipeline'] as unknown[]).map(deserializePipelineStage);
      if (record['let_'] !== undefined) opts.let_ = record['let_'] as Record<string, never>;
      return new MongoLookupStage(opts);
    }
    case 'merge': {
      const opts: {
        into: string | { db: string; coll: string };
        on?: string | ReadonlyArray<string>;
        whenMatched?: string | ReadonlyArray<MongoUpdatePipelineStage>;
        whenNotMatched?: string;
      } = {
        into: record['into'] as string | { db: string; coll: string },
      };
      if (record['on'] !== undefined) opts.on = record['on'] as string | string[];
      if (record['whenMatched'] !== undefined) {
        const wm = record['whenMatched'];
        opts.whenMatched =
          typeof wm === 'string'
            ? wm
            : ((wm as unknown[]).map(deserializePipelineStage) as MongoUpdatePipelineStage[]);
      }
      if (record['whenNotMatched'] !== undefined)
        opts.whenNotMatched = record['whenNotMatched'] as string;
      return new MongoMergeStage(opts);
    }
    default:
      throw new Error(`Unknown pipeline stage kind: ${kind}`);
  }
}

// ============================================================================
// DML command deserialization
// ============================================================================

export function deserializeDmlCommand(json: unknown): AnyMongoCommand {
  const record = json as Record<string, unknown>;
  const kind = record['kind'] as string;
  switch (kind) {
    case 'rawInsertOne': {
      const data = validate(RawInsertOneJson, json, 'rawInsertOne command');
      return new RawInsertOneCommand(data.collection, data.document);
    }
    case 'rawInsertMany': {
      const data = validate(RawInsertManyJson, json, 'rawInsertMany command');
      return new RawInsertManyCommand(data.collection, data.documents);
    }
    case 'rawUpdateOne': {
      const data = validate(RawUpdateOneJson, json, 'rawUpdateOne command');
      return new RawUpdateOneCommand(data.collection, data.filter, data.update);
    }
    case 'rawUpdateMany': {
      const data = validate(RawUpdateManyJson, json, 'rawUpdateMany command');
      return new RawUpdateManyCommand(data.collection, data.filter, data.update);
    }
    case 'rawDeleteOne': {
      const data = validate(RawDeleteOneJson, json, 'rawDeleteOne command');
      return new RawDeleteOneCommand(data.collection, data.filter);
    }
    case 'rawDeleteMany': {
      const data = validate(RawDeleteManyJson, json, 'rawDeleteMany command');
      return new RawDeleteManyCommand(data.collection, data.filter);
    }
    case 'rawAggregate': {
      const data = validate(RawAggregateJson, json, 'rawAggregate command');
      return new RawAggregateCommand(data.collection, data.pipeline);
    }
    case 'rawFindOneAndUpdate': {
      const data = validate(RawFindOneAndUpdateJson, json, 'rawFindOneAndUpdate command');
      return new RawFindOneAndUpdateCommand(data.collection, data.filter, data.update, data.upsert);
    }
    case 'rawFindOneAndDelete': {
      const data = validate(RawFindOneAndDeleteJson, json, 'rawFindOneAndDelete command');
      return new RawFindOneAndDeleteCommand(data.collection, data.filter);
    }
    case 'aggregate': {
      const data = validate(TypedAggregateJson, json, 'aggregate command');
      const pipeline = data.pipeline.map(deserializePipelineStage);
      return new AggregateCommand(data.collection, pipeline);
    }
    default:
      throw new Error(`Unknown DML command kind: ${kind}`);
  }
}

// ============================================================================
// MongoQueryPlan deserialization
// ============================================================================

export function deserializeMongoQueryPlan(json: unknown): MongoQueryPlan {
  const data = validate(QueryPlanJson, json, 'Mongo query plan');
  const command = deserializeDmlCommand(data.command);
  const m = data.meta;
  const meta: PlanMeta = {
    target: m.target,
    storageHash: m.storageHash,
    lane: m.lane,
    paramDescriptors: m.paramDescriptors as PlanMeta['paramDescriptors'],
    ...ifDefined('targetFamily', m.targetFamily),
    ...ifDefined('profileHash', m.profileHash),
    ...ifDefined('annotations', m.annotations),
    ...ifDefined('refs', m.refs),
    ...ifDefined('projection', m.projection),
    ...ifDefined('projectionTypes', m.projectionTypes),
  };
  return { collection: data.collection, command, meta };
}

// ============================================================================
// DDL command deserialization
// ============================================================================

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
        wildcardProjection: data.wildcardProjection as Record<string, 0 | 1> | undefined,
        collation: data.collation,
        weights: data.weights as Record<string, number> | undefined,
        default_language: data.default_language,
        language_override: data.language_override,
      });
    }
    case 'dropIndex': {
      const data = validate(DropIndexJson, json, 'dropIndex command');
      return new DropIndexCommand(data.collection, data.name);
    }
    case 'createCollection': {
      const data = validate(CreateCollectionJson, json, 'createCollection command');
      return new CreateCollectionCommand(data.collection, {
        validator: data.validator,
        validationLevel: data.validationLevel,
        validationAction: data.validationAction,
        capped: data.capped,
        size: data.size,
        max: data.max,
        timeseries: data.timeseries as CreateCollectionCommand['timeseries'],
        collation: data.collation,
        changeStreamPreAndPostImages: data.changeStreamPreAndPostImages as
          | { enabled: boolean }
          | undefined,
        clusteredIndex: data.clusteredIndex as CreateCollectionCommand['clusteredIndex'],
      });
    }
    case 'dropCollection': {
      const data = validate(DropCollectionJson, json, 'dropCollection command');
      return new DropCollectionCommand(data.collection);
    }
    case 'collMod': {
      const data = validate(CollModJson, json, 'collMod command');
      return new CollModCommand(data.collection, {
        validator: data.validator,
        validationLevel: data.validationLevel,
        validationAction: data.validationAction,
        changeStreamPreAndPostImages: data.changeStreamPreAndPostImages as
          | { enabled: boolean }
          | undefined,
      });
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

function isDataTransformJson(json: unknown): boolean {
  return (
    typeof json === 'object' &&
    json !== null &&
    (json as Record<string, unknown>)['operationClass'] === 'data'
  );
}

function deserializeDdlOp(json: unknown): MongoMigrationPlanOperation {
  const data = validate(DdlOperationJson, json, 'migration operation');
  return {
    id: data.id,
    label: data.label,
    operationClass: data.operationClass as MigrationOperationClass,
    precheck: data.precheck.map(deserializeCheck),
    execute: data.execute.map(deserializeStep),
    postcheck: data.postcheck.map(deserializeCheck),
  };
}

function deserializeDataTransformCheck(json: unknown): MongoDataTransformCheck {
  const data = validate(DataTransformCheckJson, json, 'data transform check');
  return {
    description: data.description,
    source: deserializeMongoQueryPlan(data.source),
    filter: deserializeFilterExpr(data.filter),
    expect: data.expect,
  };
}

function deserializeDataTransformOp(json: unknown): MongoDataTransformOperation {
  const data = validate(DataTransformOperationJson, json, 'data transform operation');
  return {
    id: data.id,
    label: data.label,
    operationClass: 'data',
    name: data.name,
    precheck: data.precheck.map(deserializeDataTransformCheck),
    run: data.run.map(deserializeMongoQueryPlan),
    postcheck: data.postcheck.map(deserializeDataTransformCheck),
  };
}

export function deserializeMongoOp(json: unknown): AnyMongoMigrationOperation {
  if (isDataTransformJson(json)) {
    return deserializeDataTransformOp(json);
  }
  return deserializeDdlOp(json);
}

export function deserializeMongoOps(json: readonly unknown[]): AnyMongoMigrationOperation[] {
  return json.map(deserializeMongoOp);
}

export function serializeMongoOps(ops: readonly AnyMongoMigrationOperation[]): string {
  return JSON.stringify(ops, null, 2);
}
