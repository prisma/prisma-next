import type { TargetDescriptor } from '@prisma-next/framework-components/components';
import mongoTargetDescriptorMeta from '@prisma-next/target-mongo';

export const mongoTargetDescriptor = {
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
} as const satisfies TargetDescriptor<'mongo', 'mongo'>;
