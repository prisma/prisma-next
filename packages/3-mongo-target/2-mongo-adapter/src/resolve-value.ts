import type { MongoCodecRegistry } from '@prisma-next/mongo-codec';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';

/**
 * Resolves a `MongoValue` (which may contain `MongoParamRef` leaves) into the
 * driver-ready wire shape. When a leaf has a `codecId` and the registry has a
 * codec for it, the codec's async `encode` is awaited so codecs may perform
 * asynchronous work (e.g. lookups, key derivations).
 *
 * Object/array nodes dispatch their child resolutions concurrently via
 * `Promise.all` so independent leaves encode in parallel.
 */
export async function resolveValue(
  value: MongoValue,
  codecs?: MongoCodecRegistry,
): Promise<unknown> {
  if (value instanceof MongoParamRef) {
    if (value.codecId && codecs) {
      const codec = codecs.get(value.codecId);
      if (codec?.encode) return codec.encode(value.value);
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
    return Promise.all(value.map((v) => resolveValue(v, codecs)));
  }
  const entries = Object.entries(value);
  const resolved = await Promise.all(entries.map(([, val]) => resolveValue(val, codecs)));
  const result: Record<string, unknown> = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry) {
      result[entry[0]] = resolved[i];
    }
  }
  return result;
}
