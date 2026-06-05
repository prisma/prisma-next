import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import type { MongoControlAdapterDescriptor } from '@prisma-next/family-mongo/control-adapter';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { Db } from 'mongodb';

export { MongoCommandExecutor, MongoInspectionExecutor } from '../core/command-executor';
export { introspectSchema } from '../core/introspect-schema';
export { MongoControlAdapterImpl } from '../core/mongo-control-adapter';
export {
  createMongoControlDriver,
  isMongoControlDriver,
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

const defaultControlAdapter = new MongoControlAdapterImpl();

function controlDriverFromDb(db: Db): ControlDriverInstance<'mongo', 'mongo'> & { db: Db } {
  return {
    familyId: 'mongo',
    targetId: 'mongo',
    db,
    close: async () => {},
  };
}

export async function readMarker(db: Db, space: string): Promise<ContractMarkerRecord | null> {
  return defaultControlAdapter.readMarker(controlDriverFromDb(db), space);
}

export async function readAllMarkers(db: Db): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
  return defaultControlAdapter.readAllMarkers(controlDriverFromDb(db));
}

export async function initMarker(
  db: Db,
  space: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<void> {
  await defaultControlAdapter.initMarker(controlDriverFromDb(db), space, destination);
}

export async function updateMarker(
  db: Db,
  space: string,
  expectedFrom: string,
  destination: {
    readonly storageHash: string;
    readonly profileHash: string;
    readonly invariants?: readonly string[];
  },
): Promise<boolean> {
  return defaultControlAdapter.updateMarker(
    controlDriverFromDb(db),
    space,
    expectedFrom,
    destination,
  );
}

export async function readLedger(db: Db, space?: string): Promise<readonly LedgerEntryRecord[]> {
  return defaultControlAdapter.readLedger(controlDriverFromDb(db), space);
}

export async function writeLedgerEntry(
  db: Db,
  space: string,
  entry: {
    readonly edgeId: string;
    readonly from: string;
    readonly to: string;
    readonly migrationName: string;
    readonly migrationHash: string;
    readonly operations: readonly unknown[];
  },
): Promise<void> {
  await defaultControlAdapter.writeLedgerEntry(controlDriverFromDb(db), space, entry);
}

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
