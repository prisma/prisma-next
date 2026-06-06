import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import { MongoControlDriver } from '@prisma-next/driver-mongo/control';
import { CliStructuredError } from '@prisma-next/errors/control';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoControlAdapterImpl } from '../src/exports/control';

const controlAdapter = new MongoControlAdapterImpl();

const APP = 'app';
const EXT = 'cipherstash';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let driver: MongoControlDriver;
const dbName = 'marker_ledger_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
  driver = new MongoControlDriver(db, client);
}, timeouts.spinUpMongoMemoryServer);

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
}, timeouts.spinUpMongoMemoryServer);

beforeEach(async () => {
  await db.collection('_prisma_migrations').deleteMany({});
});

describe('readMarker', () => {
  it('returns null from empty collection', async () => {
    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker).toBeNull();
  });

  it('defaults meta to empty object when absent from document', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker).not.toBeNull();
    expect(marker?.meta).toEqual({});
  });

  it('defaults invariants to empty array when the field is absent (natural schemaless behaviour)', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual([]);
  });

  it('defaults updatedAt to a fresh Date when absent from document', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.updatedAt).toBeInstanceOf(Date);
  });

  it('throws when invariants is present but not a string array (storage corruption)', async () => {
    // Absent is fine (schemaless default); present-but-malformed is a
    // hard error — corruption shouldn't be silently coerced.
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
      invariants: [1, 2, 3],
    });

    await expect(controlAdapter.readMarker(driver, APP)).rejects.toSatisfy((err: unknown) => {
      expect(CliStructuredError.is(err)).toBe(true);
      expect((err as CliStructuredError).toEnvelope().code).toBe('PN-RUN-3005');
      return true;
    });
  });

  it('throws PN-RUN-3005 when invariants is present but not an array (storage corruption)', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
      invariants: 'not-an-array',
    });

    await expect(controlAdapter.readMarker(driver, APP)).rejects.toSatisfy((err: unknown) => {
      expect((err as CliStructuredError).toEnvelope().code).toBe('PN-RUN-3005');
      return true;
    });
  });

  it('partitions reads by space — a marker for one space is invisible to another', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:app1',
      profileHash: 'sha256:appp1',
    });
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:ext1',
      profileHash: 'sha256:extp1',
    });

    const appMarker = await controlAdapter.readMarker(driver, APP);
    const extMarker = await controlAdapter.readMarker(driver, EXT);
    const otherMarker = await controlAdapter.readMarker(driver, 'unknown-space');

    expect(appMarker?.storageHash).toBe('sha256:app1');
    expect(extMarker?.storageHash).toBe('sha256:ext1');
    expect(otherMarker).toBeNull();
  });
});

describe('initMarker', () => {
  it('writes a doc keyed by space: _id and space both equal the supplied space id', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const raw = await db
      .collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations')
      .findOne({ _id: APP });
    expect(raw?.['_id']).toBe(APP);
    expect(raw?.['space']).toBe(APP);
    expect(raw?.['storageHash']).toBe('sha256:abc');
    expect(raw?.['profileHash']).toBe('sha256:def');
  });

  it('initializes a marker that can be read back', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker).not.toBeNull();
    expect(marker?.storageHash).toBe('sha256:abc');
    expect(marker?.profileHash).toBe('sha256:def');
    expect(marker?.updatedAt).toBeInstanceOf(Date);
    expect(marker?.meta).toEqual({});
    expect(marker?.contractJson).toBeNull();
    expect(marker?.canonicalVersion).toBeNull();
    expect(marker?.appTag).toBeNull();
    expect(marker?.invariants).toEqual([]);
  });

  it('writes invariants to the marker document', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      invariants: ['alpha', 'beta'],
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('co-existing markers for different spaces do not collide', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:app1',
      profileHash: 'sha256:appp1',
    });
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:ext1',
      profileHash: 'sha256:extp1',
    });

    const docs = await db.collection('_prisma_migrations').find({}).sort({ _id: 1 }).toArray();
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d['_id'])).toEqual([APP, EXT]);
  });
});

