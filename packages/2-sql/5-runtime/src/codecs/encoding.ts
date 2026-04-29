import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import type { Codec, ContractCodecRegistry } from '@prisma-next/sql-relational-core/ast';

function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  registry: ContractCodecRegistry,
): Codec | null {
  // Prefer the column-aware lookup when the SQL builder threaded the column
  // ref onto the param descriptor (rare in production today — most plans
  // only carry `codecId`). The column-aware lookup gives parameterized
  // codecs their per-instance instance; the codec-id fallback gives the
  // representative shared instance, which is encode-equivalent for every
  // parameterized codec shipped at Phase 3 (encode is per-instance-stateless
  // for pgvector and the JSON-with-schema factories — the schema-driven
  // validation runs in `decode`, not `encode`).
  if (paramDescriptor.refs) {
    const codec = registry.forColumn(paramDescriptor.refs.table, paramDescriptor.refs.column);
    if (codec) {
      return codec;
    }
  }

  if (paramDescriptor.codecId) {
    const codec = registry.forCodecId(paramDescriptor.codecId);
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
  registry: ContractCodecRegistry,
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

export function encodeParams(
  plan: ExecutionPlan,
  registry: ContractCodecRegistry,
): readonly unknown[] {
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
