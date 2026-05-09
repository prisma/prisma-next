import {
  checkAborted,
  raceAgainstAbort,
  runtimeError,
} from '@prisma-next/framework-components/runtime';
import {
  type Codec,
  type ContractCodecRegistry,
  collectOrderedParamRefs,
  type ParamRefBindingRefs,
  type SqlCodecCallContext,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';

interface ParamMetadata {
  readonly codecId: string | undefined;
  readonly name: string | undefined;
  readonly refs: ParamRefBindingRefs | undefined;
}

const NO_METADATA: ParamMetadata = Object.freeze({
  codecId: undefined,
  name: undefined,
  refs: undefined,
});

/**
 * Resolve the codec for an outgoing param.
 *
 * Column-aware dispatch (AC-5): when `metadata.refs` is populated by a column-bound construction site, prefer `contractCodecs.forColumn(refs.table, refs.column)` — that returns the per-instance codec the contract walk materialized for the `(table, column)` pair, encoding the column's typeParams (e.g. `vector(1024)` vs. `vector(1536)`).
 *
 * On a column-lookup miss the resolver falls through to `forCodecId`. The wrong-instance risk F22 originally flagged is closed off structurally:
 *
 * 1. `buildContractCodecRegistry` pre-populates `byCodecId` with one canonical instance per non-parameterized descriptor; parameterized descriptors are intentionally absent from this pre-population. 2. `forCodecId` rejects ambiguous parameterized fallbacks (`ambiguousCodecIds`) — if the contract walk resolved more than one distinct instance under a single parameterized id, the call throws rather than binding to
 * whichever landed first. 3. For the non-ambiguous parameterized case (a single column with that id), `byCodecId` stores the column-correct per-instance codec, so the fall-through still resolves to the right instance.
 *
 * Refs-less fallback: ParamRefs constructed outside a column-bound site (literals, transient builder state) carry a non-parameterized `codecId` whose dispatch is ambiguity-free. The validator pass (`validateParamRefRefs`) already enforced refs on every parameterized ParamRef before encode runs.
 */
function resolveParamCodec(
  metadata: ParamMetadata,
  contractCodecs: ContractCodecRegistry | undefined,
): Codec | undefined {
  if (!metadata.codecId) return undefined;
  if (metadata.refs && contractCodecs) {
    const byColumn = contractCodecs.forColumn(metadata.refs.table, metadata.refs.column);
    if (byColumn) return byColumn;
  }
  return contractCodecs?.forCodecId(metadata.codecId);
}

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
 * Encodes a single parameter through its codec. Always awaits codec.encode so a Promise can never leak into the driver, even if a sync-authored codec is lifted to async by the codec factory. Failures are wrapped in `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original error attached on `cause`.
 *
 * `ctx` is forwarded verbatim to `codec.encode` so codec authors who opt into the `(value, ctx)` arity see the same `SqlCodecCallContext` the runtime built for the surrounding `runtime.execute()` call. The ctx is always present; its `signal` field may be `undefined`. Encode call sites do not populate `ctx.column` — encode-time column context is the middleware's domain.
 */
export async function encodeParam(
  value: unknown,
  paramRef: {
    readonly codecId?: string;
    readonly name?: string;
    readonly refs?: ParamRefBindingRefs;
  },
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<unknown> {
  return encodeParamValue(
    value,
    { codecId: paramRef.codecId, name: paramRef.name, refs: paramRef.refs },
    paramIndex,
    ctx,
    contractCodecs,
  );
}

async function encodeParamValue(
  value: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs: ContractCodecRegistry | undefined,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(metadata, contractCodecs);
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
 * Encodes all parameters concurrently via `Promise.all`. Per parameter, sync-and async-authored codecs share the same path: `codec.encode → await → return`. Param-level failures are wrapped in `RUNTIME.ENCODE_FAILED`.
 *
 * When `ctx.signal` is provided:
 *
 * - **Already-aborted at entry** short-circuits with `RUNTIME.ABORTED` (`{ phase: 'encode' }`) before any `codec.encode` call is made — codecs can pin this with a per-call counter that stays at zero.
 * - **Mid-flight abort** races the per-param `Promise.all` against `abortable(ctx.signal)`. The runtime returns `RUNTIME.ABORTED` promptly even if codec bodies ignore the signal; the in-flight bodies are abandoned and run to completion in the background (cooperative cancellation, see ADR 204).
 * - Existing `RUNTIME.ENCODE_FAILED` envelopes that surface from a codec body before the runtime observes the abort pass through unchanged (no double wrap).
 */
export async function encodeParams(
  plan: SqlExecutionPlan,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<readonly unknown[]> {
  checkAborted(ctx, 'encode');
  const signal = ctx.signal;

  if (plan.params.length === 0) {
    return plan.params;
  }

  const paramCount = plan.params.length;
  const metadata: ParamMetadata[] = new Array(paramCount).fill(NO_METADATA);

  if (plan.ast) {
    const refs = collectOrderedParamRefs(plan.ast);
    for (let i = 0; i < paramCount && i < refs.length; i++) {
      const ref = refs[i];
      if (ref) {
        metadata[i] = { codecId: ref.codecId, name: ref.name, refs: ref.refs };
      }
    }
  }

  const tasks: Promise<unknown>[] = new Array(paramCount);
  for (let i = 0; i < paramCount; i++) {
    tasks[i] = encodeParamValue(plan.params[i], metadata[i] ?? NO_METADATA, i, ctx, contractCodecs);
  }

  const settled = await raceAgainstAbort(Promise.all(tasks), signal, 'encode');
  return Object.freeze(settled);
}
