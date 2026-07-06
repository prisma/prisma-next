import type { SqlControlAdapterDescriptor } from '@prisma-next/family-sql/control';
import type { SqlControlAdapter } from '@prisma-next/family-sql/control-adapter';
import { attachNativeTypeFor } from '@prisma-next/sql-contract/native-type-hook';
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
  create(stack): SqlControlAdapter<'postgres'> {
    const components = [
      stack.target,
      ...(stack.adapter ? [stack.adapter] : []),
      ...stack.extensionPacks,
    ];
    const codecDescriptors = components.flatMap(
      (component) => component.types?.codecTypes?.codecDescriptors ?? [],
    );
    const codecLookup = {
      ...stack.codecLookup,
      ...attachNativeTypeFor(stack.codecLookup, codecDescriptors),
    };
    return new PostgresControlAdapter(codecLookup);
  },
};

export default postgresAdapterDescriptor;

export { parsePostgresDefault } from '@prisma-next/target-postgres/default-normalizer';
export { normalizeSchemaNativeType } from '@prisma-next/target-postgres/native-type-normalizer';
export { createPostgresBuiltinCodecLookup } from '../core/codec-lookup';
export { PostgresControlAdapter } from '../core/control-adapter';
export { escapeLiteral, qualifyName, quoteIdentifier, SqlEscapeError };
