import type { MongoControlAdapterDescriptor } from '@prisma-next/family-mongo/control-adapter';

export { MongoCommandExecutor, MongoInspectionExecutor } from '../core/command-executor';
export { introspectSchema } from '../core/introspect-schema';
export {
  initMarker,
  readAllMarkers,
  readLedger,
  readMarker,
  updateMarker,
  writeLedgerEntry,
} from '../core/marker-ledger';
export { MongoControlAdapterImpl } from '../core/mongo-control-adapter';
export {
  createMongoControlDriver,
  type MongoControlDriverInstance,
} from '../core/mongo-control-driver';
export {
  createMongoRunnerDeps,
  extractDb,
  type MarkerOperations,
  type MongoRunnerDependencies,
} from '../core/runner-deps';
export { createMongoAdapter } from '../mongo-adapter';

import { mongoCodecDescriptors } from '../core/codecs';
import { MongoControlAdapterImpl } from '../core/mongo-control-adapter';

export const mongoAdapterDescriptor: MongoControlAdapterDescriptor<'mongo'> = {
  kind: 'adapter',
  id: 'mongo',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  scalarTypeDescriptors: new Map([
    ['String', 'mongo/string@1'],
    ['Int', 'mongo/int32@1'],
    ['Boolean', 'mongo/bool@1'],
    ['DateTime', 'mongo/date@1'],
    ['ObjectId', 'mongo/objectId@1'],
    ['Float', 'mongo/double@1'],
  ]),
  types: {
    codecTypes: {
      codecDescriptors: mongoCodecDescriptors,
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
  create(_stack) {
    return new MongoControlAdapterImpl();
  },
};

export default mongoAdapterDescriptor;
