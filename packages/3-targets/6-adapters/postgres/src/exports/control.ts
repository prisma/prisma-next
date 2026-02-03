import type { ControlAdapterDescriptor } from '@prisma-next/core-control-plane/types';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { PostgresControlAdapter } from '../core/control-adapter';
import { parsePostgresDefault } from '../core/default-normalizer';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { expandParameterizedNativeType } from '../core/parameterized-types';
import { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

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

export {
  escapeLiteral,
  expandParameterizedNativeType,
  parsePostgresDefault,
  qualifyName,
  quoteIdentifier,
  SqlEscapeError,
};
