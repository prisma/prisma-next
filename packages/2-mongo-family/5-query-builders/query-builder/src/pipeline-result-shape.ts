import type {
  MongoAggExpr,
  MongoFieldShape,
  MongoPipelineStage,
  MongoResultShape,
} from '@prisma-next/mongo-query-ast/execution';
import {
  freezeMongoResultShape,
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoAggOperator,
  MongoProjectStage,
} from '@prisma-next/mongo-query-ast/execution';
import type { MongoOperationCodecTable } from './types';

const identityStageKinds = new Set(['match', 'sort', 'limit', 'skip', 'sample', 'vectorSearch']);

const unknownShape: MongoFieldShape = { kind: 'unknown' as const };

function fieldShapeAtPath(shape: MongoResultShape, path: string): MongoFieldShape {
  if (shape.kind !== 'document' || path.includes('.')) {
    return unknownShape;
  }
  return shape.fields[path] ?? unknownShape;
}

function shapeForExpr(
  currentShape: MongoResultShape,
  expr: MongoAggExpr,
  operationCodecs: MongoOperationCodecTable,
): MongoFieldShape {
  if (expr instanceof MongoAggFieldRef) {
    return fieldShapeAtPath(currentShape, expr.path);
  }
  if (expr instanceof MongoAggOperator) {
    const codecId = operationCodecs[expr.op];
    if (codecId !== undefined) {
      return { kind: 'leaf' as const, codecId, nullable: false };
    }
  }
  return unknownShape;
}

function resultShapeAfterProject(
  currentShape: MongoResultShape,
  stage: MongoProjectStage,
  operationCodecs: MongoOperationCodecTable,
): MongoResultShape {
  if (currentShape.kind !== 'document') {
    return { kind: 'unknown' as const };
  }
  const fields: Record<string, MongoFieldShape> = {};
  for (const [key, value] of Object.entries(stage.projection)) {
    if (value === 0) {
      continue;
    }
    if (value === 1) {
      fields[key] = currentShape.fields[key] ?? unknownShape;
      continue;
    }
    fields[key] = shapeForExpr(currentShape, value, operationCodecs);
  }
  if (!Object.hasOwn(stage.projection, '_id') && currentShape.fields['_id']) {
    fields['_id'] = currentShape.fields['_id'];
  }
  return freezeMongoResultShape({ kind: 'document' as const, fields });
}

function resultShapeAfterAddFields(
  currentShape: MongoResultShape,
  stage: MongoAddFieldsStage,
  operationCodecs: MongoOperationCodecTable,
): MongoResultShape {
  if (currentShape.kind !== 'document') {
    return { kind: 'unknown' as const };
  }
  const fields: Record<string, MongoFieldShape> = { ...currentShape.fields };
  for (const [key, expr] of Object.entries(stage.fields)) {
    fields[key] = shapeForExpr(currentShape, expr, operationCodecs);
  }
  return freezeMongoResultShape({ kind: 'document' as const, fields });
}

export function computePipelineResultShape(
  stages: ReadonlyArray<MongoPipelineStage>,
  startShape: MongoResultShape,
  operationCodecs: MongoOperationCodecTable,
): MongoResultShape {
  let shape = startShape;
  for (const stage of stages) {
    if (shape.kind === 'unknown') {
      return { kind: 'unknown' as const };
    }
    if (identityStageKinds.has(stage.kind)) {
      continue;
    }
    if (stage instanceof MongoProjectStage) {
      shape = resultShapeAfterProject(shape, stage, operationCodecs);
      continue;
    }
    if (stage instanceof MongoAddFieldsStage) {
      shape = resultShapeAfterAddFields(shape, stage, operationCodecs);
      continue;
    }
    return { kind: 'unknown' as const };
  }
  return shape;
}
