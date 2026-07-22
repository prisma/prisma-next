import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emitContractSpaceArtefacts } from '../src/emit-contract-space-artefacts';
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
    expect(state.spaceDirsOnDisk).toEqual([]);
    expect(state.headRefsBySpace.size).toBe(0);
  });

  it('lists contract-space dirs on disk and reads on-disk head refs for declared spaces', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'cipher', invariants: ['cipher:create-v1'] },
    });
    await emitContractSpaceArtefacts(migrationsDir, 'pgvector', {
      contract: { id: 'pgvector' },
      contractDts: '\n',
      headRef: { hash: 'pgvector', invariants: ['pgvector:install-v1'] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app', 'cipherstash', 'pgvector']),
    });

    expect([...state.spaceDirsOnDisk]).toEqual(['cipherstash', 'pgvector']);
    expect(state.headRefsBySpace.get('cipherstash')).toEqual({
      hash: 'cipher',
      invariants: ['cipher:create-v1'],
    });
    expect(state.headRefsBySpace.get('pgvector')).toEqual({
      hash: 'pgvector',
      invariants: ['pgvector:install-v1'],
    });
  });

  it('omits declared spaces with no contract-space dir on disk (verifier reports declaredButUnmigrated)', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'cipher', invariants: [] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app', 'cipherstash', 'pgvector']),
    });

    expect(state.headRefsBySpace.has('cipherstash')).toBe(true);
    expect(state.headRefsBySpace.has('pgvector')).toBe(false);
    // Contract-space dir listing reflects what is on disk irrespective of declaration.
    expect([...state.spaceDirsOnDisk]).toEqual(['cipherstash']);
  });

  it('does not read on-disk head hashes for the app space', async () => {
    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app']),
    });
    expect(state.headRefsBySpace.has('app')).toBe(false);
  });

  it('reports orphan contract-space dirs (on disk but not declared) — caller passes both lists to verifyContractSpaces', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { id: 'cipher' },
      contractDts: '\n',
      headRef: { hash: 'cipher', invariants: [] },
    });

    const state = await gatherDiskContractSpaceState({
      projectMigrationsDir: migrationsDir,
      loadedSpaceIds: new Set(['app']),
    });

    // The directory is on disk; the helper does not filter by declaration —
    // verifyContractSpaces will surface this as orphanSpaceDir.
    expect([...state.spaceDirsOnDisk]).toEqual(['cipherstash']);
    expect(state.headRefsBySpace.has('cipherstash')).toBe(false);
  });
});
