import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import {
  allPostgresParameterizedCodecs,
  pgJsonbLegacyCodec,
  pgJsonLegacyCodec,
} from '../codecs/postgres-codec-descriptors';
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
      // M4 cleanups F03 + F01: register every parameterized Postgres codec
      // descriptor with the control stack so the emitter resolves
      // `renderOutputType` off the descriptor exclusively. Once the
      // codec-object `renderOutputType` field is removed (F01), this is the
      // sole emit-path source of truth.
      //
      // Note: the JSON / JSONB descriptors registered here are the *legacy*
      // serialized-typeParams renderers (`{ schemaJson, type? }`), not the M3
      // `pgJsonCodec` / `pgJsonbCodec` (which are runtime-load descriptors
      // keyed off live Standard Schema instances). The emit path sees the
      // serialized form; the M3 descriptors land in the runtime descriptor
      // for contract-load-time materialization.
      parameterizedCodecs: [
        ...allPostgresParameterizedCodecs,
        pgJsonLegacyCodec,
        pgJsonbLegacyCodec,
      ],
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
