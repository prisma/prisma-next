import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { introspectSchema } from './introspect-schema';
import {
  initMarker,
  readAllMarkers,
  readLedger,
  readMarker,
  updateMarker,
  writeLedgerEntry,
} from './marker-ledger';
import { extractDb } from './runner-deps';

/**
 * Mongo control adapter for control-plane operations like introspection
 * and marker-ledger CAS. Implements the family-level `MongoControlAdapter`
 * SPI by extracting the underlying `Db` from the framework-shaped driver
 * and forwarding to the wire-level helpers in this package.
 */
export class MongoControlAdapterImpl implements MongoControlAdapter<'mongo'> {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;

  async readMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    return readMarker(extractDb(driver), space);
  }

  async readAllMarkers(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    return readAllMarkers(extractDb(driver));
  }

  async initMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<void> {
    await initMarker(extractDb(driver), space, destination);
  }

  async updateMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
    expectedFrom: string,
    destination: {
      readonly storageHash: string;
      readonly profileHash: string;
      readonly invariants?: readonly string[];
    },
  ): Promise<boolean> {
    return updateMarker(extractDb(driver), space, expectedFrom, destination);
  }

  async writeLedgerEntry(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
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
    await writeLedgerEntry(extractDb(driver), space, entry);
  }

  async readLedger(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    return readLedger(extractDb(driver), space);
  }

  async introspectSchema(driver: ControlDriverInstance<'mongo', 'mongo'>): Promise<MongoSchemaIR> {
    return introspectSchema(extractDb(driver));
  }
}
