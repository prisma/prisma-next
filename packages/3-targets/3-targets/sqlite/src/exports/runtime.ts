import type { RuntimeTargetInstance } from '@prisma-next/framework-components/execution';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeTargetDescriptor } from '@prisma-next/sql-runtime';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

export interface SqliteRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'sqlite'> {}

const sqliteRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'sqlite',
  SqliteRuntimeTargetInstance
> = {
  ...sqliteTargetDescriptorMeta,
  codecs: () => createCodecRegistry(),
  parameterizedCodecs: () => [],
  create(): SqliteRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'sqlite',
    };
  },
};

export default sqliteRuntimeTargetDescriptor;
