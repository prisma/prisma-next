import { isRecordArgs, MongoAggLiteral, MongoAggOperator } from '@prisma-next/mongo-query-ast';
import { describe, expect, it } from 'vitest';
import { fn } from '../src/expression-helpers';
import type { DocField, TypedAggExpr } from '../src/types';

const d: TypedAggExpr<DocField> = {
  _field: { codecId: 'mongo/string@1', nullable: false },
  node: MongoAggLiteral.of('x'),
};

describe('expression helpers — unary', () => {
  it.each([
    ['year', '$year'],
    ['month', '$month'],
    ['dayOfMonth', '$dayOfMonth'],
    ['hour', '$hour'],
    ['minute', '$minute'],
    ['second', '$second'],
    ['millisecond', '$millisecond'],
    ['toLower', '$toLower'],
    ['toUpper', '$toUpper'],
    ['size', '$size'],
    ['strLenCP', '$strLenCP'],
    ['strLenBytes', '$strLenBytes'],
    ['isArray', '$isArray'],
    ['anyElementTrue', '$anyElementTrue'],
    ['allElementsTrue', '$allElementsTrue'],
    ['typeOf', '$type'],
    ['toInt', '$toInt'],
    ['toLong', '$toLong'],
    ['toDouble', '$toDouble'],
    ['toDecimal', '$toDecimal'],
    ['toString_', '$toString'],
    ['toObjectId', '$toObjectId'],
    ['toBool', '$toBool'],
    ['toDate', '$toDate'],
    ['reverseArray', '$reverseArray'],
    ['objectToArray', '$objectToArray'],
    ['arrayToObject', '$arrayToObject'],
    ['firstElem', '$first'],
    ['lastElem', '$last'],
  ] as const)('fn.%s produces operator %s', (helperName, expectedOp) => {
    const helper = fn[helperName] as (a: TypedAggExpr<DocField>) => TypedAggExpr<DocField>;
    const result = helper(d);
    expect(result.node).toBeInstanceOf(MongoAggOperator);
    expect((result.node as MongoAggOperator).op).toBe(expectedOp);
  });
});

describe('expression helpers — positional multi-arg', () => {
  it.each([
    ['add', '$add'],
    ['subtract', '$subtract'],
    ['multiply', '$multiply'],
    ['divide', '$divide'],
    ['concat', '$concat'],
    ['substr', '$substr'],
    ['substrBytes', '$substrBytes'],
    ['cmp', '$cmp'],
    ['eq', '$eq'],
    ['ne', '$ne'],
    ['gt', '$gt'],
    ['gte', '$gte'],
    ['lt', '$lt'],
    ['lte', '$lte'],
    ['split', '$split'],
    ['arrayElemAt', '$arrayElemAt'],
    ['concatArrays', '$concatArrays'],
    ['isIn', '$in'],
    ['indexOfArray', '$indexOfArray'],
    ['slice', '$slice'],
    ['range', '$range'],
    ['setUnion', '$setUnion'],
    ['setIntersection', '$setIntersection'],
    ['setDifference', '$setDifference'],
    ['setEquals', '$setEquals'],
    ['setIsSubset', '$setIsSubset'],
  ] as const)('fn.%s produces operator %s with array args', (helperName, expectedOp) => {
    const helper = fn[helperName] as (...a: TypedAggExpr<DocField>[]) => TypedAggExpr<DocField>;
    const result = helper(d, d, d);
    expect(result.node).toBeInstanceOf(MongoAggOperator);
    const op = result.node as MongoAggOperator;
    expect(op.op).toBe(expectedOp);
    expect(Array.isArray(op.args)).toBe(true);
  });
});

describe('expression helpers — named-args', () => {
  it.each([
    ['dateToString', '$dateToString', { date: d, format: d }],
    ['dateFromString', '$dateFromString', { dateString: d }],
    ['dateDiff', '$dateDiff', { startDate: d, endDate: d, unit: d }],
    ['dateAdd', '$dateAdd', { startDate: d, unit: d, amount: d }],
    ['dateSubtract', '$dateSubtract', { startDate: d, unit: d, amount: d }],
    ['dateTrunc', '$dateTrunc', { date: d, unit: d }],
    ['trim', '$trim', { input: d }],
    ['ltrim', '$ltrim', { input: d }],
    ['rtrim', '$rtrim', { input: d }],
    ['regexMatch', '$regexMatch', { input: d, regex: d }],
    ['regexFind', '$regexFind', { input: d, regex: d }],
    ['regexFindAll', '$regexFindAll', { input: d, regex: d }],
    ['replaceOne', '$replaceOne', { input: d, find: d, replacement: d }],
    ['replaceAll', '$replaceAll', { input: d, find: d, replacement: d }],
    ['zip', '$zip', { inputs: d }],
    ['convert', '$convert', { input: d, to: d }],
    ['getField', '$getField', { field: d, input: d }],
    ['setField', '$setField', { field: d, input: d, value: d }],
  ] as const)('fn.%s produces operator %s with record args containing correct keys', (helperName, expectedOp, args) => {
    const helper = fn[helperName] as (
      a: Record<string, TypedAggExpr<DocField>>,
    ) => TypedAggExpr<DocField>;
    const result = helper(args);
    expect(result.node).toBeInstanceOf(MongoAggOperator);
    const op = result.node as MongoAggOperator;
    expect(op.op).toBe(expectedOp);
    expect(isRecordArgs(op.args)).toBe(true);
    const recordArgs = op.args as Readonly<Record<string, unknown>>;
    for (const key of Object.keys(args)) {
      expect(recordArgs).toHaveProperty(key);
    }
  });
});
