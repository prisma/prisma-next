import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/core-execution-plane/types';

/**
 * Postgres runtime target instance interface.
 */
export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

/**
 * Postgres target descriptor for runtime plane.
 */
const postgresRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'sql',
  'postgres',
  PostgresRuntimeTargetInstance
> = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;
