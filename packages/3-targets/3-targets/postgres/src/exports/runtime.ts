import { assertManifestMatchesDescriptor } from '@prisma-next/contract/descriptor-manifest';
import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/core-execution-plane/types';
import { manifest } from '../core/manifest';

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
  manifest,
  version: manifest.version,
  targets: manifest.targets,
  capabilities: manifest.capabilities,
  types: manifest.types,
  operations: manifest.operations,
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;

assertManifestMatchesDescriptor(manifest, postgresRuntimeTargetDescriptor);
