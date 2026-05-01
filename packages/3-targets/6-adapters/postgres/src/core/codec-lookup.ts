import type { CodecLookup } from '@prisma-next/framework-components/codec';
import type { Codec as SqlCodec } from '@prisma-next/sql-relational-core/ast';
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
  const byId = new Map<string, SqlCodec>();
  for (const definition of Object.values(codecDefinitions)) {
    byId.set(definition.codec.id, definition.codec);
  }
  return {
    get: (id) => byId.get(id),
    targetTypesFor: (id) => byId.get(id)?.targetTypes,
    metaFor: (id) => byId.get(id)?.meta,
    renderOutputTypeFor: (id, params) => byId.get(id)?.renderOutputType?.(params),
  };
}