describe('updateMarker', () => {
  it('succeeds with correct expected hash (CAS)', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(true);

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.storageHash).toBe('sha256:v2');
    expect(marker?.profileHash).toBe('sha256:p2');
  });

  it('fails with wrong expected hash (CAS failure)', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await controlAdapter.updateMarker(driver, APP, 'sha256:wrong', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(false);

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.storageHash).toBe('sha256:v1');
  });

  it('does not cross-update a different space (CAS is per-space)', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(true);
    const appMarker = await controlAdapter.readMarker(driver, APP);
    const extMarker = await controlAdapter.readMarker(driver, EXT);
    expect(appMarker?.storageHash).toBe('sha256:v2');
    expect(extMarker?.storageHash).toBe('sha256:v1');
  });

  it('merges caller-supplied invariants into the existing field server-side', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    const updated = await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['beta', 'gamma'],
    });

    expect(updated).toBe(true);
    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('dedupes and sorts the merged set', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['gamma', 'alpha'],
    });

    await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['delta', 'alpha', 'beta'],
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('leaves existing invariants untouched when the caller omits the field', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha']);
  });

  it('treats [] as a no-op merge (does not clobber existing invariants)', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha', 'beta'],
    });

    await controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: [],
    });

    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('preserves both writers invariants under interleaved updates (server-side merge)', async () => {
    // Each `findOneAndUpdate` runs its `$setUnion` against the doc's
    // current value, so concurrent updates accumulate atomically.
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: [],
    });

    const [updatedA, updatedB] = await Promise.all([
      controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['alpha'],
      }),
      controlAdapter.updateMarker(driver, APP, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['beta'],
      }),
    ]);

    expect(updatedA).toBe(true);
    expect(updatedB).toBe(true);
    const marker = await controlAdapter.readMarker(driver, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });
});

type ExpectedLedgerEntry = Omit<LedgerEntryRecord, 'appliedAt'>;

function expectReadLedger(
  entries: readonly LedgerEntryRecord[],
  expected: readonly ExpectedLedgerEntry[],
): void {
  expect(entries).toHaveLength(expected.length);
  for (const entry of entries) {
    expect(entry.appliedAt).toBeInstanceOf(Date);
  }
  expect(entries.map(({ appliedAt: _appliedAt, ...rest }) => rest)).toEqual(expected);
}

