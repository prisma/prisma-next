import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { codecDescriptorList, pgVectorDescriptor } from '../core/codecs';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Mirror `pgvectorPackMeta.types.codecTypes.codecInstances` here so that
  // runtime-plane assemblers driven by `extractCodecLookup` (which reads
  // `descriptor.types?.codecTypes?.codecInstances`) discover `pg/vector@1`.
  // Without this, the Postgres adapter's runtime-plane codec lookup misses
  // the vector codec and `$N::vector` would silently disappear once the
  // renderer switches to lookup-driven cast policy.
  //
  // The `codecInstances` channel materializes the descriptor's shared codec
  // (via `factory(undefined)`) for the lookup; pgvector's factory closes
  // over the schema-validated params, so the materialized instance carries
  // the encode/decode behavior the lookup needs. Retires alongside
  // `extractCodecLookup`'s reshape to consume descriptors directly
  // (TML-2357 follow-up).
  types: {
    codecTypes: {
      codecInstances: [
        pgVectorDescriptor.factory({ length: 0 })({
          name: `<lookup:${pgVectorDescriptor.codecId}>`,
        }),
      ],
    },
  },
  codecs: () => codecDescriptorList,
  queryOperations: () => pgvectorQueryOperations(),
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
