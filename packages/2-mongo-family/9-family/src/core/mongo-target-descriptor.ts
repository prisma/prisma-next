import type { ControlTargetDescriptor } from '@prisma-next/framework-components/control';
import mongoTargetDescriptorMeta from '@prisma-next/target-mongo/pack';

export const mongoTargetDescriptor: ControlTargetDescriptor<'mongo', 'mongo'> = {
  ...mongoTargetDescriptorMeta,
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
