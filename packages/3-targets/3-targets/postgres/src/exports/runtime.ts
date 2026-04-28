import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/framework-components/execution';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { postgresTargetDescriptorMeta } from '../core/descriptor-meta';

export interface PostgresRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'postgres'> {}

/**
 * Target-postgres deliberately does NOT import `SqlRuntimeTargetDescriptor`
 * from `@prisma-next/sql-runtime`. The target package is a control-plane
 * residence and must not pull the SQL execution-plane package into its
 * dependency closure. The runtime descriptor here is shaped to satisfy the
 * framework's `RuntimeTargetDescriptor` plus the structural
 * `SqlStaticContributions` (`codecs`, `parameterizedCodecs`) that
 * `@prisma-next/sql-runtime` consumers narrow to at composition time.
 */
const postgresRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'sql',
  'postgres',
  PostgresRuntimeTargetInstance
> & {
  readonly codecs: () => ReturnType<typeof createCodecRegistry>;
  readonly parameterizedCodecs: () => readonly never[];
} = {
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
