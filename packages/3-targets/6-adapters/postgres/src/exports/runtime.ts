import type { GeneratedValueSpec } from '@prisma-next/contract/types';
import { extractCodecLookup } from '@prisma-next/framework-components/control';
import type { RuntimeAdapterInstance } from '@prisma-next/framework-components/execution';
import { builtinGeneratorIds } from '@prisma-next/ids';
import { generateId } from '@prisma-next/ids/runtime';
import type { Adapter, AnyQueryAst, CodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeAdapterDescriptor,
} from '@prisma-next/sql-runtime';
import { codecDefinitions } from '@prisma-next/target-postgres/codecs';
import { createPostgresAdapter } from '../core/adapter';
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

/**
 * Phase C of codec-registry-unification: the postgres adapter retains
 * only static raw-JSON / raw-JSONB column descriptors. Schema-typed JSON
 * columns ship from per-library extension packages now —
 * `@prisma-next/extension-arktype-json` for arktype, future zod / valibot
 * extensions when each lands. The previously-shipped
 * `parameterizedCodecDescriptors` for `pg/json@1` / `pg/jsonb@1` retired
 * with the schema-typed surface; the unified descriptor map auto-lifts
 * the raw json/jsonb codecs from `codecs:` via the synthesis bridge for
 * codec-id-keyed metadata reads.
 */
const parameterizedCodecDescriptors: ReadonlyArray<RuntimeParameterizedCodecDescriptor> = [];

const postgresRuntimeAdapterDescriptor: SqlRuntimeAdapterDescriptor<'postgres', SqlRuntimeAdapter> =
  {
    ...postgresAdapterDescriptorMeta,
    codecs: createPostgresCodecRegistry,
    parameterizedCodecs: () => parameterizedCodecDescriptors,
    queryOperations: () => postgresQueryOperations(),
    mutationDefaultGenerators: createPostgresMutationDefaultGenerators,
    create(stack): SqlRuntimeAdapter {
      // The runtime `ExecutionStack` does not (yet) carry a pre-assembled
      // `codecLookup` field the way the control `ControlStack` does, so we
      // derive an equivalent lookup here from the stack's component metadata
      // (target + adapter + extension packs) using the same assembly helper
      // that `createControlStack` uses. This keeps the renderer fed with the
      // same codec set on both planes — including extension-contributed
      // codecs like `pg/vector@1` from `@prisma-next/extension-pgvector`.
      const codecLookup = extractCodecLookup([
        stack.target,
        stack.adapter,
        ...stack.extensionPacks,
      ]);
      return createPostgresAdapter({ codecLookup });
    },
  };

export default postgresRuntimeAdapterDescriptor;
