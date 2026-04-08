import { isRecordArgs, MongoAggAccumulator, MongoAggLiteral } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import type { DocField, NumericField, TypedAggExpr } from '../src/types';

const d: TypedAggExpr<DocField> = {
  _field: { codecId: 'mongo/string@1', nullable: false },
  node: MongoAggLiteral.of('x'),
};

const n: TypedAggExpr<NumericField> = {
  _field: { codecId: 'mongo/double@1', nullable: false } as NumericField,
  node: MongoAggLiteral.of(1),
};

describe('accumulator helpers — single-expr', () => {
  it.each([
    ['stdDevPop', '$stdDevPop'],
    ['stdDevSamp', '$stdDevSamp'],
  ] as const)('acc.%s produces accumulator %s', (helperName, expectedOp) => {
    const helper = acc[helperName] as (a: TypedAggExpr<DocField>) => { node: MongoAggAccumulator };
    const result = helper(d);
    expect(result.node).toBeInstanceOf(MongoAggAccumulator);
    expect(result.node.op).toBe(expectedOp);
  });
});

describe('accumulator helpers — named-args', () => {
  it.each([
    ['firstN', '$firstN', { input: d, n }],
    ['lastN', '$lastN', { input: d, n }],
    ['maxN', '$maxN', { input: d, n }],
    ['minN', '$minN', { input: d, n }],
    ['top', '$top', { output: d, sortBy: d }],
    ['bottom', '$bottom', { output: d, sortBy: d }],
    ['topN', '$topN', { output: d, sortBy: d, n }],
    ['bottomN', '$bottomN', { output: d, sortBy: d, n }],
  ] as const)('acc.%s produces accumulator %s with record arg containing correct keys', (helperName, expectedOp, args) => {
    // narrowed signatures make the union incompatible with a generic Record parameter; cast through unknown
    const helper = acc[helperName] as unknown as (a: Record<string, TypedAggExpr<DocField>>) => {
      node: MongoAggAccumulator;
    };
    const result = helper(args);
    expect(result.node).toBeInstanceOf(MongoAggAccumulator);
    expect(result.node.op).toBe(expectedOp);
    expect(isRecordArgs(result.node.arg!)).toBe(true);
    const recordArg = result.node.arg as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(args)) {
      expect(recordArg).toHaveProperty(key);
    }
  });
});
