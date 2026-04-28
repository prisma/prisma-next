import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { pgJsonbCodec, pgJsonCodec } from '../codecs/json-factory';
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
      // M4 cleanup F03: register the JSON / JSONB parameterized codec
      // descriptors with the control stack so the emitter resolves
      // `renderOutputType` off the descriptor (the spec'"'"'s long-term home).
      // The other parameterized Postgres codecs (char, numeric, timestamp,
      // etc.) are still served by their `controlPlaneHooks` / codec-object
      // `renderOutputType`; M4 closes the gap incrementally — descriptors are
      // shipped in `core/parameterized-codec-factories.ts` already; wiring the
      // remaining descriptors into this list is mechanical and tracked under
      // M5 close-out (no behavior change required for AC-4 since codec-object
      // `renderOutputType` keeps the emit path warm via the F03 fallback).
      parameterizedCodecs: [pgJsonCodec, pgJsonbCodec],
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
