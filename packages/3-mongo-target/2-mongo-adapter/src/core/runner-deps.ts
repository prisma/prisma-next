import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import {
  initMarker,
  type MongoRunnerDependencies,
  readMarker,
  updateMarker,
  writeLedgerEntry,
} from '@prisma-next/target-mongo/control';
import type { Db } from 'mongodb';
import { MongoCommandExecutor, MongoInspectionExecutor } from './command-executor';

function extractDb(driver: ControlDriverInstance<'mongo', 'mongo'>): Db {
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
  driver: ControlDriverInstance<'mongo', 'mongo'>,
): MongoRunnerDependencies {
  const db = extractDb(driver);
  return {
    commandExecutor: new MongoCommandExecutor(db),
    inspectionExecutor: new MongoInspectionExecutor(db),
    markerOps: {
      readMarker: () => readMarker(db),
      initMarker: (dest) => initMarker(db, dest),
      updateMarker: (expectedFrom, dest) => updateMarker(db, expectedFrom, dest),
      writeLedgerEntry: (entry) => writeLedgerEntry(db, entry),
    },
  };
}
