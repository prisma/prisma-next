import type { RuntimeTargetInstance } from '@prisma-next/core-execution-plane/types';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeTargetDescriptor } from '@prisma-next/sql-runtime';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

/**
 * Postgres runtime target instance interface.
 */
export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

/**
 * Postgres target descriptor for runtime plane.
 * Implements SqlRuntimeTargetDescriptor with required static contributions.
 *
 * The target provides empty contributions - codecs and operations are
 * contributed by the adapter and extensions.
 */
const postgresRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'postgres',
  PostgresRuntimeTargetInstance
> = {
  ...postgresTargetDescriptorMeta,
  codecs: () => createCodecRegistry(),
  operationSignatures: () => [],
  parameterizedCodecs: () => [],
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;
