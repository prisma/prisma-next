import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoAdapter {
  /**
   * Lower a `MongoQueryPlan` to a driver-ready wire command.
   *
   * The optional `ctx` carries the per-`runtime.execute()` context — today
   * just an `AbortSignal` for cooperative cancellation. The runtime forwards
   * `ctx` verbatim through `lower → resolveValue → codec.encode`, so codec
   * authors observe **signal identity** across the whole encode dispatch.
   *
   * Implementations are expected to:
   * - Pass `ctx` through to every `resolveValue` call so the per-level
   *   `Promise.all` race can observe the signal.
   * - Surface `RUNTIME.ABORTED { phase: 'encode' }` (via `runtimeAborted`)
   *   from inside `resolveValue` when the signal aborts mid-flight; no
   *   adapter-level abort handling is required beyond ctx forwarding.
   *
   * Omitting `ctx` continues to be supported and is bit-for-bit identical
   * to today (no abort observation).
   */
  lower(plan: MongoQueryPlan, ctx?: CodecCallContext): Promise<AnyMongoWireCommand>;
}
