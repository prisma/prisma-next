import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initMarker, readMarker, updateMarker, writeLedgerEntry } from '../src/core/marker-ledger';

const APP = 'app';
const EXT = 'cipherstash';

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
    const marker = await readMarker(db, APP);
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

    const marker = await readMarker(db, APP);
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

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual([]);
  });

  it('defaults updatedAt to a fresh Date when absent from document', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const marker = await readMarker(db, APP);
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

    await expect(readMarker(db, APP)).rejects.toThrow(/Invalid marker doc.*invariants/);
  });

  it('throws when invariants is present but not an array (storage corruption)', async () => {
    await db.collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations').insertOne({
      _id: APP,
      space: APP,
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      updatedAt: new Date(),
      invariants: 'not-an-array',
    });

    await expect(readMarker(db, APP)).rejects.toThrow(/Invalid marker doc.*invariants/);
  });

  it('partitions reads by space — a marker for one space is invisible to another', async () => {
    await initMarker(db, APP, { storageHash: 'sha256:app1', profileHash: 'sha256:appp1' });
    await initMarker(db, EXT, { storageHash: 'sha256:ext1', profileHash: 'sha256:extp1' });

    const appMarker = await readMarker(db, APP);
    const extMarker = await readMarker(db, EXT);
    const otherMarker = await readMarker(db, 'unknown-space');

    expect(appMarker?.storageHash).toBe('sha256:app1');
    expect(extMarker?.storageHash).toBe('sha256:ext1');
    expect(otherMarker).toBeNull();
  });
});

describe('initMarker', () => {
  it('writes a doc keyed by space (TC-3): _id and space both equal the supplied space id', async () => {
    await initMarker(db, APP, { storageHash: 'sha256:abc', profileHash: 'sha256:def' });

    const raw = await db
      .collection<{ _id: string; [key: string]: unknown }>('_prisma_migrations')
      .findOne({ _id: APP });
    expect(raw?.['_id']).toBe(APP);
    expect(raw?.['space']).toBe(APP);
    expect(raw?.['storageHash']).toBe('sha256:abc');
    expect(raw?.['profileHash']).toBe('sha256:def');
  });

  it('initializes a marker that can be read back', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
    });

    const marker = await readMarker(db, APP);
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
    await initMarker(db, APP, {
      storageHash: 'sha256:abc',
      profileHash: 'sha256:def',
      invariants: ['alpha', 'beta'],
    });

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('co-existing markers for different spaces do not collide', async () => {
    await initMarker(db, APP, { storageHash: 'sha256:app1', profileHash: 'sha256:appp1' });
    await initMarker(db, EXT, { storageHash: 'sha256:ext1', profileHash: 'sha256:extp1' });

    const docs = await db.collection('_prisma_migrations').find({}).sort({ _id: 1 }).toArray();
    expect(docs).toHaveLength(2);
    expect(docs.map((d) => d['_id'])).toEqual([APP, EXT]);
  });
});

describe('updateMarker', () => {
  it('succeeds with correct expected hash (CAS)', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(true);

    const marker = await readMarker(db, APP);
    expect(marker?.storageHash).toBe('sha256:v2');
    expect(marker?.profileHash).toBe('sha256:p2');
  });

  it('fails with wrong expected hash (CAS failure)', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
    });

    const updated = await updateMarker(db, APP, 'sha256:wrong', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(false);

    const marker = await readMarker(db, APP);
    expect(marker?.storageHash).toBe('sha256:v1');
  });

  it('does not cross-update a different space (CAS is per-space)', async () => {
    await initMarker(db, APP, { storageHash: 'sha256:v1', profileHash: 'sha256:p1' });
    await initMarker(db, EXT, { storageHash: 'sha256:v1', profileHash: 'sha256:p1' });

    const updated = await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    expect(updated).toBe(true);
    const appMarker = await readMarker(db, APP);
    const extMarker = await readMarker(db, EXT);
    expect(appMarker?.storageHash).toBe('sha256:v2');
    expect(extMarker?.storageHash).toBe('sha256:v1');
  });

  it('merges caller-supplied invariants into the existing field server-side', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    const updated = await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['beta', 'gamma'],
    });

    expect(updated).toBe(true);
    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'gamma']);
  });

  it('dedupes and sorts the merged set', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['gamma', 'alpha'],
    });

    await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: ['delta', 'alpha', 'beta'],
    });

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta', 'delta', 'gamma']);
  });

  it('leaves existing invariants untouched when the caller omits the field', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha'],
    });

    await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
    });

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha']);
  });

  it('treats [] as a no-op merge (does not clobber existing invariants)', async () => {
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: ['alpha', 'beta'],
    });

    await updateMarker(db, APP, 'sha256:v1', {
      storageHash: 'sha256:v2',
      profileHash: 'sha256:p2',
      invariants: [],
    });

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('preserves both writers invariants under interleaved updates (server-side merge)', async () => {
    // Each `findOneAndUpdate` runs its `$setUnion` against the doc's
    // current value, so concurrent updates accumulate atomically.
    await initMarker(db, APP, {
      storageHash: 'sha256:v1',
      profileHash: 'sha256:p1',
      invariants: [],
    });

    const [updatedA, updatedB] = await Promise.all([
      updateMarker(db, APP, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['alpha'],
      }),
      updateMarker(db, APP, 'sha256:v1', {
        storageHash: 'sha256:v1',
        profileHash: 'sha256:p1',
        invariants: ['beta'],
      }),
    ]);

    expect(updatedA).toBe(true);
    expect(updatedB).toBe(true);
    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });
});

