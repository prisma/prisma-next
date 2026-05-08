/**
 * "Deletable `node_modules`" fixture for AC-15 / TC-26.
 *
 * Locks in the property that the per-space verifier and runner **read
 * only the user's repo** — pinned `contract.json` / `contract.d.ts` /
 * `refs/head.json` files under `migrations/<space-id>/` plus the live
 * marker rows. Neither helper imports the extension descriptor module,
 * so the absence of `node_modules` (or any other path that resolves the
 * descriptor) does not affect verify / apply outcomes.
 *
 * Scoped to the framework helpers shipped in this round
 * (`emitPinnedSpaceArtefacts` + `listPinnedSpaceDirectories` +
 * `verifyContractSpaces` + `concatenateSpaceApplyInputs`). The test
 * intentionally **does not import** the synthetic
 * `@prisma-next/extension-test-contract-space` package — that is the
 * point. The test invents a `'test-contract-space'` space id inline
 * and runs the helpers against pinned files on disk plus a fake set of
 * marker rows.
 *
 * @see docs/architecture docs/adrs/ADR 211 - Contract spaces.md
 *   — "Pinned per-space artefacts" / verifier reads only the user repo.
 */

import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalizeJson } from '../src/canonicalize-json';
import {
  concatenateSpaceApplyInputs,
  emitPinnedSpaceArtefacts,
  listPinnedSpaceDirectories,
  type SpaceApplyInput,
  type SpaceMarkerRecord,
  type SpacePinnedHashRecord,
  verifyContractSpaces,
} from '../src/exports/spaces';

const TEST_SPACE_ID = 'test-contract-space';
const TEST_HEAD_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000abc';
const TEST_INVARIANT = 'test-contract-space:create-test_box-v1';

const testContract = {
  storageHash: TEST_HEAD_HASH,
  tables: { test_box: { columns: { x: 'int', y: 'int' } } },
};
const testContractDts =
  '// rendered .d.ts for the test contract space\nexport interface Contract {}\n';

interface ProjectFixture {
  readonly projectRoot: string;
  readonly projectMigrationsDir: string;
  readonly nodeModulesPath: string;
}

async function setupProjectWithPinnedTestSpace(): Promise<ProjectFixture> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'no-descriptor-'));
  const projectMigrationsDir = join(projectRoot, 'migrations');
  const nodeModulesPath = join(projectRoot, 'node_modules');

  // Stand-in for an installed extension package — the descriptor module
  // would normally live under `node_modules/<pkg>/...`. The test deletes
  // this directory before invoking the verifier to model the AC-15 case
  // ("verifier + runner succeed when extension descriptor not
  // importable, e.g. node_modules removed").
  await mkdir(join(nodeModulesPath, '@prisma-next', 'extension-test-contract-space'), {
    recursive: true,
  });

  await emitPinnedSpaceArtefacts(projectMigrationsDir, TEST_SPACE_ID, {
    contract: testContract,
    contractDts: testContractDts,
    headRef: { hash: TEST_HEAD_HASH, invariants: [TEST_INVARIANT] },
  });

  return { projectRoot, projectMigrationsDir, nodeModulesPath };
}

describe('per-space verifier + runner against a project with deleted node_modules (AC-15 / TC-26)', () => {
  let fixture: ProjectFixture;

  beforeEach(async () => {
    fixture = await setupProjectWithPinnedTestSpace();
    await rm(fixture.nodeModulesPath, { recursive: true, force: true });
    const remaining = await readdir(fixture.projectRoot);
    expect(remaining.includes('node_modules')).toBe(false);
  });

  afterEach(async () => {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  });

  it('listPinnedSpaceDirectories discovers the test space without descriptor access', async () => {
    const dirs = await listPinnedSpaceDirectories(fixture.projectMigrationsDir);
    expect(dirs).toEqual([TEST_SPACE_ID]);
  });

  it('verifyContractSpaces returns ok when pinned files + marker rows match — no descriptor needed', async () => {
    const pinnedRaw = await readFile(
      join(fixture.projectMigrationsDir, TEST_SPACE_ID, 'contract.json'),
      'utf-8',
    );
    expect(pinnedRaw.trimEnd()).toBe(canonicalizeJson(testContract));

    const headRaw = await readFile(
      join(fixture.projectMigrationsDir, TEST_SPACE_ID, 'refs', 'head.json'),
      'utf-8',
    );
    const headJson = JSON.parse(headRaw) as SpacePinnedHashRecord;

    const dirs = await listPinnedSpaceDirectories(fixture.projectMigrationsDir);
    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', TEST_SPACE_ID]),
      pinnedDirsOnDisk: dirs,
      pinnedHashesBySpace: new Map([[TEST_SPACE_ID, headJson]]),
      markerRowsBySpace: new Map<string, SpaceMarkerRecord>([
        [TEST_SPACE_ID, { hash: headJson.hash, invariants: [...headJson.invariants] }],
      ]),
    });

    expect(result.ok).toBe(true);
  });

  it('verifyContractSpaces flags hash drift on the test space, again without descriptor access', async () => {
    const dirs = await listPinnedSpaceDirectories(fixture.projectMigrationsDir);

    const driftedMarker: SpaceMarkerRecord = {
      hash: 'sha256:00000000000000000000000000000000000000000000000000000000deadbeef',
      invariants: [TEST_INVARIANT],
    };

    const result = verifyContractSpaces({
      loadedSpaces: new Set(['app', TEST_SPACE_ID]),
      pinnedDirsOnDisk: dirs,
      pinnedHashesBySpace: new Map([
        [
          TEST_SPACE_ID,
          { hash: TEST_HEAD_HASH, invariants: [TEST_INVARIANT] } satisfies SpacePinnedHashRecord,
        ],
      ]),
      markerRowsBySpace: new Map([[TEST_SPACE_ID, driftedMarker]]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toContainEqual(
      expect.objectContaining({
        kind: 'hashMismatch',
        spaceId: TEST_SPACE_ID,
      }),
    );
  });

  it('concatenateSpaceApplyInputs orders the test space ahead of app — driven by on-disk inputs only', () => {
    const appInput: SpaceApplyInput<{ readonly id: string }> = {
      spaceId: 'app',
      migrationDirectory: fixture.projectMigrationsDir,
      currentMarkerHash: null,
      currentMarkerInvariants: [],
      path: [{ id: 'app-create-table' }],
    };
    const testSpaceInput: SpaceApplyInput<{ readonly id: string }> = {
      spaceId: TEST_SPACE_ID,
      migrationDirectory: join(fixture.projectMigrationsDir, TEST_SPACE_ID),
      currentMarkerHash: null,
      currentMarkerInvariants: [],
      path: [{ id: 'test-contract-space-create-test_box' }],
    };

    const ordered = concatenateSpaceApplyInputs([appInput, testSpaceInput]);
    expect(ordered.map((i) => i.spaceId)).toEqual([TEST_SPACE_ID, 'app']);
  });
});
