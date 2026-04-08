import { isRecordArgs, MongoAggAccumulator, MongoAggLiteral } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import type { DocField, TypedAggExpr } from '../src/types';

const d: TypedAggExpr<DocField> = {
  _field: { codecId: 'mongo/string@1', nullable: false },
  node: MongoAggLiteral.of('x'),
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
    ['firstN', '$firstN', { input: d, n: d }],
    ['lastN', '$lastN', { input: d, n: d }],
    ['maxN', '$maxN', { input: d, n: d }],
    ['minN', '$minN', { input: d, n: d }],
    ['top', '$top', { output: d, sortBy: d }],
    ['bottom', '$bottom', { output: d, sortBy: d }],
    ['topN', '$topN', { output: d, sortBy: d, n: d }],
    ['bottomN', '$bottomN', { output: d, sortBy: d, n: d }],
  ] as const)('acc.%s produces accumulator %s with record arg containing correct keys', (helperName, expectedOp, args) => {
    const helper = acc[helperName] as (a: Record<string, TypedAggExpr<DocField>>) => {
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
