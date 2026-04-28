import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import {
  escapeLiteral,
  qualifyName,
  quoteIdentifier,
  SqlEscapeError,
} from '@prisma-next/target-postgres/sql-utils';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  createPostgresScalarTypeDescriptors,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  scalarTypeDescriptors: createPostgresScalarTypeDescriptors(),
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: createPostgresMutationDefaultGeneratorDescriptors(),
  },
  create(_stack): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;

export { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
