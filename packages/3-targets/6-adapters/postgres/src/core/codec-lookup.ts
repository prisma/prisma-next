import type { Codec, CodecLookup } from '@prisma-next/framework-components/codec';
import { codecDefinitions } from '@prisma-next/target-postgres/codecs';

/**
 * Build a {@link CodecLookup} populated with the Postgres-builtin codec
 * definitions only.
 *
 * This is the default lookup used by `createPostgresAdapter()` and
 * `new PostgresControlAdapter()` when called without a stack-derived lookup
 * (e.g. from tests, or one-off scripts that don't compose a full stack).
 *
 * Extension codecs (e.g. `pg/vector@1` from `@prisma-next/extension-pgvector`)
 * are intentionally NOT included here: a bare adapter cannot see extensions.
 * Stack-composed paths (`SqlControlAdapterDescriptor.create(stack)` /
 * `SqlRuntimeAdapterDescriptor.create(stack)`) supply the broader,
 * extension-inclusive lookup at construction time.
 */
export function createPostgresBuiltinCodecLookup(): CodecLookup {
  const byId = new Map<string, Codec>();
  for (const definition of Object.values(codecDefinitions)) {
    byId.set(definition.codec.id, definition.codec);
  }
  return { get: (id) => byId.get(id) };
}
