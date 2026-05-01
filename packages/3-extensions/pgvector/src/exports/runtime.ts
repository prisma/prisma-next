import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type {
  RuntimeParameterizedCodecDescriptor,
  SqlRuntimeExtensionDescriptor,
} from '@prisma-next/sql-runtime';
import { codecDefinitions, pgVectorDescriptor } from '../core/codecs';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

// pgvector ships its codec as a native `CodecDescriptor` (TML-2357 T2.5).
// The legacy `parameterizedCodecs:` slot still echoes it through the
// `RuntimeParameterizedCodecDescriptor<P>` alias for the SQL contributor
// protocol; the M2 cleanup commit collapses both slots into the unified
// `codecs:` slot.
const parameterizedCodecDescriptors = [pgVectorDescriptor] as const satisfies ReadonlyArray<
  RuntimeParameterizedCodecDescriptor<{ readonly length: number }>
>;

function createPgvectorCodecRegistry() {
  const registry = createCodecRegistry();
  for (const def of Object.values(codecDefinitions)) {
    registry.register(def.codec);
  }
  return registry;
}

const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Mirror `pgvectorPackMeta.types.codecTypes.codecInstances` here so that
  // runtime-plane assemblers driven by `extractCodecLookup` (which reads
  // `descriptor.types?.codecTypes?.codecInstances`) discover `pg/vector@1`.
  // Without this, the Postgres adapter's runtime-plane codec lookup misses
  // the vector codec and `$N::vector` would silently disappear once the
  // renderer switches to lookup-driven cast policy.
  types: {
    codecTypes: {
      codecInstances: Object.values(codecDefinitions).map((def) => def.codec),
    },
  },
  codecs: createPgvectorCodecRegistry,
  queryOperations: () => pgvectorQueryOperations(),
  parameterizedCodecs: () => parameterizedCodecDescriptors,
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
