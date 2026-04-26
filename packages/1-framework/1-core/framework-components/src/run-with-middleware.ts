import { AsyncIterableResult } from './async-iterable-result';
import type { ExecutionPlan } from './query-plan';
import type { RuntimeMiddleware, RuntimeMiddlewareContext } from './runtime-middleware';

/**
 * Drives a single execution of `runDriver()` through the middleware lifecycle.
 *
 * Lifecycle, in order:
 *  1. For each middleware in registration order: `beforeExecute(exec, ctx)`.
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
 * orchestration loop; family runtimes should not reimplement it. The body
 * is lifted from the SQL-flavored `RuntimeCoreImpl.#executeWith` so that
 * cross-family adoption in M3/M4 preserves observable behavior bit-for-bit.
 */
export function runWithMiddleware<TExec extends ExecutionPlan, Row>(
  exec: TExec,
  middleware: ReadonlyArray<RuntimeMiddleware<TExec>>,
  ctx: RuntimeMiddlewareContext,
  runDriver: () => AsyncIterable<Row>,
): AsyncIterableResult<Row> {
  const iterator = async function* (): AsyncGenerator<Row, void, unknown> {
    const startedAt = Date.now();
    let rowCount = 0;
    let completed = false;

    try {
      for (const mw of middleware) {
        if (mw.beforeExecute) {
          await mw.beforeExecute(exec, ctx);
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
