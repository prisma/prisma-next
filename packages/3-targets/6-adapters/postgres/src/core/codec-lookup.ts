import type { CodecRegistry } from '@prisma-next/framework-components/codec';
import type { ComponentMetadata } from '@prisma-next/framework-components/components';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import {
  buildPostgresCodecDescriptorRegistry,
  type PostgresCodecDescriptorRegistry,
} from '@prisma-next/target-postgres/codec-descriptor';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';

export function assemblePostgresCodecDescriptorRegistry(
  components: ReadonlyArray<Pick<ComponentMetadata, 'types'>>,
): PostgresCodecDescriptorRegistry {
  const descriptors = components.flatMap(
    (component) => component.types?.codecTypes?.codecDescriptors ?? [],
  );
  return buildPostgresCodecDescriptorRegistry(descriptors);
}

/**
 * Build a {@link CodecRegistry} populated with the Postgres-builtin codec definitions only.
 *
 * This is the default registry used by `createPostgresAdapter()` and `new PostgresControlAdapter()` when called without a stack-derived registry (e.g. from tests, or one-off scripts that don't compose a full stack).
 *
 * Extension codecs (e.g. `pg/vector@1` from `@prisma-next/extension-pgvector`) are intentionally NOT included here: a bare adapter cannot see extensions. Stack-composed paths (`SqlControlAdapterDescriptor.create(stack)` / `SqlRuntimeAdapterDescriptor.create(stack)`) supply the broader, extension-inclusive registry at construction time.
 */
export function createPostgresBuiltinCodecLookup(): CodecRegistry {
  const descriptors = Array.from(postgresCodecRegistry.values());
  return extractCodecLookup([
    {
      id: 'postgres-builtin-codecs',
      types: { codecTypes: { codecDescriptors: descriptors } },
    },
  ]);
}
