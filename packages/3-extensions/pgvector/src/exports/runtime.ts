import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { codecDefinitions } from '../core/codecs';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';
import { pgVectorCodec } from './codecs';

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
  codecs: createPgvectorCodecRegistry,
  queryOperations: () => pgvectorQueryOperations(),
  parameterizedCodecs: () => [pgVectorCodec],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
