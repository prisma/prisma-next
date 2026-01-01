import { assertManifestMatchesDescriptor } from '@prisma-next/contract/descriptor-manifest';
import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { PostgresControlAdapter } from '../core/control-adapter';
import { manifest } from '../core/manifest';

/**
 * Postgres adapter descriptor for CLI config.
 */
const postgresAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'postgres',
  SqlControlAdapter<'postgres'>
> = {
  kind: 'adapter',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  manifest,
  version: manifest.version,
  targets: manifest.targets,
  capabilities: manifest.capabilities,
  types: manifest.types,
  operations: manifest.operations,
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;

assertManifestMatchesDescriptor(manifest, postgresAdapterDescriptor);
