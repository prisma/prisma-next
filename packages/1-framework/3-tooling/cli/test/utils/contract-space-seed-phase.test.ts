import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import {
  emitContractSpaceArtefacts,
  readContractSpaceHeadRef,
  spaceMigrationDirectory,
} from '@prisma-next/migration-tools/spaces';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DescriptorMigrationPackage,
  runContractSpaceSeedPhase,
} from '../../src/utils/contract-space-seed-phase';

const HASH_A = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

function makeMetadata(args: {
  readonly from: string | null;
  readonly to: string;
}): MigrationMetadata {
  return {
    from: args.from,
    to: args.to,
    migrationHash: `mh:${args.to}`,
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePkg(
  dirName: string,
  fromTo: { from: string | null; to: string },
): DescriptorMigrationPackage {
  return {
    dirName,
    metadata: makeMetadata(fromTo),
    ops: [],
  };
}

describe('runContractSpaceSeedPhase', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-seed-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('emits on-disk artefacts on first emit and reports action=updated', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.spaceId).toBe('cipherstash');
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBeNull();
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual([]);

    const head = await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    expect(head?.hash).toBe(HASH_A);
  });

  it('reports action=unchanged on idempotent re-pin', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.action).toBe('unchanged');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual([]);
  });

  it('always re-emits artefacts even when descriptor hash matches on-disk head', async () => {
    // Pre-write artefacts with stale `.d.ts` placeholder that our seed
    // helper will overwrite. The framework owns these files; re-emit is
    // the contract.
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '// stale placeholder\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    const dts = await readFile(join(migrationsDir, 'cipherstash', 'contract.d.ts'), 'utf-8');
    // Placeholder dts is a self-contained `export {};` module — no
    // TypeScript suppressions (repo bans `@ts-nocheck`).
    expect(dts).not.toContain('@ts-nocheck');
    expect(dts).toContain('export {};');
    expect(dts).not.toContain('stale placeholder');
  });

  it('reports action=updated when descriptor hash differs from on-disk head', async () => {
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 2 },
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded).toHaveLength(1);
    const record = out.seeded[0]!;
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_B);

    const head = await readContractSpaceHeadRef(migrationsDir, 'cipherstash');
    expect(head?.hash).toBe(HASH_B);
  });

  it('materialises every descriptor-shipped migration package not yet on disk', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: HASH_A })],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.newMigrationDirs).toEqual(['20260101T0000_init']);

    const manifest = JSON.parse(
      await readFile(
        join(
          spaceMigrationDirectory(migrationsDir, 'cipherstash'),
          '20260101T0000_init',
          'migration.json',
        ),
        'utf-8',
      ),
    );
    expect(manifest.to).toBe(HASH_A);
  });

  it('skips packages already on disk and only emits the missing ones', async () => {
    // Pre-existing first migration.
    const existingDir = join(migrationsDir, 'cipherstash', '20260101T0000_init');
    await mkdir(existingDir, { recursive: true });
    await writeFile(join(existingDir, 'migration.json'), '{}');

    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [
              makePkg('20260101T0000_init', { from: null, to: HASH_A }),
              makePkg('20260201T0000_bump', { from: HASH_A, to: HASH_B }),
            ],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.newMigrationDirs).toEqual(['20260201T0000_bump']);
    // Pre-existing manifest is left untouched.
    const manifest = await readFile(join(existingDir, 'migration.json'), 'utf-8');
    expect(manifest).toBe('{}');
  });

  it('reports action=updated when artefacts unchanged but new migration packages were materialised', async () => {
    // Pre-emit artefacts at HASH_A so on-disk head matches descriptor.
    await emitContractSpaceArtefacts(migrationsDir, 'cipherstash', {
      contract: { v: 1 },
      contractDts: '\n',
      headRef: { hash: HASH_A, invariants: [] },
    });
    // Descriptor ships a migration package not yet on disk.
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: HASH_A })],
          },
        },
      ],
    });

    const record = out.seeded[0]!;
    expect(record.action).toBe('updated');
    expect(record.priorHash).toBe(HASH_A);
    expect(record.newHash).toBe(HASH_A);
    expect(record.newMigrationDirs).toEqual(['20260101T0000_init']);
  });

  it('skips extensions without a contractSpace (codec-only packs)', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [{ id: 'codec-only' }],
    });
    expect(out.seeded).toEqual([]);
  });

  it('orders per-space output deterministically (alphabetical by spaceId)', async () => {
    const out = await runContractSpaceSeedPhase({
      migrationsDir,
      extensionPacks: [
        {
          id: 'zeta',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_A, invariants: [] },
            migrations: [],
          },
        },
        {
          id: 'alpha',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: HASH_B, invariants: [] },
            migrations: [],
          },
        },
      ],
    });

    expect(out.seeded.map((r) => r.spaceId)).toEqual(['alpha', 'zeta']);
  });
});
