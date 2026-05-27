import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import { expectTypeOf, test } from 'vitest';
import type { MongoRawClient } from '../src/mongo-raw';
import type { RawMongoCollection } from '../src/raw-collection';
import type { OrmTestContract } from './hydrate-contract-cross-refs';

type Raw = MongoRawClient<OrmTestContract>;

test('collection accepts valid root names', () => {
  expectTypeOf<Raw['collection']>().toBeCallableWith('tasks');
  expectTypeOf<Raw['collection']>().toBeCallableWith('users');
});

test('collection rejects invalid root names', () => {
  // @ts-expect-error - 'nonexistent' is not a valid root name
  expectTypeOf<Raw['collection']>().toBeCallableWith('nonexistent');
});

test('collection returns RawMongoCollection', () => {
  expectTypeOf<ReturnType<Raw['collection']>>().toExtend<RawMongoCollection>();
});

test('aggregate build returns MongoQueryPlan', () => {
  type Col = ReturnType<Raw['collection']>;
  type AggFn = Col['aggregate'];
  type BuildFn = ReturnType<AggFn>['build'];
  expectTypeOf<ReturnType<BuildFn>>().toExtend<MongoQueryPlan>();
});
