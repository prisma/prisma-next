import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initMarker, readMarker, updateMarker, writeLedgerEntry } from '../src/core/marker-ledger';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'marker_ledger_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  await db.collection('_prisma_migrations').deleteMany({});
});

describe('readMarker', () => {
  it('returns null from empty collection', async () => {
    const marker = await readMarker(db);
    expect(marker).toBeNull();
  });

  it('defaults meta to empty object when absent from document', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'marker',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
    });

    const marker = await readMarker(db);
    expect(marker).not.toBeNull();
    expect(marker?.meta).toEqual({});
  });

  it('defaults invariants to empty array when the field is absent (natural schemaless behaviour)', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'marker',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
    });

    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual([]);
  });

  it('throws when invariants is present but not a string array (storage corruption)', async () => {
    // Mongo is schemaless, but spec §"Schema evolution" line 226 says:
    // "data corruption is not something we silently paper over." Mirrors the
    // Postgres parser's strict stance — absent is fine (schemaless default),
    // but a present-but-malformed value is a hard error.
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'marker',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
      invariants: [1, 2, 3], // numbers, not strings
    });

    await expect(readMarker(db)).rejects.toThrow(/Invalid marker doc.*invariants/);
  });

  it('throws when invariants is present but not an array (storage corruption)', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: 'marker',
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
      invariants: 'not-an-array',
    });

    await expect(readMarker(db)).rejects.toThrow(/Invalid marker doc.*invariants/);
  });
});

describe('initMarker', () => {
  it('initializes a marker that can be read back', async () => {
    await initMarker(db, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const marker = await readMarker(db);
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
    await initMarker(db, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      invariants: ['alpha', 'beta'],
    });

    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });
});

describe('updateMarker', () => {
  it('succeeds with correct expected hash (CAS)', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await updateMarker(db, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(true);

    const marker = await readMarker(db);
    expect(marker?.storageHash).toBe('sha256:v2');
    expect(marker?.profileHash).toBe('sha256:p2');
  });

  it('fails with wrong expected hash (CAS failure)', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await updateMarker(db, 'sha256:wrong', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(false);

    const marker = await readMarker(db);
    expect(marker?.storageHash).toBe('sha256:v1');
  });

  it('merges caller-supplied invariants into the existing field server-side', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    const updated = await updateMarker(db, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['beta', 'gamma'],
    });

    expect(updated).toBe(true);
    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('dedupes and sorts the merged set', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['gamma', 'alpha'],
    });

    await updateMarker(db, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['delta', 'alpha', 'beta'],
    });

    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('leaves existing invariants untouched when the caller omits the field', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    await updateMarker(db, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha']);
  });

  it('treats [] as a no-op merge (does not clobber existing invariants)', async () => {
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha', 'beta'],
    });

    await updateMarker(db, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: [],
    });

    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('preserves both writers invariants under interleaved updates (server-side merge)', async () => {
    // Pins the design contract from spec §"Concurrency: server-side merge
    // for invariants". With server-side merge each `findOneAndUpdate` runs
    // its `$setUnion` against the doc's current value, so concurrent
    // updates accumulate. With the pre-fix client-side union, both writers
    // would have read the initial state, computed their union locally, and
    // the second `$set` would have clobbered the first — this test would
    // fail.
    await initMarker(db, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: [],
    });

    const [updatedA, updatedB] = await Promise.all([
      updateMarker(db, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['alpha'],
      }),
      updateMarker(db, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['beta'],
      }),
    ]);

    expect(updatedA).toBe(true);
    expect(updatedB).toBe(true);
    const marker = await readMarker(db);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });
});

describe('writeLedgerEntry', () => {
  it('writes a ledger entry that exists in collection', async () => {
    await writeLedgerEntry(db, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });

    const entries = await db.collection('_prisma_migrations').find({ type: 'ledger' }).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'ledger',
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });
    expect(entries[0]?.['appliedAt']).toBeInstanceOf(Date);
  });

  it('appends multiple ledger entries (append-only)', async () => {
    await writeLedgerEntry(db, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });
    await writeLedgerEntry(db, {
      edgeId: 'edge-2',
      from: 'sha256:v2',
      to: 'sha256:v3',
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
});
