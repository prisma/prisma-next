import type {
  ControlTargetDescriptor,
  ControlTargetInstance,
} from '@prisma-next/framework-components/control';
import { sqliteTargetDescriptorMeta } from '../core/descriptor-meta';

const sqliteControlTargetDescriptor: ControlTargetDescriptor<
  'sql',
  'sqlite',
  ControlTargetInstance<'sql', 'sqlite'>
> = {
  ...sqliteTargetDescriptorMeta,
  create(): ControlTargetInstance<'sql', 'sqlite'> {
    return { familyId: 'sql', targetId: 'sqlite' };
  },
};

export default sqliteControlTargetDescriptor;
