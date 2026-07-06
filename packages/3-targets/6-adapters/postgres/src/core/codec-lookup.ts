import type { CodecRegistry } from '@prisma-next/framework-components/codec';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import {
  attachNativeTypeFor,
  type SqlCodecLookup,
} from '@prisma-next/sql-contract/native-type-hook';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';

/**
 * Build a {@link CodecRegistry} (widened with the SQL-family {@link SqlCodecLookup} native-type
 * delegate) populated with the Postgres-builtin codec definitions only.
 *
 * This is the default registry used by `createPostgresAdapter()` and `new PostgresControlAdapter()` when called without a stack-derived registry (e.g. from tests, or one-off scripts that don't compose a full stack).
 *
 * Extension codecs (e.g. `pg/vector@1` from `@prisma-next/extension-pgvector`) are intentionally NOT included here: a bare adapter cannot see extensions. Stack-composed paths (`SqlControlAdapterDescriptor.create(stack)` / `SqlRuntimeAdapterDescriptor.create(stack)`) supply the broader, extension-inclusive registry at construction time.
 */
export function createPostgresBuiltinCodecLookup(): CodecRegistry & SqlCodecLookup {
  const descriptors = Array.from(postgresCodecRegistry.values());
  const registry = extractCodecLookup([
    {
      id: 'postgres-builtin-codecs',
      types: { codecTypes: { codecDescriptors: descriptors } },
    },
  ]);
  return { ...registry, ...attachNativeTypeFor(registry, descriptors) };
}
