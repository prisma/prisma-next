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

/**
 * Legacy contract-typed middleware used by `RuntimeCoreImpl`.
 *
 * Structurally a `RuntimeMiddleware<ExecutionPlan>` — the override only
 * narrows the context type to `MiddlewareContext<TContract>` and adds the
 * `beforeCompile?` AST-rewriting hook. SQL middleware (`SqlMiddleware`)
 * extends `RuntimeMiddleware` directly, not this type, so this interface
 * survives only to preserve the contract-typed context for callers of
 * `RuntimeCoreImpl`. M3 deletes `RuntimeCoreImpl` and folds this type
 * away alongside it.
 */
export interface Middleware<TContract = unknown> extends RuntimeMiddleware<ExecutionPlan> {
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
