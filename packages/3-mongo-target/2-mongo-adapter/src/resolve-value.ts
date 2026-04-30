import type { CodecCallContext } from '@prisma-next/framework-components/codec';
import {
  raceAgainstAbort,
  runtimeAborted,
  runtimeError,
} from '@prisma-next/framework-components/runtime';
import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';

/**
 * Resolves a `MongoValue` (which may contain `MongoParamRef` leaves) into the
 * driver-ready wire shape. When a leaf has a `codecId` and the registry has a
 * codec for it, the codec's async `encode` is awaited so codecs may perform
 * asynchronous work (e.g. lookups, key derivations).
 *
 * Object/array nodes dispatch their child resolutions concurrently via
 * `Promise.all` so independent leaves encode in parallel.
 *
 * Codec encode failures are wrapped in a `RUNTIME.ENCODE_FAILED` envelope
 * (mirroring SQL's `wrapEncodeFailure` shape) with `{ label, codec }` details
 * and the original error attached on `cause`. An already-wrapped envelope is
 * re-thrown verbatim so nested resolvers don't double-wrap.
 *
 * The optional `ctx?: CodecCallContext` is forwarded verbatim to every
 * `codec.encode(value, ctx)` call. The same `ctx` reference is also passed
 * to nested `resolveValue` invocations so codec authors observe **signal
 * identity** across the entire recursive walk for one `runtime.execute()`.
 *
 * Abort observation (only when `ctx.signal` is provided):
 *
 * - **Already-aborted at entry** — every recursive call pre-checks
 *   `ctx.signal.aborted` and short-circuits with
 *   `RUNTIME.ABORTED { phase: 'encode' }` before any codec is invoked.
 * - **Mid-flight abort** — each per-level `Promise.all` races against the
 *   signal via `raceAgainstAbort`. The runtime returns
 *   `RUNTIME.ABORTED { phase: 'encode' }` promptly even if codec bodies
 *   ignore the signal; in-flight bodies run to completion in the background
 *   (cooperative cancellation, see ADR 204).
 * - `RUNTIME.ENCODE_FAILED` envelopes thrown by a codec body before the
 *   runtime sees the abort pass through unchanged (AC-ERR4).
 */
export async function resolveValue(
  value: MongoValue,
  codecs?: MongoCodecRegistry,
  ctx?: CodecCallContext,
): Promise<unknown> {
  const signal = ctx?.signal;
  if (signal?.aborted) {
    throw runtimeAborted('encode', signal.reason);
  }

  if (value instanceof MongoParamRef) {
    if (value.codecId && codecs) {
      const codec = codecs.get(value.codecId);
      if (codec?.encode) {
        try {
          // Race even leaf scalar encodes against the signal so a leaf
          // `MongoParamRef` (e.g. a simple field filter, or any leaf reached
          // from `MongoAdapterImpl.#resolveDocument()` outside an enclosing
          // `Promise.all`) surfaces `RUNTIME.ABORTED` promptly instead of
          // blocking on a slow codec body.
          const encoded = codec.encode(value.value, ctx);
          return signal ? await raceAgainstAbort(encoded, signal, 'encode') : await encoded;
        } catch (error) {
          wrapEncodeFailure(error, value, codec.id);
        }
      }
    }
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    const tasks = Promise.all(value.map((v) => resolveValue(v, codecs, ctx)));
    return signal ? raceAgainstAbort(tasks, signal, 'encode') : tasks;
  }
  const entries = Object.entries(value);
  const all = Promise.all(entries.map(([, val]) => resolveValue(val, codecs, ctx)));
  const resolved = signal ? await raceAgainstAbort(all, signal, 'encode') : await all;
  const result: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry) {
      result[entry[0]] = resolved[i];
    }
  }
  return result;
}

function paramRefLabel(ref: MongoParamRef, codecId: string): string {
  return ref.name ?? codecId;
}

function isAlreadyEncodeFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === 'RUNTIME.ENCODE_FAILED'
  );
}

function wrapEncodeFailure(error: unknown, ref: MongoParamRef, codecId: string): never {
  if (isAlreadyEncodeFailure(error)) {
    throw error;
  }
  const label = paramRefLabel(ref, codecId);
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codecId}': ${message}`,
    { label, codec: codecId },
  );
  wrapped.cause = error;
  throw wrapped;
}
