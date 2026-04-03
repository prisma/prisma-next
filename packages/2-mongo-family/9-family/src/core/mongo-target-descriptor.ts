import type { ControlTargetDescriptor } from '@prisma-next/framework-components/control';
import mongoTargetDescriptorMeta from '@prisma-next/target-mongo/pack';

export const mongoTargetDescriptor: ControlTargetDescriptor<'mongo', 'mongo'> = {
  ...mongoTargetDescriptorMeta,
  types: {
    codecTypes: {
      import: {
        package: '@prisma-next/mongo-core/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};
