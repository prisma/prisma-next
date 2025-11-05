import type { Codec, CodecRegistry } from '@prisma-next/sql-target';
import type { Plan, ParamDescriptor } from '@prisma-next/sql-query/types';

/**
 * Resolves a codec for parameter encoding using precedence rules.
 *
 * Precedence:
 * 1. Plan hint: `annotations.codecs[paramName]` → select by id
 * 2. Param descriptor type: `paramDescriptor.type` → select by typeId
 * 3. Fallback: null (no encoding)
 */
function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  plan: Plan,
  registry: CodecRegistry,
): Codec | null {
  const paramName = paramDescriptor.name ?? `param_${paramDescriptor.index ?? 0}`;

  // 1. Plan hint: annotations.codecs[paramName]
  const planCodecId = plan.meta.annotations?.codecs?.[paramName] as string | undefined;
  if (planCodecId) {
    const codec = registry.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  // 2. Param descriptor type: paramDescriptor.type → registry.get(typeId)
  if (paramDescriptor.type) {
    const codec = registry.get(paramDescriptor.type);
    if (codec) {
      return codec;
    }
  }

  // 3. Fallback: no codec
  return null;
}

/**
 * Encodes a parameter value using the resolved codec.
 *
 * Special handling:
 * - Null/undefined: pass through as null without encoding
 * - If codec has encode, apply it; else pass through
 */
export function encodeParam(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  plan: Plan,
  registry: CodecRegistry,
): unknown {
  // Null short-circuit: pass through without encoding
  if (value === null || value === undefined) {
    return null;
  }

  // Resolve codec
  const codec = resolveParamCodec(paramDescriptor, plan, registry);
  if (!codec) {
    // No codec: pass through
    return value;
  }

  // Apply encode if available
  if (codec.encode) {
    try {
      return codec.encode(value);
    } catch (error) {
      throw new Error(
        `Failed to encode parameter ${paramDescriptor.name ?? paramDescriptor.index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // No encode function: pass through
  return value;
}

/**
 * Encodes all parameters in a plan using codec registry.
 */
export function encodeParams(plan: Plan, registry: CodecRegistry): readonly unknown[] {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const encoded: unknown[] = [];

  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      encoded.push(encodeParam(paramValue, paramDescriptor, plan, registry));
    } else {
      // No descriptor: pass through
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}
