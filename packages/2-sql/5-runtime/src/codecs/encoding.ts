import {
  raceAgainstAbort,
  runtimeAborted,
  runtimeError,
} from '@prisma-next/framework-components/runtime';
import {
  type Codec,
  type CodecRegistry,
  type SqlCodecCallContext,
  collectOrderedParamRefs,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';

interface ParamMetadata {
  readonly codecId: string | undefined;
  readonly name: string | undefined;
}

const NO_METADATA: ParamMetadata = Object.freeze({ codecId: undefined, name: undefined });

function paramLabel(metadata: ParamMetadata, paramIndex: number): string {
  return metadata.name ?? `param[${paramIndex}]`;
}

function wrapEncodeFailure(
  error: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  codecId: string,
): never {
  const label = paramLabel(metadata, paramIndex);
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codecId}': ${message}`,
    { label, codec: codecId, paramIndex },
  );
  wrapped.cause = error;
  throw wrapped;
}

/**
 * Encodes a single parameter through its codec. Always awaits codec.encode so
 * a Promise can never leak into the driver, even if a sync-authored codec is
 * lifted to async by the codec() factory. Failures are wrapped in
 * `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original
 * error attached on `cause`.
 *
 * The optional `ctx` is forwarded verbatim to `codec.encode` so codec authors
 * who opt into the `(value, ctx)` arity see the same `SqlCodecCallContext`
 * the runtime built for the surrounding `runtime.execute()` call. Encode
 * call sites do not populate `ctx.column` — encode-time column context is
 * the middleware's domain.
 */
export async function encodeParam(
  value: unknown,
  paramRef: { readonly codecId?: string; readonly name?: string },
  paramIndex: number,
  registry: CodecRegistry,
  ctx?: SqlCodecCallContext,
): Promise<unknown> {
  return encodeParamValue(
    value,
    { codecId: paramRef.codecId, name: paramRef.name },
    paramIndex,
    registry,
    ctx,
  );
}

async function encodeParamValue(
  value: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  registry: CodecRegistry,
  ctx?: SqlCodecCallContext,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  if (!metadata.codecId) {
    return value;
  }

  const codec: Codec | undefined = registry.get(metadata.codecId);
  if (!codec) {
    return value;
  }

  try {
    return await codec.encode(value, ctx);
  } catch (error) {
    wrapEncodeFailure(error, metadata, paramIndex, codec.id);
  }
}

/**
 * Encodes all parameters concurrently via `Promise.all`. Per parameter, sync-
 * and async-authored codecs share the same path: `codec.encode → await →
 * return`. Param-level failures are wrapped in `RUNTIME.ENCODE_FAILED`.
 *
 * When the optional `ctx.signal` is provided:
 *
 * - **Already-aborted at entry** short-circuits with `RUNTIME.ABORTED`
 *   (`{ phase: 'encode' }`) before any `codec.encode` call is made — codecs
 *   can pin this with a per-call counter that stays at zero.
 * - **Mid-flight abort** races the per-param `Promise.all` against
 *   `abortable(ctx.signal)`. The runtime returns `RUNTIME.ABORTED` promptly
 *   even if codec bodies ignore the signal; the in-flight bodies are
 *   abandoned and run to completion in the background (cooperative
 *   cancellation, see ADR 204).
 * - Existing `RUNTIME.ENCODE_FAILED` envelopes that surface from a codec
 *   body before the runtime observes the abort pass through unchanged
 *   (no double wrap).
 */
export async function encodeParams(
  plan: SqlExecutionPlan,
  registry: CodecRegistry,
  ctx?: SqlCodecCallContext,
): Promise<readonly unknown[]> {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const signal = ctx?.signal;
  if (signal?.aborted) {
    throw runtimeAborted('encode', signal.reason);
  }

  const paramCount = plan.params.length;
  const metadata: ParamMetadata[] = new Array(paramCount).fill(NO_METADATA);

  if (plan.ast) {
    const refs = collectOrderedParamRefs(plan.ast);
    for (let i = 0; i < paramCount && i < refs.length; i++) {
      const ref = refs[i];
      if (ref) {
        metadata[i] = { codecId: ref.codecId, name: ref.name };
      }
    }
  }

  const tasks: Promise<unknown>[] = new Array(paramCount);
  for (let i = 0; i < paramCount; i++) {
    tasks[i] = encodeParamValue(plan.params[i], metadata[i] ?? NO_METADATA, i, registry, ctx);
  }

  const settled = signal
    ? await raceAgainstAbort(Promise.all(tasks), signal, 'encode')
    : await Promise.all(tasks);
  return Object.freeze(settled);
}
