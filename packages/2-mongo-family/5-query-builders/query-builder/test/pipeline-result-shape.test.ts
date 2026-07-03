import {
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  MongoGroupStage,
  MongoProjectStage,
  MongoUnwindStage,
  MongoVectorSearchStage,
} from '@prisma-next/mongo-query-ast/execution';
import { blindCast } from '@prisma-next/utils/casts';
import { describe, expect, it } from 'vitest';
import { computePipelineResultShape } from '../src/pipeline-result-shape';
import { contractModelToMongoResultShape } from '../src/result-shape';
import type { TContract } from './fixtures/test-contract';
import { testContractJson, testOperationCodecs } from './fixtures/test-contract';

const contract = blindCast<
  TContract,
  'query-builder fixture JSON carries domain.namespaces envelope'
>(testContractJson);

const orderModel = contract.domain.namespaces.__unbound__!.models['Order'];
const orderShape = contractModelToMongoResultShape(orderModel);
const ops = testOperationCodecs;

describe('computePipelineResultShape', () => {
  it('vectorSearch stage carries the input shape through unchanged', () => {
    const stage = new MongoVectorSearchStage({
      index: 'idx',
      path: 'embedding',
      queryVector: [0.1, 0.2],
      numCandidates: 10,
      limit: 1,
    });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    expect(shape).toEqual(orderShape);
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
  });

  it('project stage implicitly keeps _id and keeps a listed scalar field', () => {
    const stage = new MongoProjectStage({ status: 1 });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(Object.keys(shape.fields).sort()).toEqual(['_id', 'status']);
  });

  it('project stage renames a field, keying the shape off the source field', () => {
    const stage = new MongoProjectStage({
      label: MongoAggFieldRef.of('status'),
      renamedId: MongoAggFieldRef.of('_id'),
    });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['label']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(shape.fields['renamedId']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(Object.keys(shape.fields).sort()).toEqual(['_id', 'label', 'renamedId']);
  });

  it('project stage resolves a table-covered computed field to a leaf with the table codec', () => {
    const stage = new MongoProjectStage({
      status: 1,
      shout: MongoAggOperator.toUpper(MongoAggFieldRef.of('status')),
      asDate: MongoAggOperator.of('$toDate', MongoAggFieldRef.of('status')),
    });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['shout']).toEqual({
      kind: 'leaf',
      codecId: ops.$toUpper,
      nullable: false,
    });
    expect(shape.fields['asDate']).toEqual({
      kind: 'leaf',
      codecId: ops.$toDate,
      nullable: false,
    });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
  });

  it('project stage with an operator outside the table yields unknown at that key', () => {
    const stage = new MongoProjectStage({
      parts: MongoAggOperator.of('$split', [
        MongoAggFieldRef.of('status'),
        MongoAggLiteral.of('-'),
      ]),
    });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['parts']).toEqual({ kind: 'unknown' });
  });

  it('addFields stage copies a fieldRef source shape and resolves table-covered computed fields', () => {
    const stage = new MongoAddFieldsStage({
      statusCopy: MongoAggFieldRef.of('status'),
      shout: MongoAggOperator.toUpper(MongoAggFieldRef.of('status')),
    });

    const shape = computePipelineResultShape([stage], orderShape, ops);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['statusCopy']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(shape.fields['shout']).toEqual({
      kind: 'leaf',
      codecId: ops.$toUpper,
      nullable: false,
    });
    // original fields remain
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
  });

  it('unhandled stage kind collapses the whole shape to unknown', () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('status'), {});

    const shape = computePipelineResultShape([stage], orderShape, ops);

    expect(shape).toEqual({ kind: 'unknown' });
  });

  it('unwind stage (also unhandled in this slice) collapses the whole shape to unknown', () => {
    const stage = new MongoUnwindStage('$tags', false);

    const shape = computePipelineResultShape([stage], orderShape, ops);

    expect(shape).toEqual({ kind: 'unknown' });
  });
});
