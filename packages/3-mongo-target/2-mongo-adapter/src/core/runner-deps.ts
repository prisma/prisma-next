import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@prisma-next/framework-components/control';
import type { MongoDriver } from '@prisma-next/mongo-lowering';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import {
  initMarker,
  type MongoRunnerDependencies,
  readMarker,
  updateMarker,
  writeLedgerEntry,
} from '@prisma-next/target-mongo/control';
import type { Db } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { MongoCommandExecutor, MongoInspectionExecutor } from './command-executor';

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

export function createMongoRunnerDeps(
  controlDriver: ControlDriverInstance<'mongo', 'mongo'>,
  driver: MongoDriver,
  family: ControlFamilyInstance<'mongo', MongoSchemaIR>,
): MongoRunnerDependencies {
  const db = extractDb(controlDriver);
  return {
    commandExecutor: new MongoCommandExecutor(db),
    inspectionExecutor: new MongoInspectionExecutor(db),
    adapter: createMongoAdapter(),
    driver,
    markerOps: {
      readMarker: () => readMarker(db),
      initMarker: (dest) => initMarker(db, dest),
      updateMarker: (expectedFrom, dest) => updateMarker(db, expectedFrom, dest),
      writeLedgerEntry: (entry) => writeLedgerEntry(db, entry),
    },
    introspectSchema: () => family.introspect({ driver: controlDriver }),
  };
}