describe('readLedger', { timeout: timeouts.databaseOperation }, () => {
  it('returns an empty array when no ledger entries exist for the space', async () => {
    expect(await controlAdapter.readLedger(driver, APP)).toEqual([]);
  });

  it('returns entries in insertion order with cross-target LedgerEntryRecord shape', async () => {
    const hashA = 'sha256:ledger-mid-a';
    const hashB = 'sha256:ledger-mid-b';
    const destHash = 'sha256:ledger-dest';
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'sha256:empty->sha256:ledger-mid-a',
      from: 'sha256:empty',
      to: hashA,
      migrationName: '001_a',
      migrationHash: 'sha256:mig-a',
      operations: [{ id: 'edge.a' }],
    });
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: `${hashA}->${hashB}`,
      from: hashA,
      to: hashB,
      migrationName: '002_b',
      migrationHash: 'sha256:mig-b',
      operations: [{ id: 'edge.b1' }, { id: 'edge.b2' }],
    });
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: `${hashB}->${destHash}`,
      from: hashB,
      to: destHash,
      migrationName: '003_c',
      migrationHash: 'sha256:mig-c',
      operations: [{ id: 'edge.c' }],
    });

    const ledger = await controlAdapter.readLedger(driver, APP);
    expectReadLedger(ledger, [
      {
        space: APP,
        migrationName: '001_a',
        migrationHash: 'sha256:mig-a',
        from: null,
        to: hashA,
        operationCount: 1,
      },
      {
        space: APP,
        migrationName: '002_b',
        migrationHash: 'sha256:mig-b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        space: APP,
        migrationName: '003_c',
        migrationHash: 'sha256:mig-c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ]);
  });

  it('skips legacy ledger docs missing migrationName or migrationHash', async () => {
    await db.collection('_prisma_migrations').insertOne({
      type: 'ledger',
      space: APP,
      edgeId: 'legacy-edge',
      from: 'sha256:v1',
      to: 'sha256:v2',
      appliedAt: new Date('2024-01-01T00:00:00.000Z'),
      operations: [],
    });
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
      migrationName: '001_ok',
      migrationHash: 'sha256:ok',
      operations: [{ id: 'op.one' }],
    });

    const ledger = await controlAdapter.readLedger(driver, APP);
    expectReadLedger(ledger, [
      {
        space: APP,
        migrationName: '001_ok',
        migrationHash: 'sha256:ok',
        from: 'sha256:v1',
        to: 'sha256:v2',
        operationCount: 1,
      },
    ]);
  });

  it('maps synth empty-string from to null', async () => {
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: '->sha256:v1',
      from: '',
      to: 'sha256:v1',
      migrationName: '',
      migrationHash: 'sha256:v1',
      operations: [],
    });

    const ledger = await controlAdapter.readLedger(driver, APP);
    expectReadLedger(ledger, [
      {
        space: APP,
        migrationName: '',
        migrationHash: 'sha256:v1',
        from: null,
        to: 'sha256:v1',
        operationCount: 0,
      },
    ]);
  });

  it('returns rows for every space when space is omitted', async () => {
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-app',
      from: 'sha256:empty',
      to: 'sha256:app-dest',
      migrationName: '001_app',
      migrationHash: 'sha256:mig-app',
      operations: [{ id: 'app.op' }],
    });
    await controlAdapter.writeLedgerEntry(driver, EXT, {
      edgeId: 'edge-ext',
      from: 'sha256:empty',
      to: 'sha256:ext-dest',
      migrationName: '001_ext',
      migrationHash: 'sha256:mig-ext',
      operations: [{ id: 'ext.op' }],
    });

    const all = await controlAdapter.readLedger(driver);
    expectReadLedger(all, [
      {
        space: APP,
        migrationName: '001_app',
        migrationHash: 'sha256:mig-app',
        from: null,
        to: 'sha256:app-dest',
        operationCount: 1,
      },
      {
        space: EXT,
        migrationName: '001_ext',
        migrationHash: 'sha256:mig-ext',
        from: null,
        to: 'sha256:ext-dest',
        operationCount: 1,
      },
    ]);
    expect(await controlAdapter.readLedger(driver, APP)).toHaveLength(1);
  });
});

describe('writeLedgerEntry', { timeout: timeouts.databaseOperation }, () => {
  it('writes a ledger entry that exists in collection, tagged with space', async () => {
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
      migrationName: '001_init',
      migrationHash: 'sha256:mig-1',
      operations: [{ id: 'op.one' }],
    });

    const entries = await db.collection('_prisma_migrations').find({ type: 'ledger' }).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'ledger',
      space: APP,
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
      migrationName: '001_init',
      migrationHash: 'sha256:mig-1',
      operations: [{ id: 'op.one' }],
    });
    expect(entries[0]?.['appliedAt']).toBeInstanceOf(Date);
  });

  it('appends multiple ledger entries (append-only)', async () => {
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
      migrationName: '001_a',
      migrationHash: 'sha256:a',
      operations: [{ id: 'a' }],
    });
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-2',
      from: 'sha256:v2',
      to: 'sha256:v3',
      migrationName: '002_b',
      migrationHash: 'sha256:b',
      operations: [{ id: 'b' }],
    });

    const entries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .sort({ appliedAt: 1 })
      .toArray();
    expect(entries).toHaveLength(2);
    expect(entries[0]?.['edgeId']).toBe('edge-1');
    expect(entries[1]?.['edgeId']).toBe('edge-2');
  });

  it('records the same edgeId across different spaces without collision (key is (space, edgeId))', async () => {
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-1',
      from: '',
      to: 'sha256:v1',
      migrationName: '',
      migrationHash: 'sha256:v1',
      operations: [],
    });
    await controlAdapter.writeLedgerEntry(driver, EXT, {
      edgeId: 'edge-1',
      from: '',
      to: 'sha256:v1',
      migrationName: '',
      migrationHash: 'sha256:v1',
      operations: [],
    });

    const entries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .sort({ space: 1 })
      .toArray();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e['space'])).toEqual([APP, EXT]);
  });
});

