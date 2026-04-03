import { MongoParamRef } from './param-ref';
import type { MongoValue } from './values';

export function resolveValue(value: MongoValue): unknown {
  if (value instanceof MongoParamRef) {
    return value.value;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveValue(v));
  }
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = resolveValue(val);
  }
  return result;
}
