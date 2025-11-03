import type { Codec, CodecRegistry } from '@prisma-next/sql-target';
import type { Plan, ParamDescriptor } from '@prisma-next/sql/types';

/**
 * Resolves a codec for parameter encoding using precedence rules.
 *
 * Precedence:
 * 1. Plan hint: `annotations.codecs[paramName]` → select by id
 * 2. Runtime overrides: `overrides['table.column']` or `overrides[paramName]` → select by id
 * 3. Registry by scalar: `byScalar.get(type)` → first candidate
 * 4. Fallback: null (no encoding)
 */
function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  plan: Plan,
  registry: CodecRegistry,
  overrides?: Record<string, string>,
): Codec | null {
  const paramName = paramDescriptor.name ?? `param_${paramDescriptor.index ?? 0}`;

  // 1. Plan hint: annotations.codecs[paramName]
  const planCodecId = plan.meta.annotations?.codecs?.[paramName] as string | undefined;
  if (planCodecId) {
    const codec = registry.byId.get(planCodecId);
    if (codec) {
      return codec;
    }
  }

  // 2. Runtime overrides: check table.column first, then paramName
  if (overrides) {
    if (paramDescriptor.refs) {
      const tableColumnKey = `${paramDescriptor.refs.table}.${paramDescriptor.refs.column}`;
      const overrideId = overrides[tableColumnKey];
      if (overrideId) {
        const codec = registry.byId.get(overrideId);
        if (codec) {
          return codec;
        }
      }
    }
    const overrideId = overrides[paramName];
    if (overrideId) {
      const codec = registry.byId.get(overrideId);
      if (codec) {
        return codec;
      }
    }
  }

  // 3. Registry by scalar type
  if (paramDescriptor.type) {
    const candidates = registry.byScalar.get(paramDescriptor.type);
    if (candidates && candidates.length > 0) {
      return candidates[0] ?? null;
    }
  }

  // 4. Fallback: no codec
  return null;
}

/**
 * Encodes a parameter value using the resolved codec.
 *
 * Special handling:
 * - Null/undefined: pass through as null without encoding
 * - JS Date + type timestamp|timestamptz: apply core/iso-datetime@1 if no codec resolved
 * - If codec has encode, apply it; else pass through
 */
export function encodeParam(
  value: unknown,
  paramDescriptor: ParamDescriptor,
  plan: Plan,
  registry: CodecRegistry,
  overrides?: Record<string, string>,
): unknown {
  // Null short-circuit: pass through without encoding
  if (value === null || value === undefined) {
    return null;
  }

  // Special case: JS Date + type timestamp|timestamptz
  if (value instanceof Date && paramDescriptor.type) {
    const isTimestampType = paramDescriptor.type === 'timestamp' || paramDescriptor.type === 'timestamptz';
    if (isTimestampType) {
      // Try to resolve codec, or use iso-datetime codec directly
      const codec = resolveParamCodec(paramDescriptor, plan, registry, overrides);
      if (codec && codec.encode) {
        return codec.encode(value);
      }
      // Fallback: use iso-datetime codec directly
      const isoDatetimeCodec = registry.byId.get('core/iso-datetime@1');
      if (isoDatetimeCodec && isoDatetimeCodec.encode) {
        return isoDatetimeCodec.encode(value);
      }
    }
  }

  // Resolve codec
  const codec = resolveParamCodec(paramDescriptor, plan, registry, overrides);
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
export function encodeParams(
  plan: Plan,
  registry: CodecRegistry,
  overrides?: Record<string, string>,
): readonly unknown[] {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const encoded: unknown[] = [];

  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      encoded.push(encodeParam(paramValue, paramDescriptor, plan, registry, overrides));
    } else {
      // No descriptor: pass through
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}

