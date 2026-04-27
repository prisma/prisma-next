import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExecutionPlan,
  QueryPlan,
  ResultType,
} from '@prisma-next/framework-components/runtime';
import { InsertOneWireCommand } from '@prisma-next/mongo-wire';
import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoExecutionPlan } from '../src/mongo-execution-plan';

const meta: PlanMeta = {
  target: 'mongodb',
  storageHash: 'sha256:test',
  lane: 'mongo',
  paramDescriptors: [],
};

test('MongoExecutionPlan extends framework ExecutionPlan and QueryPlan', () => {
  const plan: MongoExecutionPlan<{ _id: string }> = {
    command: new InsertOneWireCommand('orders', { _id: 'abc' }),
    meta,
  };
  assertType<ExecutionPlan<{ _id: string }>>(plan);
  assertType<QueryPlan<{ _id: string }>>(plan);
});

test('MongoExecutionPlan carries command, meta, and phantom _row', () => {
  expectTypeOf<MongoExecutionPlan>().toHaveProperty('command');
  expectTypeOf<MongoExecutionPlan>().toHaveProperty('meta');
  expectTypeOf<MongoExecutionPlan>().toHaveProperty('_row');
});

test('Row type is recoverable via ResultType', () => {
  const plan: MongoExecutionPlan<{ _id: string; total: number }> = {
    command: new InsertOneWireCommand('orders', { _id: 'abc', total: 12 }),
    meta,
  };
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toEqualTypeOf<{ _id: string; total: number }>();
});

test('Plan without a wire command does not satisfy MongoExecutionPlan', () => {
  // @ts-expect-error - missing command property
  const _bad: MongoExecutionPlan = { meta };
});

test('Plan command field accepts any wire command shape', () => {
  const plan: MongoExecutionPlan = {
    command: new InsertOneWireCommand('users', { name: 'alice' }),
    meta,
  };
  expectTypeOf(plan.command).toExtend<{
    readonly collection: string;
    readonly kind: string;
  }>();
});
