import type { MongoAggExpr } from '@prisma-next/mongo-query-ast/execution';
import {
  AggregateCommand,
  FindOneAndUpdateCommand,
  InsertOneCommand,
  MongoAddFieldsStage,
  MongoMatchStage,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  advanceMarkerCommand,
  CONTROL_COLLECTION,
  insertLedgerCommand,
  insertMarkerCommand,
  invariantMergeExpr,
  readAllMarkersCommand,
  readLedgerCommand,
  readMarkerCommand,
} from '../src/core/control-construction';
import { lowerAggExpr, structuralLowerFilter } from '../src/lowering';

function matchFilter(cmd: AggregateCommand) {
  const stage = cmd.pipeline[0];
  if (!(stage instanceof MongoMatchStage)) {
    throw new Error('expected first stage to be a $match');
  }
  return structuralLowerFilter(stage.filter);
}

function setStageFields(cmd: FindOneAndUpdateCommand): Readonly<Record<string, MongoAggExpr>> {
  const update = cmd.update;
  if (!Array.isArray(update)) {
    throw new Error('expected a pipeline update');
  }
  const stage = update[0];
  if (!(stage instanceof MongoAddFieldsStage)) {
    throw new Error('expected first update stage to be a $set/$addFields stage');
  }
  return stage.fields;
}

describe('control-construction — reads', () => {
  it('readMarkerCommand builds a $match/$limit aggregate over the control collection', () => {
    const cmd = readMarkerCommand('app');
    expect(cmd).toBeInstanceOf(AggregateCommand);
    expect(cmd.collection).toBe(CONTROL_COLLECTION);
    expect(matchFilter(cmd)).toEqual({
      $and: [{ _id: { $eq: 'app' } }, { space: { $eq: 'app' } }],
    });
    expect(cmd.pipeline[1]).toMatchObject({ kind: 'limit', limit: 1 });
  });

  it('readAllMarkersCommand expresses the $type / $expr filter via .type() and expr()', () => {
    const cmd = readAllMarkersCommand();
    expect(cmd.pipeline).toHaveLength(1);
    expect(matchFilter(cmd)).toEqual({
      $and: [
        { _id: { $type: 'string' } },
        { space: { $type: 'string' } },
        { $expr: { $eq: ['$_id', '$space'] } },
      ],
    });
  });

  it('readLedgerCommand without a space filters on type only, sorted by _id', () => {
    const cmd = readLedgerCommand();
    expect(matchFilter(cmd)).toEqual({ type: { $eq: 'ledger' } });
    expect(cmd.pipeline[1]).toMatchObject({ kind: 'sort', sort: { _id: 1 } });
  });

  it('readLedgerCommand with a space ands the space filter', () => {
    const cmd = readLedgerCommand('app');
    expect(matchFilter(cmd)).toEqual({
      $and: [{ type: { $eq: 'ledger' } }, { space: { $eq: 'app' } }],
    });
  });
});

describe('control-construction — inserts', () => {
  it('insertMarkerCommand builds the full marker document', () => {
    const cmd = insertMarkerCommand({
      space: 'app',
      storageHash: 'h1',
      profileHash: 'p1',
      invariants: ['b', 'a'],
    });
    expect(cmd).toBeInstanceOf(InsertOneCommand);
    expect(cmd.collection).toBe(CONTROL_COLLECTION);
    expect(cmd.document).toMatchObject({
      _id: 'app',
      space: 'app',
      storageHash: 'h1',
      profileHash: 'p1',
      contractJson: null,
      canonicalVersion: null,
      appTag: null,
      meta: {},
      invariants: ['b', 'a'],
    });
    expect(cmd.document['updatedAt']).toBeInstanceOf(Date);
  });

  it('insertLedgerCommand builds the ledger document with type=ledger', () => {
    const cmd = insertLedgerCommand({
      space: 'app',
      edgeId: 'e1',
      from: 'h0',
      to: 'h1',
      migrationName: 'm1',
      migrationHash: 'mh1',
      operations: [{ op: 'createCollection' }],
    });
    expect(cmd).toBeInstanceOf(InsertOneCommand);
    expect(cmd.document).toMatchObject({
      type: 'ledger',
      space: 'app',
      edgeId: 'e1',
      from: 'h0',
      to: 'h1',
      migrationName: 'm1',
      migrationHash: 'mh1',
      operations: [{ op: 'createCollection' }],
    });
    expect(cmd.document['appliedAt']).toBeInstanceOf(Date);
  });
});

describe('control-construction — invariant merge', () => {
  it('invariantMergeExpr lowers to the current server-side $sortArray/$setUnion/$ifNull pipeline', () => {
    const merge = invariantMergeExpr(['inv-b', 'inv-a']);
    expect(lowerAggExpr(merge)).toEqual({
      $sortArray: {
        input: {
          $setUnion: [{ $ifNull: ['$invariants', []] }, ['inv-b', 'inv-a']],
        },
        sortBy: 1,
      },
    });
  });
});

describe('control-construction — CAS advance', () => {
  it('advanceMarkerCommand without invariants sets only the scalar fields', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const cmd = advanceMarkerCommand('app', 'h0', {
      storageHash: 'h1',
      profileHash: 'p1',
      updatedAt,
    });
    expect(cmd).toBeInstanceOf(FindOneAndUpdateCommand);
    expect(cmd.collection).toBe(CONTROL_COLLECTION);
    expect(cmd.upsert).toBe(false);
    expect(structuralLowerFilter(cmd.filter)).toEqual({
      $and: [{ _id: { $eq: 'app' } }, { space: { $eq: 'app' } }, { storageHash: { $eq: 'h0' } }],
    });
    const fields = setStageFields(cmd);
    expect(fields).toMatchObject({
      storageHash: { kind: 'literal', value: 'h1' },
      profileHash: { kind: 'literal', value: 'p1' },
      updatedAt: { kind: 'literal', value: updatedAt },
    });
    expect(fields).not.toHaveProperty('invariants');
  });

  it('advanceMarkerCommand with invariants includes the server-side merge expression', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const cmd = advanceMarkerCommand('app', 'h0', {
      storageHash: 'h1',
      profileHash: 'p1',
      updatedAt,
      invariants: ['inv-x'],
    });
    const fields = setStageFields(cmd);
    const invariants = fields['invariants'];
    if (invariants === undefined) {
      throw new Error('expected the merge expression on the invariants field');
    }
    expect(lowerAggExpr(invariants)).toEqual({
      $sortArray: {
        input: { $setUnion: [{ $ifNull: ['$invariants', []] }, ['inv-x']] },
        sortBy: 1,
      },
    });
  });
});