describe('readMarker — legacy upgrade (TC-4, TC-5)', () => {
  // Pre-port code wrote a single marker doc keyed by `_id: 'marker'`
  // with no `space` field. Post-port code keys docs by space id and
  // requires `space` as part of the canonical shape. The first read
  // for the app space upgrades the legacy doc transparently. These
  // tests exercise the convergence properties of that upgrade.

  type RawMarker = { _id: string; [key: string]: unknown };
  const markerCol = () => db.collection<RawMarker>('_prisma_migrations');

  async function seedLegacyMarker(extra: Record<string, unknown> = {}): Promise<void> {
    await markerCol().insertOne({
      _id: 'marker',
      storageHash: 'sha256:legacy-storage',
      profileHash: 'sha256:legacy-profile',
      updatedAt: new Date('2024-01-15T00:00:00Z'),
      meta: { authoredBy: 'pre-port-code' },
      ...extra,
    });
  }

  it('fresh DB returns null and writes nothing (state A is stable)', async () => {
    const marker = await readMarker(db, APP);
    expect(marker).toBeNull();

    const docs = await markerCol().find({}).toArray();
    expect(docs).toHaveLength(0);
  });

  it('legacy-only DB upgrades on first read and converges (state B → E)', async () => {
    await seedLegacyMarker({ canonicalVersion: 7, appTag: 'pre-port' });

    const marker = await readMarker(db, APP);

    expect(marker).not.toBeNull();
    expect(marker?.storageHash).toBe('sha256:legacy-storage');
    expect(marker?.profileHash).toBe('sha256:legacy-profile');
    expect(marker?.canonicalVersion).toBe(7);
    expect(marker?.appTag).toBe('pre-port');
    expect(marker?.meta).toEqual({ authoredBy: 'pre-port-code' });

    // Convergence: canonical doc present, legacy doc gone.
    const canonical = await markerCol().findOne({ _id: APP });
    const legacy = await markerCol().findOne({ _id: 'marker' });
    expect(canonical?.['space']).toBe(APP);
    expect(canonical?.['storageHash']).toBe('sha256:legacy-storage');
    expect(legacy).toBeNull();
  });

  it('preserves invariants through the legacy upgrade', async () => {
    await seedLegacyMarker({ invariants: ['alpha', 'beta'] });

    const marker = await readMarker(db, APP);
    expect(marker?.invariants).toEqual(['alpha', 'beta']);
  });

  it('upgrade is idempotent: re-reading after upgrade returns the same record', async () => {
    await seedLegacyMarker();

    const first = await readMarker(db, APP);
    const second = await readMarker(db, APP);

    expect(second).toEqual(first);
    const docs = await markerCol().find({}).sort({ _id: 1 }).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['_id']).toBe(APP);
  });

  it('already-upgraded DB returns canonical and never touches `_id: marker` (state C is stable)', async () => {
    await initMarker(db, APP, { storageHash: 'sha256:v1', profileHash: 'sha256:p1' });

    const marker = await readMarker(db, APP);
    expect(marker?.storageHash).toBe('sha256:v1');

    const docs = await markerCol().find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['_id']).toBe(APP);
  });

  it('mid-upgrade DB (both shapes) returns canonical and sweeps legacy (state D → E)', async () => {
    // Simulates a partial-write recovery: a previous run inserted
    // canonical but was killed before deleting legacy.
    await initMarker(db, APP, { storageHash: 'sha256:canonical', profileHash: 'sha256:p1' });
    await seedLegacyMarker({ storageHash: 'sha256:stale-legacy' });

    const marker = await readMarker(db, APP);
    expect(marker?.storageHash).toBe('sha256:canonical');

    const legacy = await markerCol().findOne({ _id: 'marker' });
    expect(legacy).toBeNull();
  });

  it('concurrent first-readers on legacy DB all converge to the same canonical doc', async () => {
    await seedLegacyMarker();

    const results = await Promise.all(Array.from({ length: 8 }, () => readMarker(db, APP)));

    for (const m of results) {
      expect(m?.storageHash).toBe('sha256:legacy-storage');
      expect(m?.profileHash).toBe('sha256:legacy-profile');
    }
    const docs = await markerCol().find({}).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.['_id']).toBe(APP);
  });

  it('non-app reads ignore legacy docs (return null without touching them)', async () => {
    await seedLegacyMarker();

    const ext = await readMarker(db, EXT);
    expect(ext).toBeNull();

    // Legacy doc still around — it'll be swept on the next app-space read.
    const legacy = await markerCol().findOne({ _id: 'marker' });
    expect(legacy).not.toBeNull();
  });

  it('a doc at `_id: marker` carrying its own `space` field is treated as canonical, not legacy', async () => {
    // A hypothetical future extension whose space id happens to be
    // `'marker'` writes `{_id: 'marker', space: 'marker', ...}`. Reading
    // the app space must not interpret it as legacy and must not
    // delete it.
    await markerCol().insertOne({
      _id: 'marker',
      space: 'marker',
      storageHash: 'sha256:ext-storage',
      profileHash: 'sha256:ext-profile',
      updatedAt: new Date(),
    });

    const appMarker = await readMarker(db, APP);
    expect(appMarker).toBeNull();

    const stillThere = await markerCol().findOne({ _id: 'marker' });
    expect(stillThere?.['space']).toBe('marker');

    // The owning space can read it back through the normal path.
    const extMarker = await readMarker(db, 'marker');
    expect(extMarker?.storageHash).toBe('sha256:ext-storage');
  });

  it('aborts the upgrade with a corruption error when legacy invariants are malformed', async () => {
    await seedLegacyMarker({ invariants: 'not-an-array' });

    await expect(readMarker(db, APP)).rejects.toThrow(/Invalid marker doc.*invariants/);
    // Legacy doc remains for the operator to inspect; canonical never written.
    const canonical = await markerCol().findOne({ _id: APP });
    const legacy = await markerCol().findOne({ _id: 'marker' });
    expect(canonical).toBeNull();
    expect(legacy).not.toBeNull();
  });
});

describe('writeLedgerEntry', () => {
  it('writes a ledger entry that exists in collection, tagged with space', async () => {
    await writeLedgerEntry(db, APP, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });

    const entries = await db.collection('_prisma_migrations').find({ type: 'ledger' }).toArray();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: 'ledger',
      space: APP,
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });
    expect(entries[0]?.['appliedAt']).toBeInstanceOf(Date);
  });

  it('appends multiple ledger entries (append-only)', async () => {
    await writeLedgerEntry(db, APP, {
      edgeId: 'edge-1',
      from: 'sha256:v1',
      to: 'sha256:v2',
    });
    await writeLedgerEntry(db, APP, {
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

  it('records the same edgeId across different spaces without collision (key is (space, edgeId))', async () => {
    await writeLedgerEntry(db, APP, { edgeId: 'edge-1', from: '', to: 'sha256:v1' });
    await writeLedgerEntry(db, EXT, { edgeId: 'edge-1', from: '', to: 'sha256:v1' });

    const entries = await db
      .collection('_prisma_migrations')
      .find({ type: 'ledger' })
      .sort({ space: 1 })
      .toArray();
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e['space'])).toEqual([APP, EXT]);
  });
});
