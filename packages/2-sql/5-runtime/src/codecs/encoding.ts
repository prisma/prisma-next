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

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

function paramLabel(paramDescriptor: ParamDescriptor, paramIndex: number): string {
  return paramDescriptor.name ?? `param[${paramIndex}]`;
}

function encodeFailure(
  codec: Codec,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  error: unknown,
): Error {
  const label = paramLabel(paramDescriptor, paramIndex);
  return runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codec.id}': ${error instanceof Error ? error.message : String(error)}`,
    {
      label,
      codec: codec.id,
    },
  );
}

function unexpectedAsyncEncodeFailure(
  codec: Codec,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
): Error {
  const label = paramLabel(paramDescriptor, paramIndex);
  return runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Codec '${codec.id}' returned a promise while encoding parameter ${label} on the sync path. Mark the codec runtime encode hook as async.`,
    {
      label,
      codec: codec.id,
    },
  );
}

export function encodeParam(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  registry: CodecRegistry,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(paramDescriptor, registry);
  if (!codec) {
    return value;
  }

  if (codec.encode) {
    try {
      const encoded = codec.encode(value);
      if (isPromiseLike(encoded)) {
        throw unexpectedAsyncEncodeFailure(codec, paramDescriptor, paramIndex);
      }
      return encoded;
    } catch (error) {
      throw error instanceof Error &&
        'code' in error &&
        (error as Error & { code: string }).code === 'RUNTIME.ENCODE_FAILED'
        ? error
        : encodeFailure(codec, paramDescriptor, paramIndex, error);
    }
  }

  return value;
}

export async function encodeParamAsync(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  registry: CodecRegistry,
): Promise<unknown> {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(paramDescriptor, registry);
  if (!codec || !codec.encode) {
    return value;
  }

  try {
    const encoded = codec.encode(value);
    return isPromiseLike(encoded) ? await encoded : encoded;
  } catch (error) {
    throw encodeFailure(codec, paramDescriptor, paramIndex, error);
  }
}

export function hasAsyncParamEncoding(plan: ExecutionPlan, registry: CodecRegistry): boolean {
  for (let i = 0; i < plan.params.length; i++) {
    const paramDescriptor = plan.meta.paramDescriptors[i];
    if (!paramDescriptor) {
      continue;
    }

    const codec = resolveParamCodec(paramDescriptor, registry);
    if (codec?.runtime?.encode === 'async') {
      return true;
    }
  }

  return false;
}

export function encodeParams(plan: ExecutionPlan, registry: CodecRegistry): readonly unknown[] {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const encoded: unknown[] = [];

  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      encoded.push(encodeParam(paramValue, paramDescriptor, i, registry));
    } else {
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}

export async function encodeParamsAsync(
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Promise<readonly unknown[]> {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const encoded: unknown[] = [];

  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      encoded.push(await encodeParamAsync(paramValue, paramDescriptor, i, registry));
    } else {
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}
