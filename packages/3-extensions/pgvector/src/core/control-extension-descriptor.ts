/**
 * Control-plane extension descriptor for pgvector.
 *
 * Composes pack metadata, query operations, control-plane hooks, database
 * dependencies, and the parameterized codec descriptor into the migration-
 * plane shape the framework's control stack consumes.
 */

import type { SqlControlExtensionDescriptor } from '@prisma-next/family-sql/control';
import { pgvectorDatabaseDependencies, vectorControlPlaneHooks } from './control-hooks';
import { pgvectorPackMeta } from './pack-meta';
import { pgvectorQueryOperations } from './query-operations';
import { pgVectorCodec, VECTOR_CODEC_ID } from './vector-codec';

export const pgvectorExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...pgvectorPackMeta,
  types: {
    ...pgvectorPackMeta.types,
    codecTypes: {
      ...pgvectorPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [VECTOR_CODEC_ID]: vectorControlPlaneHooks,
      },
      // Register the parameterized codec descriptor with the control stack so
      // the emitter can read `renderOutputType` off the descriptor (the long-
      // term home for parameterized rendering; see ADR 205).
      parameterizedCodecs: [pgVectorCodec],
    },
  },
  queryOperations: () => pgvectorQueryOperations(),
  databaseDependencies: pgvectorDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};
