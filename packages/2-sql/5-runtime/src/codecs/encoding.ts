import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import { runtimeError } from '@prisma-next/framework-components/runtime';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';

function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  registry: CodecRegistry,
): Codec | null {
  if (paramDescriptor.codecId) {
    const codec = registry.get(paramDescriptor.codecId);
    if (codec) {
      return codec;
    }
  }

  return null;
}

function paramLabel(paramDescriptor: ParamDescriptor, paramIndex: number): string {
  return paramDescriptor.name ?? `param[${paramIndex}]`;
}

function wrapEncodeFailure(
  error: unknown,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  codecId: string,
): never {
  const label = paramLabel(paramDescriptor, paramIndex);
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
 */
export async function encodeParam(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  registry: CodecRegistry,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(paramDescriptor, registry);
  if (!codec) {
    return value;
  }

  if (!codec.encode) {
    return value;
  }

  try {
    return await codec.encode(value);
  } catch (error) {
    wrapEncodeFailure(error, paramDescriptor, paramIndex, codec.id);
  }
}

/**
 * Encodes all parameters concurrently via `Promise.all`. Per parameter, sync-
 * and async-authored codecs share the same path: `codec.encode → await →
 * return`. Param-level failures are wrapped in `RUNTIME.ENCODE_FAILED`.
 */
export async function encodeParams(
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Promise<readonly unknown[]> {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const tasks: Promise<unknown>[] = new Array(plan.params.length);
  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      tasks[i] = encodeParam(paramValue, paramDescriptor, i, registry);
    } else {
      tasks[i] = Promise.resolve(paramValue);
    }
  }

  const encoded = await Promise.all(tasks);
  return Object.freeze(encoded);
}
