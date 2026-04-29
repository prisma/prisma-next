import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { createPostgresAdapter } from '../core/adapter';
import { codecDefinitions } from '../core/codecs';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresCodecRegistry(): CodecRegistry {
  const registry = createCodecRegistry();
  for (const definition of Object.values(codecDefinitions)) {
    registry.register(definition.codec);
  }
  return registry;
}

function createPostgresMutationDefaultGenerators() {
  return builtinGeneratorIds.map((id) => ({
    id,
    generate: (params?: Record<string, unknown>) => {
      const spec: GeneratedValueSpec = params ? { id, params } : { id };
      return generateId(spec);
    },
  }));
}

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    // Schema-typed JSON columns are owned by per-library extensions
    // (e.g. `@prisma-next/extension-arktype-json`). The postgres adapter
    // ships no parameterized codecs of its own — every parameterized
    // codec id (char, varchar, numeric, …) is registered for the emit
    // path through `./control.ts` and materialized at runtime through
    // the descriptor's curried factory in `core/parameterized-codec-factories.ts`.
    parameterizedCodecs: () => [],
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(): SqlRuntimeAdapter {
      return createPostgresAdapter();
    },
  };

export default postgresRuntimeAdapterDescriptor;
