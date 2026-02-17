import type { ExecutionPlan, ParamDescriptor } from '@prisma-next/contract/types';
import type { Codec, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { JsonSchemaValidatorRegistry } from '@prisma-next/sql-relational-core/query-lane-context';
import { validateJsonValue } from './json-schema-validation';

function resolveParamCodec(
  paramDescriptor: ParamDescriptor,
  plan: ExecutionPlan,
  registry: CodecRegistry,
): Codec | null {
  const paramName = paramDescriptor.name ?? `param_${paramDescriptor.index ?? 0}`;

  const planCodecId = plan.meta.annotations?.codecs?.[paramName] as string | undefined;
  if (planCodecId) {
    const codec = registry.get(planCodecId);
    if (codec) {
      return codec;
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
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  // Validate JSON value against schema before encoding
  if (jsonValidators && paramDescriptor.refs) {
    const { table, column } = paramDescriptor.refs;
    validateJsonValue(jsonValidators, table, column, value, 'encode', paramDescriptor.codecId);
  }

  const codec = resolveParamCodec(paramDescriptor, plan, registry);
  if (!codec) {
    return value;
  }

  if (codec.encode) {
    try {
      return codec.encode(value);
    } catch (error) {
      throw new Error(
        `Failed to encode parameter ${paramDescriptor.name ?? paramDescriptor.index}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return value;
}

export function encodeParams(
  plan: ExecutionPlan,
  registry: CodecRegistry,
  jsonValidators?: JsonSchemaValidatorRegistry,
): readonly unknown[] {
  if (plan.params.length === 0) {
    return plan.params;
  }

  const encoded: unknown[] = [];

  for (let i = 0; i < plan.params.length; i++) {
    const paramValue = plan.params[i];
    const paramDescriptor = plan.meta.paramDescriptors[i];

    if (paramDescriptor) {
      encoded.push(encodeParam(paramValue, paramDescriptor, plan, registry, jsonValidators));
    } else {
      encoded.push(paramValue);
    }
  }

  return Object.freeze(encoded);
}
