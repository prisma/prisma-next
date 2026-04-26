import { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { runWithMiddleware } from './run-with-middleware';
import type {
  RuntimeExecutor,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from './runtime-middleware';

/**
 * Constructor options shared by every concrete `RuntimeCore` subclass.
 *
 * Family runtimes typically build the middleware list and the
 * `RuntimeMiddlewareContext` themselves (running compatibility checks,
 * narrowing the context's `contract` field, etc.) before calling `super`.
 */
export interface RuntimeCoreOptions<TMiddleware extends RuntimeMiddleware<ExecutionPlan>> {
  readonly middleware: ReadonlyArray<TMiddleware>;
  readonly ctx: RuntimeMiddlewareContext;
}

/**
 * Family-agnostic abstract runtime base.
 *
 * Defines the entire `execute(plan)` template in one place:
 *
 * 1. `runBeforeCompile(plan)` — concrete; defaults to identity. SQL overrides
 *    this to run its `beforeCompile` middleware-hook chain.
 * 2. `lower(plan)` — abstract. Each family produces its `*ExecutionPlan`
 *    (SQL via `lowerSqlPlan`, Mongo via `adapter.lower`).
 * 3. `runWithMiddleware(exec, this.middleware, this.ctx,
 *    () => runDriver(exec))` — concrete; lifts the middleware lifecycle
 *    out of the family runtimes into the canonical helper.
 *
 * Concrete subclasses must implement `lower`, `runDriver`, and `close`.
 *
 * The class is generic over:
 * - `TPlan` — the family's pre-lowering plan type.
 * - `TExec` — the family's post-lowering (executable) plan type.
 * - `TMiddleware` — the family's middleware type. Constrained to
 *   `RuntimeMiddleware<TExec>` because `runWithMiddleware` invokes the
 *   `beforeExecute` / `onRow` / `afterExecute` hooks with the lowered
 *   `TExec`. (The spec/plan wording "RuntimeMiddleware<TPlan>" is
 *   tightened to `<TExec>` here so the helper call typechecks; the
 *   intent is unchanged — middleware sees the post-lowering plan.)
 */
export abstract class RuntimeCore<
  TPlan extends QueryPlan,
  TExec extends ExecutionPlan,
  TMiddleware extends RuntimeMiddleware<TExec>,
> implements RuntimeExecutor<TPlan>
{
  protected readonly middleware: ReadonlyArray<TMiddleware>;
  protected readonly ctx: RuntimeMiddlewareContext;

  constructor(options: RuntimeCoreOptions<TMiddleware>) {
    this.middleware = options.middleware;
    this.ctx = options.ctx;
  }

  /**
   * Pre-lowering hook for plan rewriting. Defaults to identity. Subclasses
   * may override to run a `beforeCompile` middleware chain (SQL does this
   * to support typed AST rewrites — see `before-compile-chain.ts`).
   */
  protected runBeforeCompile(plan: TPlan): TPlan | Promise<TPlan> {
    return plan;
  }

  /**
   * Lower a pre-lowering `TPlan` into the family's executable `TExec`.
   * Family-specific: SQL produces `{ sql, params, ast?, ... }`; Mongo
   * produces `{ command, ... }`.
   */
  protected abstract lower(plan: TPlan): TExec | Promise<TExec>;

  /**
   * Drive the underlying transport for a lowered `TExec`. Yields raw rows
   * directly from the driver as `Record<string, unknown>`; codec decoding
   * (if any) is the subclass's responsibility, applied by wrapping
   * `execute()` rather than living inside this hook.
   *
   * The `Row` type parameter on `execute()` is satisfied by the caller via
   * the plan's phantom `_row`; the runtime treats rows as opaque records
   * here and trusts the caller's row typing.
   */
  protected abstract runDriver(exec: TExec): AsyncIterable<Record<string, unknown>>;

  abstract close(): Promise<void>;

  execute<Row>(plan: TPlan & { readonly _row?: Row }): AsyncIterableResult<Row> {
    const self = this;

    async function* generator(): AsyncGenerator<Row, void, unknown> {
      const compiled = await self.runBeforeCompile(plan);
      const exec = await self.lower(compiled);
      // The driver yields raw `Record<string, unknown>`; we cast to `Row` here.
      // The Row contract is enforced by the caller via `plan._row`.
      yield* runWithMiddleware<TExec, Row>(
        exec,
        self.middleware,
        self.ctx,
        () => self.runDriver(exec) as AsyncIterable<Row>,
      );
    }

    return new AsyncIterableResult(generator());
  }
}