describe('mismatched _id and space (defence-in-depth)', () => {
  // initMarker writes _id === space, so a row where the two diverge can
  // only appear via direct corruption or a non-Prisma writer. The reads
  // and CAS update should ignore such rows so a malformed doc can't
  // masquerade as a marker for either of the two implied spaces.
  const insertMismatched = async () =>
    db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: EXT,
      storageHash: 'sha256:rogue',
      profileHash: 'sha256:rogue',
      updatedAt: new Date(),
    });

  it('readMarker ignores a row whose _id does not equal space', async () => {
    await insertMismatched();

    expect(await controlAdapter.readMarker(driver, APP)).toBeNull();
    expect(await controlAdapter.readMarker(driver, EXT)).toBeNull();
  });

  it('readAllMarkers excludes rows whose _id does not equal space', async () => {
    await insertMismatched();
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:ext1',
      profileHash: 'sha256:p1',
    });

    const markers = await controlAdapter.readAllMarkers(driver);
    expect(markers.size).toBe(1);
    expect(markers.get(EXT)?.storageHash).toBe('sha256:ext1');
  });

  it('updateMarker CAS does not match a row whose _id does not equal space', async () => {
    await insertMismatched();

    const updated = await controlAdapter.updateMarker(driver, APP, 'sha256:rogue', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(false);
  });
});

describe('readAllMarkers', () => {
  it('returns an empty map when no marker docs exist', async () => {
    const markers = await controlAdapter.readAllMarkers(driver);
    expect(markers.size).toBe(0);
  });

  it('returns one entry per space, keyed by space id', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:app1',
      profileHash: 'sha256:p1',
    });
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:ext1',
      profileHash: 'sha256:p2',
    });

    const markers = await controlAdapter.readAllMarkers(driver);
    expect(markers.size).toBe(2);
    expect(markers.get(APP)?.storageHash).toBe('sha256:app1');
    expect(markers.get(EXT)?.storageHash).toBe('sha256:ext1');
  });

  it('excludes ledger entries (filter keys on string _id with a space field)', async () => {
    await controlAdapter.initMarker(driver, APP, {
      storageHash: 'sha256:app1',
      profileHash: 'sha256:p1',
    });
    await controlAdapter.writeLedgerEntry(driver, APP, {
      edgeId: 'edge-1',
      from: '',
      to: 'sha256:app1',
      migrationName: '',
      migrationHash: 'sha256:app1',
      operations: [],
    });

    const markers = await controlAdapter.readAllMarkers(driver);
    expect(markers.size).toBe(1);
    expect(markers.has(APP)).toBe(true);
  });

  it('filters out malformed docs that lack the required space field', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'malformed',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
    });
    await controlAdapter.initMarker(driver, EXT, {
      storageHash: 'sha256:ext1',
      profileHash: 'sha256:p2',
    });

    const markers = await controlAdapter.readAllMarkers(driver);
    expect(markers.size).toBe(1);
    expect(markers.has(EXT)).toBe(true);
    expect(markers.has('malformed')).toBe(false);
  });
});
