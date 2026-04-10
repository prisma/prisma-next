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
