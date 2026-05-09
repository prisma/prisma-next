import type { RuntimeTargetInstance } from '@prisma-next/framework-components/execution';
import type { SqlRuntimeTargetDescriptor } from '@prisma-next/sql-runtime';
import { sqliteTargetDescriptorMeta } from './descriptor-meta';

export interface SqliteRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'sqlite'> {}

const sqliteRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'sqlite',
  SqliteRuntimeTargetInstance
> = {
  ...sqliteTargetDescriptorMeta,
  codecs: () => [],
  create(): SqliteRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'sqlite',
    };
  },
};

export default sqliteRuntimeTargetDescriptor;
