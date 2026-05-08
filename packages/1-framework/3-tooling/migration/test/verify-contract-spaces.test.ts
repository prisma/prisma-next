import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listPinnedSpaceDirectories,
  type SpaceMarkerRecord,
  type SpacePinnedHashRecord,
  verifyContractSpaces,
} from '../src/verify-contract-spaces';

describe('listPinnedSpaceDirectories', () => {
  let projectMigrationsDir: string;

  async function makeMigrationDir(name: string): Promise<void> {
    await mkdir(join(projectMigrationsDir, name), { recursive: true });
    await writeFile(join(projectMigrationsDir, name, 'migration.json'), '{}');
  }

  async function makePinnedSpaceDir(name: string): Promise<void> {
    await mkdir(join(projectMigrationsDir, name), { recursive: true });
  }

  beforeEach(async () => {
    projectMigrationsDir = await mkdtemp(join(tmpdir(), 'list-pinned-'));
  });

  afterEach(async () => {
    await rm(projectMigrationsDir, { recursive: true, force: true });
  });

  it('returns an empty list when the migrations directory does not exist', async () => {
    const missing = join(projectMigrationsDir, 'does-not-exist');
    expect(await listPinnedSpaceDirectories(missing)).toEqual([]);
  });

  it('excludes timestamp-shaped migration directories that contain migration.json', async () => {
    await makeMigrationDir('20260101T0000_baseline');
    await makeMigrationDir('20260507T1100_add_users');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual([]);
  });

  it('excludes a space-id-shaped directory when it contains migration.json', async () => {
    // The directory name happens to look like a space id, but the
    // presence of `migration.json` is the structural marker — users may
    // freely name their migration directories.
    await makeMigrationDir('cipherstash');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual([]);
  });

  it('includes a timestamp-shaped directory with no migration.json (verifier no longer trusts the name)', async () => {
    await makePinnedSpaceDir('20260101T0000_baseline');
    await makePinnedSpaceDir('cipherstash');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual([
      '20260101T0000_baseline',
      'cipherstash',
    ]);
  });

  it('returns extension-space subdirectories sorted alphabetically', async () => {
    await makePinnedSpaceDir('pgvector');
    await makePinnedSpaceDir('cipherstash');
    await makePinnedSpaceDir('audit');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual([
      'audit',
      'cipherstash',
      'pgvector',
    ]);
  });

  it('returns pinned-space dirs alongside skipping migration dirs', async () => {
    await makeMigrationDir('20260101T0000_baseline');
    await makePinnedSpaceDir('cipherstash');
    await makeMigrationDir('20260507T1100_add_users');
    await makePinnedSpaceDir('pgvector');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual([
      'cipherstash',
      'pgvector',
    ]);
  });

  it('skips files (only directory entries are reported)', async () => {
    await writeFile(join(projectMigrationsDir, 'cipherstash'), 'i am a file');
    await makePinnedSpaceDir('pgvector');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual(['pgvector']);
  });

  it('skips dot-prefixed directories', async () => {
    await mkdir(join(projectMigrationsDir, '.git'));
    await mkdir(join(projectMigrationsDir, '.tmp'));
    await makePinnedSpaceDir('cipherstash');

    expect(await listPinnedSpaceDirectories(projectMigrationsDir)).toEqual(['cipherstash']);
  });
});

