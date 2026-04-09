import type { ControlAdapterDescriptor } from '@prisma-next/framework-components/control';

export { contractToMongoSchemaIR } from '../core/contract-to-schema';
export { formatMongoOperations } from '../core/ddl-formatter';
export { deserializeMongoOps, serializeMongoOps } from '../core/mongo-ops-serializer';
export { MongoMigrationPlanner } from '../core/mongo-planner';

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
