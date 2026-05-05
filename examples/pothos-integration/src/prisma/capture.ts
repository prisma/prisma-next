/**
 * Per-request SQL execution capture for the demo.
 *
 * Mirrors what `@pothos/plugin-prisma` users typically do with Prisma's
 * `$on('query')` hook: every SQL statement issued during a single
 * GraphQL request is captured into a list, which the server can attach
 * to response extensions or log to stdout.
 *
 * The capture is request-scoped via `AsyncLocalStorage`. The runtime
 * middleware (`captureMiddleware`) reads the current store inside the
 * runtime's `beforeExecute`/`afterExecute` hooks.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AfterExecuteResult } from '@prisma-next/framework-components/runtime';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import type { SqlMiddleware, SqlMiddlewareContext } from '@prisma-next/sql-runtime';

export interface CapturedExecution {
  sql: string;
  params: readonly unknown[];
  rowCount?: number;
  latencyMs?: number;
  completed?: boolean;
  lane?: string;
  target?: string;
}

const captureStore = new AsyncLocalStorage<CapturedExecution[]>();

export function withCapture<T>(captures: CapturedExecution[], fn: () => Promise<T>): Promise<T> {
  return captureStore.run(captures, fn);
}

export function getActiveCaptures(): CapturedExecution[] | undefined {
  return captureStore.getStore();
}

export const captureMiddleware: SqlMiddleware = {
  name: 'pothos-integration-capture',
  familyId: 'sql',
  async beforeExecute(plan: SqlExecutionPlan, _ctx: SqlMiddlewareContext) {
    const captures = captureStore.getStore();
    if (!captures) return;
    captures.push({
      sql: plan.sql,
      params: plan.params,
      lane: plan.meta.lane,
      target: plan.meta.target,
    });
  },
  async afterExecute(
    _plan: SqlExecutionPlan,
    result: AfterExecuteResult,
    _ctx: SqlMiddlewareContext,
  ) {
    const captures = captureStore.getStore();
    if (!captures || captures.length === 0) return;
    const last = captures[captures.length - 1];
    if (!last) return;
    last.rowCount = result.rowCount;
    last.latencyMs = result.latencyMs;
    last.completed = result.completed;
  },
};
