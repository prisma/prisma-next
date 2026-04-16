import type { ControlAdapterDescriptor } from '@prisma-next/framework-components/control';

export { MongoCommandExecutor, MongoInspectionExecutor } from '../core/command-executor';
export { introspectSchema } from '../core/introspect-schema';
export {
  createMongoControlDriver,
  type MongoControlDriverInstance,
} from '../core/mongo-control-driver';
export { createMongoRunnerDeps } from '../core/runner-deps';

import {
  mongoBooleanCodec,
  mongoDateCodec,
  mongoDoubleCodec,
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
        mongoDoubleCodec,
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
