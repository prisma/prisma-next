import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';

function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Codec | null {
  if (paramDescriptor.name) {
    const planCodecId = plan.meta.annotations?.codecs?.[paramDescriptor.name] as string | undefined;
    if (planCodecId) {
      const codec = registry.get(planCodecId);
      if (codec) {
        return codec;
      }
    }
  }

  if (paramDescriptor.codecId) {
    const codec = registry.get(paramDescriptor.codecId);
    if (codec) {
      return codec;
    }
  }

  return null;
}

export function encodeParam(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  paramIndex: number,
  plan: ExecutionPlan,
  registry: CodecRegistry,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  const codec = resolveParamCodec(paramDescriptor, plan, registry);
  if (!codec) {
    return value;
  }

  if (codec.encode) {
    try {
      return codec.encode(value);
    } catch (error) {
      const label = paramDescriptor.name ?? `param[${paramIndex}]`;
      throw new Error(
        `Failed to encode parameter ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return value;
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
      encoded.push(encodeParam(paramValue, paramDescriptor, i, plan, registry));
    } else {
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}
