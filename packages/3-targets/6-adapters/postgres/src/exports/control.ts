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
  postgresScalarAuthoringTypes,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: { type: postgresScalarAuthoringTypes },
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: createPostgresMutationDefaultGeneratorDescriptors(),
  },
  create(stack): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter(stack.codecLookup);
  },
};

export default postgresAdapterDescriptor;

export { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
export { createPostgresBuiltinCodecLookup } from '../core/codec-lookup';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
