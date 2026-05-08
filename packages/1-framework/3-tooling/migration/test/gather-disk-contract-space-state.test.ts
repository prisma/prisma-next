import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitPinnedSpaceArtefacts } from '../src/emit-pinned-space-artefacts';
import { gatherDiskContractSpaceState } from '../src/gather-disk-contract-space-state';

describe('gatherDiskContractSpaceState', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'gather-space-state-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('returns empty state for a project with no migrations directory', async () => {
    const missing = join(migrationsDir, 'no-such-dir');
    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: missing,
      loadedSpaceIds: new Set(['app']),
    });
    expect(state.pinnedDirsOnDisk).toEqual([]);
    expect(state.pinnedHashesBySpace.size).toBe(0);
  });

  it('lists pinned dirs on disk and reads pinned head refs for declared spaces', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: ['cipher:create-v1'] },
    });
    await emitPinnedSpaceArtefacts(migrationsDir, 'pgvector', {
      contract: { id: 'pgvector' },
      contractDts: '\n',
      headRef: { hash: 'sha256:pgvector', invariants: ['pgvector:install-v1'] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app', 'cipherstash', 'pgvector']),
    });

    expect([...state.pinnedDirsOnDisk]).toEqual(['cipherstash', 'pgvector']);
    expect(state.pinnedHashesBySpace.get('cipherstash')).toEqual({
      hash: 'sha256:cipher',
      invariants: ['cipher:create-v1'],
    });
    expect(state.pinnedHashesBySpace.get('pgvector')).toEqual({
      hash: 'sha256:pgvector',
      invariants: ['pgvector:install-v1'],
    });
  });

  it('omits declared spaces with no pinned dir on disk (verifier reports declaredButUnmigrated)', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: [] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app', 'cipherstash', 'pgvector']),
    });

    expect(state.pinnedHashesBySpace.has('cipherstash')).toBe(true);
    expect(state.pinnedHashesBySpace.has('pgvector')).toBe(false);
    // Pinned dir listing reflects what is on disk irrespective of declaration.
    expect([...state.pinnedDirsOnDisk]).toEqual(['cipherstash']);
  });

  it('does not read pinned hashes for the app space', async () => {
    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app']),
    });
    expect(state.pinnedHashesBySpace.has('app')).toBe(false);
  });

  it('reports orphan pinned dirs (on disk but not declared) — caller passes both lists to verifyContractSpaces', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'sha256:cipher', invariants: [] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app']),
    });

    // The directory is on disk; the helper does not filter by declaration —
    // verifyContractSpaces will surface this as orphanPinnedDir.
    expect([...state.pinnedDirsOnDisk]).toEqual(['cipherstash']);
    expect(state.pinnedHashesBySpace.has('cipherstash')).toBe(false);
  });
});
