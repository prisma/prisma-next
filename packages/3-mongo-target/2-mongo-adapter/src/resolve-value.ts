import { runtimeError } from '@prisma-next/framework-components/runtime';
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
 *
 * Codec encode failures are wrapped in a `RUNTIME.ENCODE_FAILED` envelope
 * (mirroring SQL's `wrapEncodeFailure` shape) with `{ label, codec }` details
 * and the original error attached on `cause`. An already-wrapped envelope is
 * re-thrown verbatim so nested resolvers don't double-wrap.
 */
export async function resolveValue(
  value: MongoValue,
  codecs?: MongoCodecRegistry,
): Promise<unknown> {
  if (value instanceof MongoParamRef) {
    if (value.codecId && codecs) {
      const codec = codecs.get(value.codecId);
      if (codec?.encode) {
        try {
          return await codec.encode(value.value);
        } catch (error) {
          wrapEncodeFailure(error, value, codec.id);
        }
      }
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

function paramRefLabel(ref: MongoParamRef, codecId: string): string {
  return ref.name ?? codecId;
}

function isAlreadyEncodeFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === 'RUNTIME.ENCODE_FAILED'
  );
}

function wrapEncodeFailure(error: unknown, ref: MongoParamRef, codecId: string): never {
  if (isAlreadyEncodeFailure(error)) {
    throw error;
  }
  const label = paramRefLabel(ref, codecId);
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.ENCODE_FAILED',
    `Failed to encode parameter ${label} with codec '${codecId}': ${message}`,
    { label, codec: codecId },
  );
  wrapped.cause = error;
  throw wrapped;
}
