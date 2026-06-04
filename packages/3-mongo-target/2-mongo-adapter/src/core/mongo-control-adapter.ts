import type { ContractMarkerRecord, LedgerEntryRecord } from '@prisma-next/contract/types';
import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import { withMarkerReadErrorHandling } from '@prisma-next/errors/execution';
import type { MongoControlAdapter } from '@prisma-next/family-mongo/control-adapter';
import type { ControlDriverInstance } from '@prisma-next/framework-components/control';
import { ledgerOriginFromStored } from '@prisma-next/migration-tools/ledger-origin';
import type { MongoAdapter } from '@prisma-next/mongo-lowering';
import {
  type AnyMongoCommand,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
  type MongoQueryPlan,
} from '@prisma-next/mongo-query-ast/execution';
import { expr, fn } from '@prisma-next/mongo-query-builder';
import { collection } from '@prisma-next/mongo-query-builder/contract-free';
import type { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import type { MongoValue } from '@prisma-next/mongo-value';
import { blindCast, castAs } from '@prisma-next/utils/casts';
import type { Db, Document } from 'mongodb';
import { createMongoAdapter } from '../mongo-adapter';
import { CONTROL_COLLECTION, type ControlDocShape } from './control-construction';
import { introspectSchema } from './introspect-schema';
import {
  MONGO_LEDGER_COLLECTION,
  MONGO_MARKER_COLLECTION,
  parseMongoMarkerDocSafely,
} from './marker-ledger';
import { extractDb } from './runner-deps';

/**
 * Mongo control drivers expose the underlying `Db` so the wire transport
 * can be reached without a side channel. The SPI types the driver as the
 * abstract {@link ControlDriverInstance} (which carries only `query` /
 * `close`), so the marker-op path resolves the `Db` once through this typed
 * view — `db` is structurally optional, so reading it needs no bare cast —
 * inside {@link MongoControlAdapterImpl} rather than at each call site.
 */
function controlDriverDb(driver: ControlDriverInstance<'mongo', 'mongo'>): Db {
  const { db } = castAs<ControlDriverInstance<'mongo', 'mongo'> & { readonly db?: Db }>(driver);
  if (db) return db;
  throw new Error(
    'Mongo control driver does not expose a db property. ' +
      'Use createMongoControlDriver() from `@prisma-next/adapter-mongo/control`.',
  );
}

/**
 * Mongo control adapter for control-plane operations like introspection
 * and marker-ledger CAS. Implements the family-level `MongoControlAdapter`
 * SPI. Every marker/ledger operation builds a canonical command inline via
 * the contract-free fluent builder and dispatches it through the family
 * adapter's lowering path (`createMongoAdapter().lower(plan, {})`) onto the
 * Mongo wire transport (`MongoDriverImpl.fromDb(db).execute(wireCommand)`) —
 * the same route SQL marker/ledger ops take through `adapter.lower()` →
 * `driver.query()`.
 */
export class MongoControlAdapterImpl implements MongoControlAdapter<'mongo'> {
  readonly familyId = 'mongo' as const;
  readonly targetId = 'mongo' as const;
  readonly #adapter: MongoAdapter = createMongoAdapter();
  readonly #control = collection<ControlDocShape>(CONTROL_COLLECTION);

  async #executeControl(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    command: AnyMongoCommand,
  ): Promise<Document[]> {
    const plan: MongoQueryPlan = {
      collection: CONTROL_COLLECTION,
      command,
      meta: { target: 'mongo', targetFamily: 'mongo', storageHash: '', lane: 'control' },
    };
    const wireCommand = await this.#adapter.lower(plan, {});
    const rows: Document[] = [];
    for await (const row of MongoDriverImpl.fromDb(controlDriverDb(driver)).execute<Document>(
      wireCommand,
    )) {
      rows.push(row);
    }
    return rows;
  }

  /**
   * Server-side invariant-merge aggregation expression:
   * `$sortArray({ input: $setUnion([$ifNull('$invariants', []), incoming]), sortBy: 1 })`.
   *
   * Built through the typed agg-expr layer — `fn.setUnion` plus the generic
   * `MongoAggOperator` for `$ifNull` / `$sortArray` (neither has a named `fn`
   * helper). Returns a `MongoAggOperator` that is passed directly to
   * `f.stage.set({ invariants: ... })` in the update pipeline.
   */
  #invariantMergeExpr(incoming: readonly string[]): MongoAggOperator {
    const existingOrEmpty = MongoAggOperator.of('$ifNull', [
      MongoAggFieldRef.of('invariants'),
      MongoAggLiteral.of([]),
    ]);
    const merged = fn.setUnion(
      { _field: { codecId: 'mongo/array@1', nullable: false }, node: existingOrEmpty },
      {
        _field: { codecId: 'mongo/array@1', nullable: false },
        node: MongoAggLiteral.of([...incoming]),
      },
    );
    return MongoAggOperator.of('$sortArray', { input: merged.node, sortBy: MongoAggLiteral.of(1) });
  }

  async readMarker(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space: string,
  ): Promise<ContractMarkerRecord | null> {
    const markerContext = { space, markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        this.#executeControl(
          driver,
          this.#control
            .aggregate()
            .match((f) => f._id.eq(space))
            .match((f) => f.space.eq(space))
            .limit(1)
            .build(),
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
    const markerContext = { space: 'app', markerLocation: MONGO_MARKER_COLLECTION };
    const docs = await withMarkerReadErrorHandling(
      () =>
        this.#executeControl(
          driver,
          this.#control
            .aggregate()
            .match((f) => f._id.type('string'))
            .match((f) => f.space.type('string'))
            .match((f) => expr(fn.eq(f._id, f.space)))
            .build(),
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
    const document: Record<string, MongoValue> = {
      _id: space,
      space,
      storageHash: destination.storageHash,
      profileHash: destination.profileHash,
      contractJson: null,
      canonicalVersion: null,
      updatedAt: new Date(),
      appTag: null,
      meta: {},
      invariants: [...(destination.invariants ?? [])],
    };
    await this.#executeControl(driver, this.#control.insertOne(document));
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
    const { invariants } = destination;
    const docs = await this.#executeControl(
      driver,
      this.#control
        .match((f) => f._id.eq(space))
        .match((f) => f.space.eq(space))
        .match((f) => f.storageHash.eq(expectedFrom))
        .findOneAndUpdate(
          (f) => [
            f.stage.set(
              invariants === undefined
                ? {
                    storageHash: MongoAggLiteral.of(destination.storageHash),
                    profileHash: MongoAggLiteral.of(destination.profileHash),
                    updatedAt: MongoAggLiteral.of(new Date()),
                  }
                : {
                    storageHash: MongoAggLiteral.of(destination.storageHash),
                    profileHash: MongoAggLiteral.of(destination.profileHash),
                    updatedAt: MongoAggLiteral.of(new Date()),
                    invariants: this.#invariantMergeExpr(invariants),
                  },
            ),
          ],
          { upsert: false },
        ),
    );
    return docs.length > 0;
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
    const document: Record<string, MongoValue> = {
      type: 'ledger',
      space,
      edgeId: entry.edgeId,
      from: entry.from,
      to: entry.to,
      migrationName: entry.migrationName,
      migrationHash: entry.migrationHash,
      operations: blindCast<ReadonlyArray<MongoValue>, 'ledger operation docs are BSON values'>(
        entry.operations,
      ),
      appliedAt: new Date(),
    };
    await this.#executeControl(driver, this.#control.insertOne(document));
  }

  async readLedger(
    driver: ControlDriverInstance<'mongo', 'mongo'>,
    space?: string,
  ): Promise<readonly LedgerEntryRecord[]> {
    const ledgerContext = { space: space ?? '*', markerLocation: MONGO_LEDGER_COLLECTION };
    const chain = this.#control.aggregate().match((f) => f.type.eq('ledger'));
    const command =
      space === undefined
        ? chain.sort({ _id: 1 }).build()
        : chain
            .match((f) => f.space.eq(space))
            .sort({ _id: 1 })
            .build();
    const docs = await withMarkerReadErrorHandling(
      () => this.#executeControl(driver, command),
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
