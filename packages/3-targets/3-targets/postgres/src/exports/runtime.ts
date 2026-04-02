import type { RuntimeTargetInstance } from '@prisma-next/framework-components/execution';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import type { SqlRuntimeTargetDescriptor } from '@prisma-next/sql-runtime';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

const postgresRuntimeTargetDescriptor: SqlRuntimeTargetDescriptor<
  'postgres',
  PostgresRuntimeTargetInstance
> = {
  ...postgresTargetDescriptorMeta,
  codecs: () => createCodecRegistry(),
  parameterizedCodecs: () => [],
  create(): PostgresRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export default postgresRuntimeTargetDescriptor;