describe('verifyContractSpaces', () => {
  const cipherstashPinned: SpacePinnedHashRecord = {
    hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000001',
    invariants: ['cipherstash:install-v1'],
  };
  const pgvectorPinned: SpacePinnedHashRecord = {
    hash: 'sha256:0000000000000000000000000000000000000000000000000000000000000002',
    invariants: ['pgvector:install-v1'],
  };

  const markerOf = (pinned: SpacePinnedHashRecord): SpaceMarkerRecord => ({
    hash: pinned.hash,
    invariants: [...pinned.invariants],
  });

  it("returns ok for today's single-app project (no extensions, no extra dirs, no extra markers)", () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app']),
      pinnedDirsOnDisk: [],
      pinnedHashesBySpace: new Map(),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(true);
  });

  it('returns ok when loadedSpaces match pinned dirs and marker rows exactly', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: ['cipherstash'],
      pinnedHashesBySpace: new Map([['cipherstash', cipherstashPinned]]),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashPinned)]]),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects when extensionPacks declares a space without a pinned dir on disk (declaredButUnmigrated)', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: [],
      pinnedHashesBySpace: new Map(),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'declaredButUnmigrated',
      spaceId: 'cipherstash',
    });
  });

  it('rejects when a pinned dir on disk is not in extensionPacks (orphanPinnedDir)', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app']),
      pinnedDirsOnDisk: ['cipherstash'],
      pinnedHashesBySpace: new Map([['cipherstash', cipherstashPinned]]),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'orphanPinnedDir',
      spaceId: 'cipherstash',
    });
  });

  it('rejects when a marker row exists for a space not in extensionPacks (orphanMarker)', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app']),
      pinnedDirsOnDisk: [],
      pinnedHashesBySpace: new Map(),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashPinned)]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toMatchObject({
      kind: 'orphanMarker',
      spaceId: 'cipherstash',
    });
  });

  it('rejects when marker hash does not match pinned hash for a loaded space (hashMismatch)', () => {
    const driftedMarker: SpaceMarkerRecord = {
      hash: 'sha256:00000000000000000000000000000000000000000000000000000000000000ff',
      invariants: cipherstashPinned.invariants,
    };
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: ['cipherstash'],
      pinnedHashesBySpace: new Map([['cipherstash', cipherstashPinned]]),
      markerRowsBySpace: new Map([['cipherstash', driftedMarker]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'hashMismatch',
        spaceId: 'cipherstash',
        pinnedHash: cipherstashPinned.hash,
        markerHash: driftedMarker.hash,
      }),
    );
  });

  it("rejects when marker invariants don't cover pinned invariants (invariantsMismatch)", () => {
    const partialMarker: SpaceMarkerRecord = {
      hash: cipherstashPinned.hash,
      invariants: [],
    };
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: ['cipherstash'],
      pinnedHashesBySpace: new Map([['cipherstash', cipherstashPinned]]),
      markerRowsBySpace: new Map([['cipherstash', partialMarker]]),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'invariantsMismatch',
        spaceId: 'cipherstash',
      }),
    );
  });

  it('aggregates multiple violations across spaces deterministically (alphabetical by spaceId)', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: ['orphan-z', 'orphan-a'],
      pinnedHashesBySpace: new Map([
        ['orphan-a', cipherstashPinned],
        ['orphan-z', pgvectorPinned],
      ]),
      markerRowsBySpace: new Map([
        ['orphan-marker-1', markerOf(cipherstashPinned)],
        ['orphan-marker-2', markerOf(pgvectorPinned)],
      ]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const kindsAndIds = result.violations.map((v) => `${v.kind}:${v.spaceId}`);
    expect(kindsAndIds).toEqual([
      'declaredButUnmigrated:cipherstash',
      'orphanMarker:orphan-marker-1',
      'orphanMarker:orphan-marker-2',
      'orphanPinnedDir:orphan-a',
      'orphanPinnedDir:orphan-z',
    ]);
  });

  it('every violation includes a remediation hint', () => {
    const driftedMarker: SpaceMarkerRecord = {
      hash: 'sha256:00000000000000000000000000000000000000000000000000000000000000ff',
      invariants: [],
    };
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'pgvector']),
      pinnedDirsOnDisk: ['orphan'],
      pinnedHashesBySpace: new Map([['orphan', cipherstashPinned]]),
      markerRowsBySpace: new Map([
        ['ghost', markerOf(cipherstashPinned)],
        ['pgvector', driftedMarker],
      ]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    for (const v of result.violations) {
      expect(typeof v.remediation).toBe('string');
      expect(v.remediation.length).toBeGreaterThan(0);
    }
  });

  it("treats 'app' marker rows as expected (app is always loaded)", () => {
    const appMarker: SpaceMarkerRecord = {
      hash: 'sha256:dead',
      invariants: [],
    };
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app']),
      pinnedDirsOnDisk: [],
      pinnedHashesBySpace: new Map(),
      markerRowsBySpace: new Map([['app', appMarker]]),
    });
    expect(result.ok).toBe(true);
  });

  it('does not flag a missing app-space pinned dir (app pinning lives at the project root, not under migrations/)', () => {
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app']),
      pinnedDirsOnDisk: [],
      pinnedHashesBySpace: new Map(),
      markerRowsBySpace: new Map(),
    });
    expect(result.ok).toBe(true);
  });

  it('does not import any extension descriptor (verifier reads only its inputs)', () => {
    // Smoke check: the function must work with a brand-new Map / Set
    // and return a plain Result. No descriptor module required by the
    // call itself — the inputs are pre-resolved by the caller.
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', 'cipherstash']),
      pinnedDirsOnDisk: ['cipherstash'],
      pinnedHashesBySpace: new Map([['cipherstash', cipherstashPinned]]),
      markerRowsBySpace: new Map([['cipherstash', markerOf(cipherstashPinned)]]),
    });
    expect(result.ok).toBe(true);
  });
});
