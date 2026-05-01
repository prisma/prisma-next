import { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan } from './query-plan';
import { checkAborted, raceAgainstAbort } from './race-against-abort';
import type {
  ParamRefMutator,
  RuntimeMiddleware,
  RuntimeMiddlewareContext,
} from './runtime-middleware';

/**
 * Drives a single execution of `runDriver()` through the middleware lifecycle.
 *
 * Lifecycle, in order:
 *  1. For each middleware in registration order: `beforeExecute(exec, ctx,
 *     paramsMutator)`. The mutator is the family-specific
 *     {@link ParamRefMutator} the caller passes through (`undefined` for
 *     plans / families with no mutator surface). Cooperative cancellation:
 *     before each middleware body, an already-aborted `ctx.signal` throws
 *     `RUNTIME.ABORTED { phase: 'beforeExecute' }`; mid-flight aborts race
 *     the body via `raceAgainstAbort` so the runtime returns
 *     `RUNTIME.ABORTED` promptly even when the middleware ignores the
 *     signal. Non-abort errors thrown by a middleware body pass through
 *     unchanged.
 *  2. For each row yielded by `runDriver()`: for each middleware in registration
 *     order: `onRow(row, exec, ctx)`; then yield the row to the consumer.
 *  3. On successful completion: for each middleware in registration order:
 *     `afterExecute(exec, { rowCount, latencyMs, completed: true }, ctx)`.
 *  4. On any error thrown by the driver loop: for each middleware in
 *     registration order: `afterExecute(exec, { rowCount, latencyMs,
 *     completed: false }, ctx)`. Errors thrown by `afterExecute` during the
 *     error path are swallowed so they do not mask the original driver error.
 *     The original error is then rethrown.
 *
 * This helper is the single canonical implementation of the middleware
 * orchestration loop; family runtimes should not reimplement it.
 */
export function runWithMiddleware<
  TExec extends ExecutionPlan,
  Row,
  TMutator extends ParamRefMutator = ParamRefMutator,
>(
  exec: TExec,
  middleware: ReadonlyArray<RuntimeMiddleware<TExec, TMutator>>,
  ctx: RuntimeMiddlewareContext,
  runDriver: () => AsyncIterable<Row>,
  paramsMutator?: TMutator,
): AsyncIterableResult<Row> {
  const iterator = async function* (): AsyncGenerator<Row, void, unknown> {
    const startedAt = Date.now();
    let rowCount = 0;
    let completed = false;

    try {
      for (const mw of middleware) {
        if (mw.beforeExecute) {
          // Already-aborted at entry to this middleware short-circuits with
          // a phase-tagged envelope before the body runs (AC-ABT2).
          checkAborted(ctx, 'beforeExecute');
          // The framework only forwards the mutator the caller supplied; a
          // pass-through `undefined` for non-mutating families is safe — the
          // base `RuntimeMiddleware` declares the third parameter, and
          // existing `(plan, ctx)` bodies that ignore it stay unchanged.
          // The cast below is the single point at which the framework's
          // generic mutator slot meets the (possibly absent) caller value;
          // `runWithMiddleware` cannot synthesize a TMutator instance.
          const work = mw.beforeExecute(exec, ctx, paramsMutator as TMutator);
          if (work !== undefined) {
            // Mid-flight abort surfaces RUNTIME.ABORTED promptly even when
            // the middleware body ignores ctx.signal (AC-ABT3).
            await raceAgainstAbort(Promise.resolve(work), ctx.signal, 'beforeExecute');
          }
        }
      }

      for await (const row of runDriver()) {
        for (const mw of middleware) {
          if (mw.onRow) {
            await mw.onRow(row as Record<string, unknown>, exec, ctx);
          }
        }
        rowCount++;
        yield row;
      }

      completed = true;
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      for (const mw of middleware) {
        if (mw.afterExecute) {
          try {
            await mw.afterExecute(exec, { rowCount, latencyMs, completed }, ctx);
          } catch {
            // Swallow afterExecute errors during the error path so they do not
            // mask the original driver error.
          }
        }
      }

      throw error;
    }

    const latencyMs = Date.now() - startedAt;
    for (const mw of middleware) {
      if (mw.afterExecute) {
        await mw.afterExecute(exec, { rowCount, latencyMs, completed }, ctx);
      }
    }
  };

  return new AsyncIterableResult(iterator());
}
