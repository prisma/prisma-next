import type { TargetDescriptor } from '@prisma-next/contract/framework-components';

export const mongoTargetDescriptor = {
  kind: 'target',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
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
