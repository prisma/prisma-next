import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { codecDescriptorClassList } from '../core/codecs-class';
import { pgvectorPackMeta, pgvectorQueryOperations } from '../core/descriptor-meta';

const pgvectorRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: pgvectorPackMeta.id,
  version: pgvectorPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  // Expose the unified descriptor list so `extractCodecLookup` reads
  // `targetTypes` / `meta` / `renderOutputType` directly off the
  // descriptors and materializes the representative `Codec` for the
  // SQL renderer's cast-policy lookup.
  types: {
    codecTypes: {
      codecDescriptors: codecDescriptorClassList,
    },
  },
  codecs: () => codecDescriptorClassList,
  queryOperations: () => pgvectorQueryOperations(),
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default pgvectorRuntimeDescriptor;
