import type { ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
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

/**
 * Family-agnostic pre-compile draft. Family runtimes narrow `ast` to their
 * specific AST shape (e.g. `AnyQueryAst` for SQL via `SqlMiddleware.DraftPlan`).
 */
export interface GenericDraftPlan {
  readonly ast: unknown;
  readonly meta: PlanMeta;
}

export interface Middleware<TContract = unknown> extends RuntimeMiddleware {
  beforeCompile?(
    draft: GenericDraftPlan,
    ctx: MiddlewareContext<TContract>,
  ): Promise<GenericDraftPlan | undefined>;
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
