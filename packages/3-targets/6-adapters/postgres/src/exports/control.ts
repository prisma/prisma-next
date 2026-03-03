import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { createBuiltinControlMutationDefaults } from '@prisma-next/sql-contract-psl';
import { PostgresControlAdapter } from '../core/control-adapter';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  operationSignatures: () => [],
  controlMutationDefaults: () => createBuiltinControlMutationDefaults(),
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;

export { normalizeSchemaNativeType } from '../core/control-adapter';
export { parsePostgresDefault } from '../core/default-normalizer';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
