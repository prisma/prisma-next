import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { emitPinnedSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatContractSpaceDriftWarning,
  runContractSpaceMigratePass,
} from '../../src/utils/contract-space-migrate-pass';

const HASH_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('runContractSpaceMigratePass', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-migrate-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('emits pinned artefacts on first emit and reports kind=firstEmit', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir,
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
    expect(out.drifts.map((d) => d.kind)).toEqual(['firstEmit']);

    const headJson = JSON.parse(
      await readFile(join(migrationsDir, 'cipherstash', 'refs', 'head.json'), 'utf-8'),
    );
    expect(headJson.hash).toBe(HASH_A);
    const dts = await readFile(join(migrationsDir, 'cipherstash', 'contract.d.ts'), 'utf-8');
    expect(dts).toContain('@ts-nocheck');
  });

  it('reports kind=noDrift when descriptor matches pinned (idempotent re-pin)', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceMigratePass({
      migrationsDir,
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

    expect(out.drifts.map((d) => d.kind)).toEqual(['noDrift']);
  });

  it('reports kind=drift when descriptor hash diverges from pinned', async () => {
    await emitPinnedSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceMigratePass({
      migrationsDir,
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

    expect(out.drifts.map((d) => d.kind)).toEqual(['drift']);
    const drift = out.drifts[0];
    if (drift && drift.kind === 'drift') {
      const warning = formatContractSpaceDriftWarning(drift);
      expect(warning).toContain('cipherstash');
      expect(warning).toContain(HASH_A);
      expect(warning).toContain(HASH_B);
    }

    // Pinned hash on disk is refreshed to descriptor hash.
    const headJson = JSON.parse(
      await readFile(join(migrationsDir, 'cipherstash', 'refs', 'head.json'), 'utf-8'),
    );
    expect(headJson.hash).toBe(HASH_B);
  });

  it('skips extensions without contractSpace (codec-only extensions)', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir,
      extensionPacks: [{ id: 'codec-only' }],
    });
    expect(out.emittedSpaceIds).toEqual([]);
    expect(out.drifts).toEqual([]);
  });

  it('processes multiple extension spaces in a single pass', async () => {
    const out = await runContractSpaceMigratePass({
      migrationsDir,
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
    expect(out.drifts.length).toBe(2);
  });
});

describe('formatContractSpaceDriftWarning', () => {
  it('throws if called with a non-drift result (caller guard)', () => {
    expect(() =>
      formatContractSpaceDriftWarning({
        kind: 'noDrift',
        spaceId: 'x',
        descriptorHash: HASH_A,
        pinnedHash: HASH_A,
      }),
    ).toThrow();
  });
});
