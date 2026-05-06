import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeExtensionDescriptor } from '@prisma-next/sql-runtime';
import { paradedbPackMeta, paradedbQueryOperations } from '../core/descriptor-meta';

const paradedbRuntimeDescriptor: SqlRuntimeExtensionDescriptor<'postgres'> = {
  kind: 'extension' as const,
  id: paradedbPackMeta.id,
  version: paradedbPackMeta.version,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  codecs: () => createCodecRegistry(),
  queryOperations: () => paradedbQueryOperations(),
  parameterizedCodecs: () => [],
  create() {
    return {
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
    };
  },
};

export default paradedbRuntimeDescriptor;
