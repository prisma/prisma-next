import type { PlanMeta } from '@prisma-next/contract/types';
import { assertType, expectTypeOf, test } from 'vitest';
import type { ExecutionPlan, QueryPlan } from '../src/query-plan';
import type {
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '../src/runtime-middleware';

test('framework ExecutionPlan satisfies RuntimeExecutor plan constraint', () => {
  type Executor = RuntimeExecutor<ExecutionPlan>;
  expectTypeOf<Executor>().toHaveProperty('execute');
  expectTypeOf<Executor>().toHaveProperty('close');
});

test('SQL-shaped plan satisfies RuntimeExecutor plan constraint', () => {
  interface SqlShapedPlan extends QueryPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  type SqlExecutor = RuntimeExecutor<SqlShapedPlan>;
  expectTypeOf<SqlExecutor>().toHaveProperty('execute');
  expectTypeOf<SqlExecutor>().toHaveProperty('close');
});

test('MongoQueryPlan-shaped type satisfies RuntimeExecutor plan constraint', () => {
  interface MongoLikePlan extends QueryPlan {
    readonly collection: string;
    readonly command: unknown;
  }
  type MongoExecutor = RuntimeExecutor<MongoLikePlan>;
  expectTypeOf<MongoExecutor>().toHaveProperty('execute');
  expectTypeOf<MongoExecutor>().toHaveProperty('close');
});

test('type without meta does not satisfy plan constraint', () => {
  // @ts-expect-error - missing meta property required by QueryPlan
  type _Invalid = RuntimeExecutor<{ sql: string }>;
});

test('RuntimeMiddleware default plan parameter sees only QueryPlan fields', () => {
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

test('RuntimeMiddleware narrowed to a SQL plan sees the SQL fields', () => {
  interface SqlExec extends ExecutionPlan {
    readonly sql: string;
    readonly params: readonly unknown[];
  }
  const middleware: RuntimeMiddleware<SqlExec> = {
    name: 'sql-test',
    async beforeExecute(plan) {
      assertType<string>(plan.sql);
      assertType<readonly unknown[]>(plan.params);
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
