import type { PlanMeta } from '@prisma-next/contract/types';
import type {
  ExecutionPlan,
  QueryPlan,
  ResultType,
} from '@prisma-next/framework-components/runtime';
import { assertType, expectTypeOf, test } from 'vitest';
import type { SqlExecutionPlan } from '../src/sql-execution-plan';

const meta: PlanMeta = {
  target: 'postgres',
  storageHash: 'sha256:test',
  lane: 'sql',
  paramDescriptors: [],
};

test('SqlExecutionPlan extends framework ExecutionPlan and QueryPlan', () => {
  const plan: SqlExecutionPlan<{ id: number }> = {
    sql: 'SELECT 1',
    params: [],
    meta,
  };
  assertType<ExecutionPlan<{ id: number }>>(plan);
  assertType<QueryPlan<{ id: number }>>(plan);
});

test('SqlExecutionPlan carries sql, params, optional ast, meta, and phantom _row', () => {
  expectTypeOf<SqlExecutionPlan>().toHaveProperty('sql');
  expectTypeOf<SqlExecutionPlan>().toHaveProperty('params');
  expectTypeOf<SqlExecutionPlan>().toHaveProperty('ast');
  expectTypeOf<SqlExecutionPlan>().toHaveProperty('meta');
  expectTypeOf<SqlExecutionPlan>().toHaveProperty('_row');
});

test('Row type is recoverable via ResultType', () => {
  const plan: SqlExecutionPlan<{ id: number; email: string }> = {
    sql: 'SELECT id, email FROM users',
    params: [],
    meta,
  };
  type Row = ResultType<typeof plan>;
  expectTypeOf<Row>().toEqualTypeOf<{ id: number; email: string }>();
});

test('Plan without sql does not satisfy SqlExecutionPlan', () => {
  // @ts-expect-error - missing sql property
  const _bad: SqlExecutionPlan = { params: [], meta };
});

test('Plan without params does not satisfy SqlExecutionPlan', () => {
  // @ts-expect-error - missing params property
  const _bad: SqlExecutionPlan = { sql: 'SELECT 1', meta };
});
