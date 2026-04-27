import type { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan, QueryPlan } from './query-plan';
import { runtimeError } from './runtime-error';

export interface RuntimeLog {
  info(event: unknown): void;
  warn(event: unknown): void;
  error(event: unknown): void;
  debug?(event: unknown): void;
}

export interface RuntimeMiddlewareContext {
  readonly contract: unknown;
  readonly mode: 'strict' | 'permissive';
  readonly now: () => number;
  readonly log: RuntimeLog;
  /**
   * Returns a stable string identifying the (storage, statement, params)
   * tuple of an execution. Two semantically equivalent executions return
   * the same string. Used by middleware that need per-execution identity
   * (caching, request coalescing).
   *
   * The family runtime owns the implementation:
   * - SQL: `meta.storageHash` + `exec.sql` + `canonicalStringify(exec.params)`
   * - Mongo: `meta.storageHash` + `canonicalStringify(exec.command)`
   *
   * The returned string is intended to be consumed directly as a `Map` key
   * — it is not (and should not be) further hashed by callers.
   */
  identityKey(exec: ExecutionPlan): string;
}

export interface AfterExecuteResult {
  readonly rowCount: number;
  readonly latencyMs: number;
  readonly completed: boolean;
  /**
   * Indicates where the rows observed during this execution came from.
   *
   * - `'driver'` — the default. Rows came from the underlying driver via
   *   `runDriver` / `runWithMiddleware`'s normal path.
   * - `'middleware'` — a `RuntimeMiddleware.intercept` hook short-circuited
   *   execution and supplied the rows directly. The driver was not invoked.
   *
   * Observers (telemetry, lints, budgets) that need to distinguish between
   * driver-served and middleware-served executions read this field.
   * Observers that don't care can ignore it.
   */
  readonly source: 'driver' | 'middleware';
}

/**
 * Family-agnostic middleware SPI parameterized over the plan marker.
 *
 * `TPlan` defaults to the framework `QueryPlan` marker so a generic
 * middleware (e.g. cross-family telemetry) can be authored without
 * naming a family. Family-specific middleware (`SqlMiddleware`,
 * `MongoMiddleware`) narrow `TPlan` to their concrete plan type.
 */
export interface RuntimeMiddleware<TPlan extends QueryPlan = QueryPlan> {
  readonly name: string;
  readonly familyId?: string;
  readonly targetId?: string;
  beforeExecute?(plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<void>;
  onRow?(row: Record<string, unknown>, plan: TPlan, ctx: RuntimeMiddlewareContext): Promise<void>;
  afterExecute?(
    plan: TPlan,
    result: AfterExecuteResult,
    ctx: RuntimeMiddlewareContext,
  ): Promise<void>;
}

/**
 * Cross-family SPI for any runtime that can execute plans and be shut down.
 * Each family runtime (SQL, Mongo) satisfies this interface — SQL nominally,
 * Mongo structurally (due to its phantom Row parameter using a unique symbol).
 *
 * The `_row` intersection on `execute` connects the `Row` type parameter to the
 * plan, mirroring how `QueryPlan<Row>` carries a phantom `_row?: Row`.
 */
export interface RuntimeExecutor<TPlan extends QueryPlan> {
  execute<Row>(plan: TPlan & { readonly _row?: Row }): AsyncIterableResult<Row>;
  close(): Promise<void>;
}

export function checkMiddlewareCompatibility(
  middleware: RuntimeMiddleware,
  runtimeFamilyId: string,
  runtimeTargetId: string,
): void {
  if (middleware.targetId !== undefined && middleware.familyId === undefined) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_INCOMPATIBLE',
      `Middleware '${middleware.name}' specifies targetId '${middleware.targetId}' without familyId`,
      { middleware: middleware.name, targetId: middleware.targetId },
    );
  }

  if (middleware.familyId !== undefined && middleware.familyId !== runtimeFamilyId) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_FAMILY_MISMATCH',
      `Middleware '${middleware.name}' requires family '${middleware.familyId}' but the runtime is configured for family '${runtimeFamilyId}'`,
      { middleware: middleware.name, middlewareFamilyId: middleware.familyId, runtimeFamilyId },
    );
  }

  if (middleware.targetId !== undefined && middleware.targetId !== runtimeTargetId) {
    throw runtimeError(
      'RUNTIME.MIDDLEWARE_TARGET_MISMATCH',
      `Middleware '${middleware.name}' requires target '${middleware.targetId}' but the runtime is configured for target '${runtimeTargetId}'`,
      { middleware: middleware.name, middlewareTargetId: middleware.targetId, runtimeTargetId },
    );
  }
}
