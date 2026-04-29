import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { allPostgresParameterizedCodecs } from '../codecs/postgres-codec-descriptors';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  createPostgresScalarTypeDescriptors,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';
import { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError } from '../core/sql-utils';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  types: {
    ...postgresAdapterDescriptorMeta.types,
    codecTypes: {
      ...postgresAdapterDescriptorMeta.types.codecTypes,
      // Register every parameterized Postgres codec descriptor with the
      // control stack so the emitter resolves `renderOutputType` off the
      // descriptor.
      //
      // The JSON / JSONB schema-typed columns are owned by per-library
      // extensions (e.g. `@prisma-next/extension-arktype-json`); the
      // postgres adapter ships only the non-parameterized `pg/json@1` /
      // `pg/jsonb@1` raw-JSONB codecs through `../core/codecs.ts`.
      parameterizedCodecs: [...allPostgresParameterizedCodecs],
    },
  },
  scalarTypeDescriptors: createPostgresScalarTypeDescriptors(),
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: createPostgresMutationDefaultGeneratorDescriptors(),
  },
  create(): SqlControlAdapter<'postgres'> {
    return new PostgresControlAdapter();
  },
};

export default postgresAdapterDescriptor;

export { normalizeSchemaNativeType } from '../core/control-adapter';
export { parsePostgresDefault } from '../core/default-normalizer';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
