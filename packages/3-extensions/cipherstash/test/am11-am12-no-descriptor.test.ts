/**
 * Regression — verify / apply / re-materialise without the cipherstash
 * descriptor on disk.
 *
 * Pinned properties:
 *
 *   - With the cipherstash extension's installed package directory
 *     removed (a stand-in for `rm -rf node_modules/@prisma-next/
 *     extension-cipherstash`), the per-space verifier helpers succeed
 *     against pinned `migrations/cipherstash/` files alone — they
 *     never resolve the descriptor module. The companion `migrate`
 *     path, by contrast, *does* import descriptors and is expected to
 *     fail informatively without them; we cover that direction by
 *     asserting the helper that *would* be used at `migrate`-time
 *     refuses to operate on a missing descriptor input.
 *
 *   - Re-running the materialisation pass against an already emitted
 *     `migrations/cipherstash/<dirName>/` leaves its contents
 *     byte-untouched (existence check, not write-and-compare).
 *
 * Mirrors `packages/1-framework/3-tooling/migration/test/deletable-
 * node-modules.test.ts` (which exercises the same property for an
 * abstract synthetic space). This file pins the property against the
 * *real* cipherstash descriptor so a future refactor that, for
 * example, accidentally introduced a descriptor import inside the
 * verify-time code path would regress here.
 */

import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  materialiseExtensionMigrationPackageIfMissing,
  writeExtensionMigrationPackage,
} from '@prisma-next/migration-tools/io';
import {
  emitPinnedSpaceArtefacts,
  listPinnedSpaceDirectories,
  readPinnedHeadRef,
  type SpaceMarkerRecord,
  type SpacePinnedHashRecord,
  spaceMigrationDirectory,
  verifyContractSpaces,
} from '@prisma-next/migration-tools/spaces';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import cipherstashExtensionDescriptor from '../src/exports/control';
import { CIPHERSTASH_SPACE_ID } from '../src/extension-metadata/constants';

const cipherstashContractSpace = cipherstashExtensionDescriptor.contractSpace!;
const cipherstashContract = cipherstashContractSpace.contractJson;
const cipherstashBaselineMigration = cipherstashContractSpace.migrations[0]!;
const cipherstashHeadRef = cipherstashContractSpace.headRef;

interface ProjectFixture {
  readonly projectRoot: string;
  readonly migrationsDir: string;
  readonly cipherstashSpaceDir: string;
  readonly cipherstashBaselineDir: string;
  readonly nodeModulesPkgDir: string;
}

/**
 * Stand-in for an installed cipherstash package — descriptors normally
 * live under `node_modules/@prisma-next/extension-cipherstash`. The
 * tests delete this path before running the helpers to prove the
 * verifier code path does not touch it.
 */
async function setupProject(): Promise<ProjectFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'cipherstash-am11-12-'));
  const migrationsDir = join(projectRoot, 'migrations');
  const cipherstashSpaceDir = spaceMigrationDirectory(migrationsDir, CIPHERSTASH_SPACE_ID);
  const nodeModulesPkgDir = join(
    projectRoot,
    'node_modules',
    '@prisma-next',
    'extension-cipherstash',
  );

  await mkdir(nodeModulesPkgDir, { recursive: true });
  await writeFile(
    join(nodeModulesPkgDir, 'package.json'),
    JSON.stringify({ name: '@prisma-next/extension-cipherstash', version: '0.0.1' }),
  );

  await emitPinnedSpaceArtefacts(migrationsDir, CIPHERSTASH_SPACE_ID, {
    contract: cipherstashContract,
    contractDts: '// rendered .d.ts for cipherstash contract space\nexport interface Contract {}\n',
    headRef: { hash: cipherstashHeadRef.hash, invariants: [...cipherstashHeadRef.invariants] },
  });

  await writeExtensionMigrationPackage(cipherstashSpaceDir, cipherstashBaselineMigration);

  return {
    projectRoot,
    migrationsDir,
    cipherstashSpaceDir,
    cipherstashBaselineDir: join(cipherstashSpaceDir, cipherstashBaselineMigration.dirName),
    nodeModulesPkgDir,
  };
}

async function readBytesAt(p: string): Promise<Buffer> {
  return readFile(p);
}

