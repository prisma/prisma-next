import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import type { MongoQueryPlan } from '@prisma-next/mongo-query-ast/execution';
import type { AnyMongoWireCommand } from '@prisma-next/mongo-wire';

export interface MongoAdapter {
  /**
   * Lower a `MongoQueryPlan` to a driver-ready wire command.
   *
   * `ctx` carries the per-`runtime.execute()` context — today just an
   * `AbortSignal` for cooperative cancellation. The runtime allocates one
   * ctx per execute and threads the same reference through
   * `lower → resolveValue → codec.encode`, so codec authors observe
   * **signal identity** across the whole encode dispatch. The `signal`
   * field inside the ctx may be `undefined`, but the ctx object itself
   * is always present.
   *
   * Implementations are expected to:
   * - Pass `ctx` through to every `resolveValue` call so the per-level
   *   `Promise.all` race can observe the signal.
   * - Surface `RUNTIME.ABORTED { phase: 'encode' }` (via `runtimeAborted`)
   *   from inside `resolveValue` when the signal aborts mid-flight; no
   *   adapter-level abort handling is required beyond ctx forwarding.
   */
  lower(plan: MongoQueryPlan, ctx: CodecCallContext): Promise<AnyMongoWireCommand>;
}
