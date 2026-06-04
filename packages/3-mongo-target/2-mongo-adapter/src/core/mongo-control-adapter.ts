import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import { withMarkerReadErrorHandling } from '@prisma-next/errors/execution';
import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import { ledgerOriginFromStored } from '@prisma-next/migration-tools/ledger-origin';
import {
  RawAggregateCommand,
  RawFindOneAndUpdateCommand,
  RawInsertOneCommand,
} from '@prisma-next/mongo-query-ast/execution';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { Document } from 'mongodb';
import { introspectSchema } from './introspect-schema';
import {
  COLLECTION,
  executeAggregate,
  executeFindOneAndUpdate,
  executeInsertOne,
  MONGO_LEDGER_COLLECTION,
  MONGO_MARKER_COLLECTION,
  parseMongoMarkerDocSafely,
} from './marker-ledger';
import { extractDb } from './runner-deps';

/**
 * Mongo control adapter for control-plane operations like introspection
 * and marker-ledger CAS. Implements the family-level `MongoControlAdapter`
 * SPI by extracting the underlying `Db` from the framework-shaped driver
 * per call.
 */
export class MongoControlAdapterImpl implements MongoControlAdapter<'mongo'> {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;

  async readMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const db = extractDb(driver);
    const markerContext = { space, markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        executeAggregate(
          db,
          new RawAggregateCommand(COLLECTION, [{ $match: { _id: space, space } }, { $limit: 1 }]),
        ),
      markerContext,
    );
    const doc = docs[0];
    if (!doc) return null;
    return parseMongoMarkerDocSafely(doc, space);
  }

  async readAllMarkers(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
  ): Promise<ReadonlyMap<string, ContractMarkerRecord>> {
    const db = extractDb(driver);
    const markerContext = { space: 'app', markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        executeAggregate(
          db,
          new RawAggregateCommand(COLLECTION, [
            {
              $match: {
                _id: { $type: 'string' },
                space: { $type: 'string' },
                $expr: { $eq: ['$_id', '$space'] },
              },
            },
          ]),
        ),
      markerContext,
    );
    const out = new Map<string, ContractMarkerRecord>();
    for (const doc of docs) {
      const space = doc['space'];
      /* v8 ignore next -- @preserve type-narrowing guard: the $match stage above filters on `space: { $type: 'string' }`, so this branch is unreachable at runtime. The check exists so the `out.set(space, ...)` call below can accept `string`. */
      if (typeof space !== 'string') continue;
      out.set(space, parseMongoMarkerDocSafely(doc, space));
    }
    return out;
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
    const db = extractDb(driver);
    const cmd = new RawInsertOneCommand(COLLECTION, {
      _id: space,
      space,
      storageHash: destination.storageHash,
      profileHash: destination.profileHash,
      contractJson: null,
      canonicalVersion: null,
      updatedAt: new Date(),
      appTag: null,
      meta: {},
      invariants: destination.invariants ?? [],
    });
    await executeInsertOne(db, cmd);
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
    const db = extractDb(driver);
    const setBase: Record<string, unknown> = {
      storageHash: destination.storageHash,
      profileHash: destination.profileHash,
      updatedAt: new Date(),
    };
    const update: Document | Document[] =
      destination.invariants === undefined
        ? { $set: setBase }
        : [
            {
              $set: {
                ...setBase,
                invariants: {
                  $sortArray: {
                    input: {
                      $setUnion: [{ $ifNull: ['$invariants', []] }, destination.invariants],
                    },
                    sortBy: 1,
                  },
                },
              },
            },
          ];
    const cmd = new RawFindOneAndUpdateCommand(
      COLLECTION,
      { _id: space, space, storageHash: expectedFrom },
      update,
      false,
    );
    const result = await executeFindOneAndUpdate(db, cmd);
    return result !== null;
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
    const db = extractDb(driver);
    const cmd = new RawInsertOneCommand(COLLECTION, {
      type: 'ledger',
      space,
      edgeId: entry.edgeId,
      from: entry.from,
      to: entry.to,
      migrationName: entry.migrationName,
      migrationHash: entry.migrationHash,
      operations: entry.operations,
      appliedAt: new Date(),
    });
    await executeInsertOne(db, cmd);
  }

  async readLedger(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const db = extractDb(driver);
    const ledgerContext = { space: space ?? '*', markerLocation: MONGO_LEDGER_COLLECTION };
    const matchStage: Record<string, unknown> = { type: 'ledger' };
    if (space !== undefined) {
      matchStage['space'] = space;
    }
    const docs = await withMarkerReadErrorHandling(
      () =>
        executeAggregate(
          db,
          new RawAggregateCommand(COLLECTION, [{ $match: matchStage }, { $sort: { _id: 1 } }]),
        ),
      ledgerContext,
    );

    const entries: LedgerEntryRecord[] = [];
    for (const doc of docs) {
      const migrationName = doc['migrationName'];
      const migrationHash = doc['migrationHash'];
      const from = doc['from'];
      const to = doc['to'];
      const docSpace = doc['space'];
      if (typeof migrationName !== 'string' || typeof migrationHash !== 'string') {
        continue;
      }
      if (typeof from !== 'string' || typeof to !== 'string') {
        continue;
      }
      if (typeof docSpace !== 'string') {
        continue;
      }
      const appliedAt = doc['appliedAt'];
      const appliedAtDate =
        appliedAt instanceof Date
          ? appliedAt
          : appliedAt !== undefined
            ? new Date(String(appliedAt))
            : new Date();
      const operations = doc['operations'];
      const opList = Array.isArray(operations) ? operations : [];
      entries.push({
        space: docSpace,
        migrationName,
        migrationHash,
        from: ledgerOriginFromStored(from),
        to,
        appliedAt: appliedAtDate,
        operationCount: opList.length,
      });
    }
    return entries;
  }

  async introspectSchema(driver: ControlDriverInstance<'mongo', 'mongo'>): Promise<MongoSchemaIR> {
    return introspectSchema(extractDb(driver));
  }
}
