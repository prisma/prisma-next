import {
  checkAborted,
  isRuntimeError,
  raceAgainstAbort,
  runtimeError,
} from '@prisma-next/framework-components/runtime';
import {
  type Codec,
  type CodecRef,
  type ContractCodecRegistry,
  collectOrderedParamRefs,
  type SqlCodecCallContext,
} from '@prisma-next/sql-relational-core/ast';
import type { SqlExecutionPlan } from '@prisma-next/sql-relational-core/plan';
import { makeAliasResolver } from './alias-resolver';

interface ParamMetadata {
  readonly codec: CodecRef | undefined;
  readonly name: string | undefined;
}

const NO_METADATA: ParamMetadata = Object.freeze({
  codec: undefined,
  name: undefined,
});

/**
 * Resolve the codec for an outgoing param.
 *
 * AST-bound dispatch: when `metadata.codec` is populated by a column-bound construction site, resolve via `contractCodecs.forCodecRef(codec)` — that returns the per-instance codec materialized for the `(codecId, typeParams)` pair, encoding any per-instance state (e.g. `vector(1024)` vs. `vector(1536)`). Content-keyed memoisation inside the registry collapses repeated lookups for the same logical column.
 *
 * The `forCodecRef` path is the single dispatch shape for all codec-bearing AST nodes and closes off the wrong-instance risk structurally: each `CodecRef` carries both the `codecId` and the `typeParams` the column declared, so parameterized codec ids always resolve to the right per-instance codec.
 *
 * // M3c: dead after AST shape change — delete: the forColumn + forCodecId legacy paths below are unreachable because every column-bound ParamRef now carries `codec`. They stay until M3c collapses the byColumn parallel surface.
 */
function resolveParamCodec(
  metadata: ParamMetadata,
  contractCodecs: ContractCodecRegistry | undefined,
  _aliasResolver: (alias: string) => string,
): Codec | undefined {
  if (metadata.codec && contractCodecs) {
    return contractCodecs.forCodecRef(metadata.codec);
  }
  // M3c: dead after AST shape change — delete: codec-id-only fallback
  const codecId = metadata.codec?.codecId;
  if (!codecId) return undefined;
  return contractCodecs?.forCodecId(codecId);
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
    readonly codec?: CodecRef;
    readonly name?: string;
  },
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs?: ContractCodecRegistry,
): Promise<unknown> {
  return encodeParamValue(
    value,
    { codec: paramRef.codec, name: paramRef.name },
    paramIndex,
    ctx,
    contractCodecs,
    (alias) => alias,
  );
}

async function encodeParamValue(
  value: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  ctx: SqlCodecCallContext,
  contractCodecs: ContractCodecRegistry | undefined,
  aliasResolver: (alias: string) => string,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(metadata, contractCodecs, aliasResolver);
  if (!codec) {
    return value;
  }

  try {
    return await codec.encode(value, ctx);
  } catch (error) {
    // Any `runtimeError`-built envelope is stable by construction — let
    // it pass through unchanged. This covers codec-authored
    // `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` (per-library JSON-with-
    // schema codecs validate inside `encode` per ADR 208 § Case J),
    // codec-authored `RUNTIME.ENCODE_FAILED` (no double wrap), and any
    // future stable code thrown from a codec body. Symmetric with the
    // decode-side guard.
    if (isRuntimeError(error)) throw error;
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
        metadata[i] = { codec: ref.codec, name: ref.name };
      }
    }
  }

  const aliasResolver = makeAliasResolver(plan.ast);

  const tasks: Promise<unknown>[] = new Array(paramCount);
  for (let i = 0; i < paramCount; i++) {
    tasks[i] = encodeParamValue(
      plan.params[i],
      metadata[i] ?? NO_METADATA,
      i,
      ctx,
      contractCodecs,
      aliasResolver,
    );
  }

  const settled = await raceAgainstAbort(Promise.all(tasks), signal, 'encode');
  return Object.freeze(settled);
}
