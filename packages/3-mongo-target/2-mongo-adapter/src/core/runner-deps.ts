import type { ContractMarkerRecord } from '@prisma-next/contract/types';
import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type {
  ControlDriverInstance,
  ControlFamilyInstance,
} from '@prisma-next/framework-components/control';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type {
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
} from '@prisma-next/mongo-query-ast/control';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { Db } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { MongoCommandExecutor, MongoInspectionExecutor } from './command-executor';
import { MongoControlAdapterImpl } from './mongo-control-adapter';
import { isMongoControlDriver } from './mongo-control-driver';

export function extractDb(driver: ControlDriverInstance<'mongo', 'mongo'>): Db {
  if (!isMongoControlDriver(driver)) {
    throw new Error(
      'Expected a Mongo control driver created by ' +
        'mongoControlDriver.create() from `@prisma-next/driver-mongo/control`.',
    );
  }
  return driver.db;
}

/**
 * Marker / ledger operations the Mongo runner depends on. Every method
 * takes a `space` parameter so each loaded contract space addresses its
 * own marker row independently — see ADR 212 for the per-space
 * mechanism.
 */
export interface MarkerOperations {
  readMarker(space: string): Promise<ContractMarkerRecord | null>;
  initMarker(
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void>;
  updateMarker(
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean>;
  writeLedgerEntry(
    space: string,
    entry: {
      readonly edgeId: string;
      readonly from: string;
      readonly to: string;
      readonly migrationName: string;
      readonly migrationHash: string;
      readonly operations: readonly unknown[];
    },
  ): Promise<void>;
}

export interface MongoRunnerDependencies {
  readonly commandExecutor: MongoDdlCommandVisitor<Promise<void>>;
  readonly inspectionExecutor: MongoInspectionCommandVisitor<Promise<Record<string, unknown>[]>>;
  readonly adapter: MongoAdapter;
  readonly driver: MongoDriver;
  readonly markerOps: MarkerOperations;
  readonly introspectSchema: () => Promise<MongoSchemaIR>;
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
  // Vestigial after the family→adapter SPI refactor: the runner dependencies
  // now route every wire-level call through `controlAdapter`, so the `family`
  // instance is no longer consulted. Kept on the signature to avoid rippling
  // through ~14 call sites; a follow-up that already touches this factory
  // should drop the parameter outright.
  _family: ControlFamilyInstance<'mongo', MongoSchemaIR>,
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
    introspectSchema: () => controlAdapter.introspectSchema(controlDriver),
  };
}
