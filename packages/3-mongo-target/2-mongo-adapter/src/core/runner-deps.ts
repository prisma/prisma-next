import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@prisma-next/framework-components/control';
import type { MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { MongoRunnerDependencies } from '@prisma-next/target-mongo/control';
import type { Db } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { MongoCommandExecutor, MongoInspectionExecutor } from './command-executor';
import { MongoControlAdapterImpl } from './mongo-control-adapter';

export function extractDb(driver: ControlDriverInstance<'mongo', 'mongo'>): Db {
  const mongoDriver = driver as ControlDriverInstance<'mongo', 'mongo'> & { db?: Db };
  if (!mongoDriver.db) {
    throw new Error(
      'Mongo control driver does not expose a db property. ' +
        'Use mongoControlDriver.create() from `@prisma-next/driver-mongo/control`.',
    );
  }
  return mongoDriver.db;
}

/**
 * Build the runner-dependencies envelope. `controlAdapter` is the
 * dispatch surface for wire-level Mongo CAS operations (marker reads,
 * marker advances, ledger appends, introspection); the envelope's
 * `markerOps` shim simply forwards each call through it. When the
 * caller already has a `MongoControlAdapter` on the control stack it
 * can pass it in; otherwise a default `MongoControlAdapterImpl` is
 * constructed locally.
 */
export function createMongoRunnerDeps(
  controlDriver: ControlDriverInstance<'mongo', 'mongo'>,
  driver: MongoDriver,
  family: ControlFamilyInstance<'mongo', MongoSchemaIR>,
  controlAdapter: MongoControlAdapter<'mongo'> = new MongoControlAdapterImpl(),
): MongoRunnerDependencies {
  return {
    commandExecutor: new MongoCommandExecutor(extractDb(controlDriver)),
    inspectionExecutor: new MongoInspectionExecutor(extractDb(controlDriver)),
    adapter: createMongoAdapter(),
    driver,
    markerOps: {
      readMarker: (space) => controlAdapter.readMarker(controlDriver, space),
      initMarker: (space, dest) => controlAdapter.initMarker(controlDriver, space, dest),
      updateMarker: (space, expectedFrom, dest) =>
        controlAdapter.updateMarker(controlDriver, space, expectedFrom, dest),
      writeLedgerEntry: (space, entry) =>
        controlAdapter.writeLedgerEntry(controlDriver, space, entry),
    },
    introspectSchema: () => family.introspect({ driver: controlDriver }),
  };
}
