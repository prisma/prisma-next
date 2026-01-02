import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { PostgresControlAdapter } from '../core/control-adapter';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

/**
 * Postgres adapter descriptor for CLI config.
 */
const postgresAdapterDescriptor: ControlAdapterDescriptor<
  'sql',
  'postgres',
  SqlControlAdapter<'postgres'>
> = {
  ...postgresAdapterDescriptorMeta,
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;
