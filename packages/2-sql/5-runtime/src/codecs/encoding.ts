import { runtimeError } from '@prisma-next/framework-components/runtime';
import type {
  AnyQueryAst,
  Codec,
  CodecRegistry,
  ParamRef,
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

function paramRefsByValueOrder(ast: AnyQueryAst): ReadonlyArray<ParamRef> {
  const seen = new Set<ParamRef>();
  const ordered: ParamRef[] = [];
  for (const ref of ast.collectParamRefs()) {
    if (!seen.has(ref)) {
      seen.add(ref);
      ordered.push(ref);
    }
  }
  return ordered;
}

/**
 * Encodes a single parameter through its codec. Always awaits codec.encode so
 * a Promise can never leak into the driver, even if a sync-authored codec is
 * lifted to async by the codec() factory. Failures are wrapped in
 * `RUNTIME.ENCODE_FAILED` with `{ label, codec, paramIndex }` and the original
 * error attached on `cause`.
 */
export async function encodeParam(
  value: unknown,
  paramRef: { readonly codecId?: string; readonly name?: string },
  paramIndex: number,
  registry: CodecRegistry,
): Promise<unknown> {
  return encodeParamValue(
    value,
    { codecId: paramRef.codecId, name: paramRef.name },
    paramIndex,
    registry,
  );
}

async function encodeParamValue(
  value: unknown,
  metadata: ParamMetadata,
  paramIndex: number,
  registry: CodecRegistry,
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
    return await codec.encode(value);
  } catch (error) {
    wrapEncodeFailure(error, metadata, paramIndex, codec.id);
  }
}

/**
 * Encodes all parameters concurrently via `Promise.all`. Per parameter, sync-
 * and async-authored codecs share the same path: `codec.encode → await →
 * return`. Param-level failures are wrapped in `RUNTIME.ENCODE_FAILED`.
 */
export async function encodeParams(
  plan: SqlExecutionPlan,
  registry: CodecRegistry,
): Promise<readonly unknown[]> {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const paramCount = plan.params.length;
  const metadata: ParamMetadata[] = new Array(paramCount).fill(NO_METADATA);

  if (plan.ast) {
    const refs = paramRefsByValueOrder(plan.ast);
    for (let i = 0; i < paramCount && i < refs.length; i++) {
      const ref = refs[i];
      if (ref) {
        metadata[i] = { codecId: ref.codecId, name: ref.name };
      }
    }
  }

  const tasks: Promise<unknown>[] = new Array(paramCount);
  for (let i = 0; i < paramCount; i++) {
    tasks[i] = encodeParamValue(plan.params[i], metadata[i] ?? NO_METADATA, i, registry);
  }

  const encoded = await Promise.all(tasks);
  return Object.freeze(encoded);
}
