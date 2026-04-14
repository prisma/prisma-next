import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import { assertType, expectTypeOf, test } from 'vitest';
import type {
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/runtime-middleware';

test('ExecutionPlan satisfies RuntimeExecutor plan constraint', () => {
  type SqlExecutor = RuntimeExecutor<ExecutionPlan>;
  expectTypeOf<SqlExecutor>().toHaveProperty('execute');
  expectTypeOf<SqlExecutor>().toHaveProperty('close');
});

test('MongoQueryPlan-shaped type satisfies RuntimeExecutor plan constraint', () => {
  interface MongoLikePlan {
    readonly collection: string;
    readonly command: unknown;
    readonly meta: PlanMeta;
  }
  type MongoExecutor = RuntimeExecutor<MongoLikePlan>;
  expectTypeOf<MongoExecutor>().toHaveProperty('execute');
  expectTypeOf<MongoExecutor>().toHaveProperty('close');
});

test('type without meta does not satisfy plan constraint', () => {
  // @ts-expect-error - missing meta property
  type _Invalid = RuntimeExecutor<{ sql: string }>;
});

test('RuntimeMiddleware hooks accept both ExecutionPlan and MongoQueryPlan-shaped plans', () => {
  const middleware: RuntimeMiddleware = {
    name: 'test',
    async beforeExecute(plan) {
      assertType<PlanMeta>(plan.meta);
    },
    async onRow(row, plan) {
      assertType<Record<string, unknown>>(row);
      assertType<PlanMeta>(plan.meta);
    },
    async afterExecute(plan, result) {
      assertType<PlanMeta>(plan.meta);
      assertType<number>(result.rowCount);
      assertType<number>(result.latencyMs);
      assertType<boolean>(result.completed);
    },
  };
  void middleware;
});

test('RuntimeMiddlewareContext has contract, mode, log, now', () => {
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('contract');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('mode');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('log');
  expectTypeOf<RuntimeMiddlewareContext>().toHaveProperty('now');
});

test('RuntimeMiddleware familyId and targetId are optional', () => {
  const generic: RuntimeMiddleware = { name: 'generic' };
  const familyBound: RuntimeMiddleware = { name: 'sql-only', familyId: 'sql' };
  const targetBound: RuntimeMiddleware = {
    name: 'pg-only',
    familyId: 'sql',
    targetId: 'postgres',
  };
  void generic;
  void familyBound;
  void targetBound;
});
