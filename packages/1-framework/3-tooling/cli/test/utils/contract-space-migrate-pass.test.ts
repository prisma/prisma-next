import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractSpaceMigratePass } from '../../src/utils/contract-space-migrate-pass';

const HASH_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('runContractSpaceMigratePass', () => {
  let migrationsDir: string | undefined;
  const requireDir = (): string => {
    if (migrationsDir === undefined) {
      throw new Error('migrationsDir was not initialised by beforeEach');
    }
    return migrationsDir;
  };

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-migrate-'));
  });

  afterEach(async () => {
    if (migrationsDir !== undefined) {
      await rm(migrationsDir, { recursive: true, force: true });
      migrationsDir = undefined;
    }
  });

  it('emits on-disk artefacts for a contract-space-bearing extension', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir: requireDir(),
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
          },
        },
      ],
    });

    expect(out.emittedSpaceIds).toEqual(['cipherstash']);

    const headJson = JSON.parse(
      await readFile(join(requireDir(), 'cipherstash', 'refs', 'head.json'), 'utf-8'),
    );
    expect(headJson.hash).toBe(HASH_A);
    const dts = await readFile(join(requireDir(), 'cipherstash', 'contract.d.ts'), 'utf-8');
    expect(dts).toContain('@ts-nocheck');
  });

  it('refreshes the on-disk head hash when the descriptor diverges from the prior pin', async () => {
    await emitContractSpaceArtefacts(requireDir(), 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    await runContractSpaceMigratePass({
      migrationsDir: requireDir(),
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 2 },
            headRef: { hash: HASH_B, invariants: [] },
          },
        },
      ],
    });

    const headJson = JSON.parse(
      await readFile(join(requireDir(), 'cipherstash', 'refs', 'head.json'), 'utf-8'),
    );
    expect(headJson.hash).toBe(HASH_B);
  });

  it('skips extensions without contractSpace (codec-only extensions)', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir: requireDir(),
      extensionPacks: [{ id: 'codec-only' }],
    });
    expect(out.emittedSpaceIds).toEqual([]);
  });

  it('processes multiple extension spaces in a single pass', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir: requireDir(),
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
          },
        },
        {
          id: 'audit',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_B, invariants: ['ix1'] },
          },
        },
      ],
    });

    expect([...out.emittedSpaceIds].sort()).toEqual(['audit', 'cipherstash']);
  });
});
