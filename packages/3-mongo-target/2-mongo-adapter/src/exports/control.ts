import type { ControlAdapterDescriptor } from '@prisma-next/framework-components/control';
import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoInt32Codec,
  mongoObjectIdCodec,
  mongoStringCodec,
  mongoVectorCodec,
} from '../core/codecs';

const mongoAdapterDescriptor: ControlAdapterDescriptor<'mongo', 'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  types: {
    codecTypes: {
      codecInstances: [
        mongoObjectIdCodec,
        mongoStringCodec,
        mongoInt32Codec,
        mongoBooleanCodec,
        mongoDateCodec,
        mongoVectorCodec,
      ],
      import: {
        package: '@prisma-next/adapter-mongo/codec-types',
        named: 'CodecTypes',
        alias: 'MongoCodecTypes',
      },
      typeImports: [
        {
          package: '@prisma-next/adapter-mongo/codec-types',
          named: 'Vector',
          alias: 'Vector',
        },
      ],
    },
  },
  create() {
    return { familyId: 'mongo' as const, targetId: 'mongo' as const };
  },
};

export default mongoAdapterDescriptor;
