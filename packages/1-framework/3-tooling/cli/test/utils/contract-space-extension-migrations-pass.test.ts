import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import type { MigrationPackage } from '@prisma-next/migration-tools/package';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runContractSpaceExtensionMigrationsPass } from '../../src/utils/contract-space-extension-migrations-pass';

function makeMetadata(args: {
  readonly from: string | null;
  readonly to: string;
}): MigrationMetadata {
  return {
    from: args.from,
    to: args.to,
    migrationHash: `mh:${args.to}`,
    fromContract: args.from === null ? null : ({ storage: { v: 'prior' } } as unknown as Contract),
    toContract: { storage: { v: args.to } } as unknown as Contract,
    hints: { used: [], applied: [], plannerVersion: '2.0.0' },
    labels: [],
    providedInvariants: [],
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function makePkg(dirName: string, fromTo: { from: string | null; to: string }): MigrationPackage {
  return {
    dirName,
    dirPath: dirName,
    metadata: makeMetadata(fromTo),
    ops: [],
  };
}

describe('runContractSpaceExtensionMigrationsPass', () => {
  let migrationsDir: string;

  beforeEach(async () => {
    migrationsDir = await mkdtemp(join(tmpdir(), 'cli-cs-extmig-'));
  });

  afterEach(async () => {
    await rm(migrationsDir, { recursive: true, force: true });
  });

  it('writes every descriptor-shipped migration when none exist on disk', async () => {
    const out = await runContractSpaceExtensionMigrationsPass({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: 'h', invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: 'h' })],
          },
        },
      ],
    });

    expect(out.emitted).toEqual([{ spaceId: 'cipherstash', dirName: '20260101T0000_init' }]);
    expect(out.skipped).toEqual([]);

    const manifest = JSON.parse(
      await readFile(
        join(migrationsDir, 'cipherstash', '20260101T0000_init', 'migration.json'),
        'utf-8',
      ),
    );
    expect(manifest.to).toBe('h');
  });

  it('skips packages that already exist on disk (idempotent — locks AC-7)', async () => {
    const existingDir = join(migrationsDir, 'cipherstash', '20260101T0000_init');
    await mkdir(existingDir, { recursive: true });
    await writeFile(join(existingDir, 'migration.json'), '{}');

    const out = await runContractSpaceExtensionMigrationsPass({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: 'h', invariants: [] },
            migrations: [makePkg('20260101T0000_init', { from: null, to: 'h' })],
          },
        },
      ],
    });

    expect(out.emitted).toEqual([]);
    expect(out.skipped).toEqual([{ spaceId: 'cipherstash', dirName: '20260101T0000_init' }]);

    // Pre-existing manifest content must not be overwritten.
    const manifest = await readFile(join(existingDir, 'migration.json'), 'utf-8');
    expect(manifest).toBe('{}');
  });

  it('emits only the missing packages when partial materialisation exists', async () => {
    const existingDir = join(migrationsDir, 'cipherstash', '20260101T0000_init');
    await mkdir(existingDir, { recursive: true });
    await writeFile(join(existingDir, 'migration.json'), '{}');

    const out = await runContractSpaceExtensionMigrationsPass({
      migrationsDir,
      extensionPacks: [
        {
          id: 'cipherstash',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: 'h2', invariants: [] },
            migrations: [
              makePkg('20260101T0000_init', { from: null, to: 'h1' }),
              makePkg('20260201T0000_bump', { from: 'h1', to: 'h2' }),
            ],
          },
        },
      ],
    });

    expect(out.emitted).toEqual([{ spaceId: 'cipherstash', dirName: '20260201T0000_bump' }]);
    expect(out.skipped).toEqual([{ spaceId: 'cipherstash', dirName: '20260101T0000_init' }]);
  });

  it('skips extensions without contractSpace (codec-only packs)', async () => {
    const out = await runContractSpaceExtensionMigrationsPass({
      migrationsDir,
      extensionPacks: [{ id: 'codec-only' }],
    });
    expect(out.emitted).toEqual([]);
    expect(out.skipped).toEqual([]);
  });

  it('processes multiple spaces deterministically (alphabetical via planAllSpaces)', async () => {
    const out = await runContractSpaceExtensionMigrationsPass({
      migrationsDir,
      extensionPacks: [
        {
          id: 'zeta',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: 'z', invariants: [] },
            migrations: [makePkg('20260101T0000_z', { from: null, to: 'z' })],
          },
        },
        {
          id: 'alpha',
          contractSpace: {
            contractJson: { v: 1 },
            headRef: { hash: 'a', invariants: [] },
            migrations: [makePkg('20260101T0000_a', { from: null, to: 'a' })],
          },
        },
      ],
    });

    expect(out.emitted.map((e) => e.spaceId)).toEqual(['alpha', 'zeta']);
  });

  it('throws MIGRATION.DUPLICATE_SPACE_ID when two extensions claim the same space id', async () => {
    await expect(
      runContractSpaceExtensionMigrationsPass({
        migrationsDir,
        extensionPacks: [
          {
            id: 'shared',
            contractSpace: {
              contractJson: { v: 1 },
              headRef: { hash: 'a', invariants: [] },
              migrations: [],
            },
          },
          {
            id: 'shared',
            contractSpace: {
              contractJson: { v: 1 },
              headRef: { hash: 'b', invariants: [] },
              migrations: [],
            },
          },
        ],
      }),
    ).rejects.toThrow(/[Dd]uplicate.*space/);
  });
});
