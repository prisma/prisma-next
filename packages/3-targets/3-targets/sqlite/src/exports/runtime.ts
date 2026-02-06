import type {
  RuntimeTargetDescriptor,
  RuntimeTargetInstance,
} from '@prisma-next/core-execution-plane/types';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

/**
 * SQLite runtime target instance interface.
 */
export interface SqliteRuntimeTargetInstance extends RuntimeTargetInstance<'sql', 'sqlite'> {}

/**
 * SQLite target descriptor for runtime plane.
 */
const sqliteRuntimeTargetDescriptor: RuntimeTargetDescriptor<
  'sql',
  'sqlite',
  SqliteRuntimeTargetInstance
> = {
  ...sqliteTargetDescriptorMeta,
  create(): SqliteRuntimeTargetInstance {
    return {
      familyId: 'sql',
      targetId: 'sqlite',
    };
  },
};

export default sqliteRuntimeTargetDescriptor;
