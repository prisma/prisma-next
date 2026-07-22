import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { timestampNowRuntimeGenerator } from '@prisma-next/family-sql/runtime';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeAdapterDescriptor } from '@prisma-next/sql-runtime';
import { postgresCodecRegistry } from '@prisma-next/target-postgres/codecs';
import { createPostgresAdapter, postgresRawCodecInferer } from '../core/adapter';
import { postgresAdapterDescriptorMeta, postgresQueryOperations } from '../core/descriptor-meta';
import type { PostgresContract, PostgresLoweredStatement } from '../core/types';

export interface SqlRuntimeAdapter
  extends RuntimeAdapterInstance<'sql', 'postgres'>,
    Adapter<AnyQueryAst, PostgresContract, PostgresLoweredStatement> {}

function createPostgresMutationDefaultGenerators() {
  return [
    ...builtinGeneratorIds.map((id) => ({
      id,
      generate: (params?: Record<string, unknown>) => {
        const spec: GeneratedValueSpec = params ? { id, params } : { id };
        return generateId(spec);
      },
      stability: 'field' as const,
    })),
    timestampNowRuntimeGenerator(),
  ];
}

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: () => Array.from(postgresCodecRegistry.values()),
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    rawCodecInferer: postgresRawCodecInferer,
    create(stack): SqlRuntimeAdapter {
      // The runtime `ExecutionStack` does not (yet) carry a pre-assembled `codecLookup` field the way the control `ControlStack` does, so we derive an equivalent lookup here from the stack's component metadata (target + adapter + extension packs) using the same assembly helper that `createControlStack` uses. This keeps the renderer fed with the same codec set on both planes — including extension-contributed codecs like
      // `pg/vector@1` from `@prisma-next/extension-pgvector`.
      const components = [stack.target, stack.adapter, ...stack.extensions];
      const codecLookup = extractCodecLookup(components);
      return createPostgresAdapter({ codecLookup });
    },
  };

export default postgresRuntimeAdapterDescriptor;
