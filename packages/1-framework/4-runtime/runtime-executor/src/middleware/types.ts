import type { ExecutionPlan } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeLog,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';

export type Severity = 'error' | 'warn' | 'info';

export type { AfterExecuteResult, RuntimeLog as Log };

export interface MiddlewareContext<TContract = unknown> extends RuntimeMiddlewareContext {
  readonly contract: TContract;
}

export interface Middleware<TContract = unknown> extends RuntimeMiddleware {
  beforeExecute?(plan: ExecutionPlan, ctx: MiddlewareContext<TContract>): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: ExecutionPlan,
    ctx: MiddlewareContext<TContract>,
  ): Promise<void>;
  afterExecute?(
    plan: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: MiddlewareContext<TContract>,
  ): Promise<void>;
}
