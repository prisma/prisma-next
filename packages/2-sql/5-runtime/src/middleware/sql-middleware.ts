import type { Contract, ExecutionPlan, PlanMeta } from '@prisma-next/contract/types';
import type {
  AfterExecuteResult,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from '@prisma-next/framework-components/runtime';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { AnyQueryAst } from '@prisma-next/sql-relational-core/ast';

export interface SqlMiddlewareContext extends RuntimeMiddlewareContext {
  readonly contract: Contract<SqlStorage>;
}

/**
 * Pre-lowering query view passed to `beforeCompile`. Carries the typed SQL
 * AST and plan metadata; `sql`/`params` are produced later by the adapter.
 */
export interface DraftPlan {
  readonly ast: AnyQueryAst;
  readonly meta: PlanMeta;
}

export interface SqlMiddleware extends RuntimeMiddleware {
  readonly familyId?: 'sql';
  /**
   * Rewrite the query AST before it is lowered to SQL. Middlewares run in
   * registration order; each sees the predecessor's output, so rewrites
   * compose (e.g. soft-delete + tenant isolation).
   *
   * Return `undefined` (or a draft whose `ast` reference equals the input's)
   * to pass through. Return a draft with a new `ast` reference to replace it;
   * the runtime emits a `middleware.rewrite` debug log event and continues
   * with the new draft. `adapter.lower()` runs once after the chain.
   *
   * Use `AstRewriter` / `SelectAst.withWhere` / `AndExpr.of` etc. to build
   * the rewritten AST. Predicates and literals go through parameterized
   * constructors by default — no SQL-injection surface is added. **Warning:**
   * constructing `LiteralExpr.of(userInput)` from untrusted input bypasses
   * that guarantee; use `ParamRef.of(userInput, ...)` instead.
   *
   * See `docs/architecture docs/subsystems/4. Runtime & Middleware Framework.md`.
   */
  beforeCompile?(draft: DraftPlan, ctx: SqlMiddlewareContext): Promise<DraftPlan | undefined>;
  beforeExecute?(plan: ExecutionPlan, ctx: SqlMiddlewareContext): Promise<void>;
  onRow?(
    row: Record<string, unknown>,
    plan: ExecutionPlan,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
  afterExecute?(
    plan: ExecutionPlan,
    result: AfterExecuteResult,
    ctx: SqlMiddlewareContext,
  ): Promise<void>;
}