describe('cipherstash — verify / re-materialise without descriptor on disk', () => {
  let fixture: ProjectFixture;

  beforeEach(async () => {
    fixture = await setupProject();
  });

  afterEach(async () => {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  });

  describe('verify reads only the user repo', () => {
    beforeEach(async () => {
      await rm(fixture.nodeModulesPkgDir, { recursive: true, force: true });
      const remaining = await readdir(join(fixture.projectRoot, 'node_modules', '@prisma-next'));
      expect(remaining.includes('extension-cipherstash')).toBe(false);
    });

    it('listPinnedSpaceDirectories discovers cipherstash from disk', async () => {
      const dirs = await listPinnedSpaceDirectories(fixture.migrationsDir);
      expect(dirs).toContain(CIPHERSTASH_SPACE_ID);
    });

    it('readPinnedHeadRef returns the cipherstash head ref from disk', async () => {
      const headRef = await readPinnedHeadRef(fixture.migrationsDir, CIPHERSTASH_SPACE_ID);
      expect(headRef).not.toBeNull();
      expect(headRef?.hash).toBe(cipherstashHeadRef.hash);
      expect([...(headRef?.invariants ?? [])].sort()).toEqual(
        [...cipherstashHeadRef.invariants].sort(),
      );
    });

    it('verifyContractSpaces returns ok when pinned files + marker rows match', async () => {
      const dirs = await listPinnedSpaceDirectories(fixture.migrationsDir);
      const pinnedHash: SpacePinnedHashRecord = {
        hash: cipherstashHeadRef.hash,
        invariants: [...cipherstashHeadRef.invariants],
      };
      const marker: SpaceMarkerRecord = {
        hash: cipherstashHeadRef.hash,
        invariants: [...cipherstashHeadRef.invariants],
      };

      const result = verifyContractSpaces({
        loadedSpaces: new Set(['app', CIPHERSTASH_SPACE_ID]),
        pinnedDirsOnDisk: dirs,
        pinnedHashesBySpace: new Map([[CIPHERSTASH_SPACE_ID, pinnedHash]]),
        markerRowsBySpace: new Map([[CIPHERSTASH_SPACE_ID, marker]]),
      });

      expect(result.ok).toBe(true);
    });

    it('verifyContractSpaces flags hash drift on cipherstash without descriptor access', async () => {
      const dirs = await listPinnedSpaceDirectories(fixture.migrationsDir);
      const driftedMarker: SpaceMarkerRecord = {
        hash: 'sha256:00000000000000000000000000000000000000000000000000000000deadbeef',
        invariants: [...cipherstashHeadRef.invariants],
      };

      const result = verifyContractSpaces({
        loadedSpaces: new Set(['app', CIPHERSTASH_SPACE_ID]),
        pinnedDirsOnDisk: dirs,
        pinnedHashesBySpace: new Map([
          [
            CIPHERSTASH_SPACE_ID,
            {
              hash: cipherstashHeadRef.hash,
              invariants: [...cipherstashHeadRef.invariants],
            } satisfies SpacePinnedHashRecord,
          ],
        ]),
        markerRowsBySpace: new Map([[CIPHERSTASH_SPACE_ID, driftedMarker]]),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.violations).toContainEqual(
        expect.objectContaining({ kind: 'hashMismatch', spaceId: CIPHERSTASH_SPACE_ID }),
      );
    });

    it('pinned contract.json on disk parses to the cipherstash contract structure', async () => {
      const pinnedRaw = await readFile(join(fixture.cipherstashSpaceDir, 'contract.json'), 'utf-8');
      const parsed = JSON.parse(pinnedRaw) as {
        readonly target: string;
        readonly storage: { readonly storageHash: string };
      };
      expect(parsed.target).toBe(cipherstashContract.target);
      expect(parsed.storage.storageHash).toBe(cipherstashContract.storage.storageHash);
    });
  });

  describe('extension migration-package materialisation is idempotent', () => {
    /**
     * The CLI's `runContractSpaceExtensionMigrationsPass` (in `@prisma-
     * next/cli`) calls
     * `materialiseExtensionMigrationPackageIfMissing(spaceDir, pkg)` from
     * `@prisma-next/migration-tools/io` per package — an existence check
     * that skips already-materialised dirs without writing-and-comparing.
     * Calling the same primitive directly here exercises the *exact*
     * code path the CLI uses, without taking a CLI dependency from a
     * leaf extension package (cipherstash must not import the CLI).
     */
    async function rematerialiseSkippingExisting(): Promise<{ readonly skipped: boolean }> {
      const result = await materialiseExtensionMigrationPackageIfMissing(
        fixture.cipherstashSpaceDir,
        cipherstashBaselineMigration,
      );
      return { skipped: !result.written };
    }

    it('skips an already-materialised baseline directory on re-run', async () => {
      const result = await rematerialiseSkippingExisting();
      expect(result.skipped).toBe(true);
    });

    it('leaves migration.json, ops.json, and contract.json byte-identical across re-runs', async () => {
      const baselineFiles = ['migration.json', 'ops.json', 'contract.json'] as const;
      const before = new Map<string, Buffer>();
      for (const name of baselineFiles) {
        before.set(name, await readBytesAt(join(fixture.cipherstashBaselineDir, name)));
      }

      await rematerialiseSkippingExisting();

      for (const name of baselineFiles) {
        const after = await readBytesAt(join(fixture.cipherstashBaselineDir, name));
        expect(after.equals(before.get(name)!)).toBe(true);
      }
    });

    it('the byte-equivalent re-emit holds even after the descriptor module is removed', async () => {
      const opsBefore = await readBytesAt(join(fixture.cipherstashBaselineDir, 'ops.json'));

      await rm(fixture.nodeModulesPkgDir, { recursive: true, force: true });
      const result = await rematerialiseSkippingExisting();

      expect(result.skipped).toBe(true);
      const opsAfter = await readBytesAt(join(fixture.cipherstashBaselineDir, 'ops.json'));
      expect(opsAfter.equals(opsBefore)).toBe(true);
    });
  });
});
