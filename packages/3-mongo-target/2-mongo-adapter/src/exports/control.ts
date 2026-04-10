import type { ControlAdapterDescriptor } from '@prisma-next/framework-components/control';

export { MongoCommandExecutor, MongoInspectionExecutor } from '../core/command-executor';
export { contractToMongoSchemaIR } from '../core/contract-to-schema';
export { formatMongoOperations } from '../core/ddl-formatter';
export { initMarker, readMarker, updateMarker, writeLedgerEntry } from '../core/marker-ledger';
export {
  createMongoControlDriver,
  type MongoControlDriverInstance,
} from '../core/mongo-control-driver';
export { deserializeMongoOps, serializeMongoOps } from '../core/mongo-ops-serializer';
export { MongoMigrationPlanner } from '../core/mongo-planner';
export { MongoMigrationRunner } from '../core/mongo-runner';

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
