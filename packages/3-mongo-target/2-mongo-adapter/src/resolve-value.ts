import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';

export function resolveValue(value: MongoValue, codecs?: MongoCodecRegistry): unknown {
  if (value instanceof MongoParamRef) {
    if (value.codecId && codecs) {
      const codec = codecs.get(value.codecId);
      if (codec) return codec.encode(value.value);
    }
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v, codecs));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = resolveValue(val, codecs);
  }
  return result;
}
