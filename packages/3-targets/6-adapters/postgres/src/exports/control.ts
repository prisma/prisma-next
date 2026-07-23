import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import {
  escapeLiteral,
  qualifyName,
  quoteIdentifier,
  SqlEscapeError,
} from '@prisma-next/target-postgres/sql-utils';
import { assemblePostgresCodecDescriptorRegistry } from '../core/codec-lookup';
import { PostgresControlAdapter } from '../core/control-adapter';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  postgresAuthoringTypes,
} from '../core/control-mutation-defaults';
import { postgresAdapterDescriptorMeta } from '../core/descriptor-meta';

const postgresAdapterDescriptor: SqlControlAdapterDescriptor<'postgres'> = {
  ...postgresAdapterDescriptorMeta,
  authoring: { type: postgresAuthoringTypes, valueObjectStorageType: 'Jsonb' },
  controlMutationDefaults: {
    defaultFunctionRegistry: createPostgresDefaultFunctionRegistry(),
    generatorDescriptors: createPostgresMutationDefaultGeneratorDescriptors(),
  },
  create(stack): SqlControlAdapter<'postgres'> {
    const components = [
      stack.target,
      ...(stack.adapter === undefined ? [] : [stack.adapter]),
      ...stack.extensions,
    ];
    const codecDescriptorRegistry = assemblePostgresCodecDescriptorRegistry(components);
    return new PostgresControlAdapter(stack.codecLookup, codecDescriptorRegistry);
  },
};

export default postgresAdapterDescriptor;

export { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
export { createPostgresBuiltinCodecLookup } from '../core/codec-lookup';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
