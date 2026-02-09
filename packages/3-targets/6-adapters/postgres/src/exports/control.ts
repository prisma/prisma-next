import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { PostgresControlAdapter } from '../core/control-adapter';
import { parsePostgresDefault } from '../core/default-normalizer';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  operationSignatures: () => [],
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;

export { escapeLiteral, parsePostgresDefault, qualifyName, quoteIdentifier, SqlEscapeError };
