/**
 * Multi-extension monorepo end-to-end against PGlite.
 *
 * Drives the CLI aggregate `db init` flow (`executeDbInit`) against
 * PGlite (via `createDevDatabase`) with **two** internal extension
 * packages (`audit`, `feature-flags`) plus the application's own
 * contract. The structurally novel property under test here is
 * **plurality**: the framework treats N>1 contract-space contributors
 * uniformly, regardless of whether they ship as out-of-tree
 * extensions, in-tree extension packages, or internal monorepo
 * packages.
 *
 * Layers of coverage:
 *
 *   1. **Pinned per-space artefacts on disk.** After
 *      `emitContractSpaceArtefacts` runs for both extension spaces, the
 *      consuming app's repo carries `migrations/audit/{contract.json,
 *      contract.d.ts, refs/head.json}` and the same triple under
 *      `migrations/feature-flags/`.
 *
 *   2. **Multi-space planning across three spaces.** Calling
 *      `executeDbInit` with `mode: 'plan'` produces a plan whose ops
 *      are ordered alphabetically by space id (extensions first, app
 *      last) per `concatenateSpaceApplyInputs`. The audit
 *      `CREATE TABLE audit_event` op precedes the feature-flags
 *      `CREATE TABLE feature_flag` op (both are extension-space and
 *      sort by space id), and both precede the app-space User-table
 *      op.
 *
 *   3. **Multi-space apply across three spaces.** Same wiring as test
 *      (2) with `mode: 'apply'`. Asserts:
 *
 *        - all three tables (`audit_event`, `feature_flag`, the app
 *          `User`-equivalent) exist in `public`;
 *        - the marker table has rows for `app`, `audit`, and
 *          `feature-flags`;
 *        - each marker row carries the expected `core_hash` and the
 *          expected `applied_invariants`;
 *        - insert + select round-trip works against each table
 *          (proving the apply path actually ran the DDL, not just
 *          updated the marker).
 *
 *   4. **Order-independent across `extensionPacks` declaration order
 *      .** Re-running the apply path with the extensions
 *      declared in reverse order produces the same marker hashes —
 *      cross-space ordering is determined by space id, not by
 *      declaration order.
 *
 * The fixtures (`audit*`, `featureFlags*`) are pulled from each
 * package's descriptor `contractSpace` rather than from
 * (now-deleted) per-package `contract.ts` / `migrations.ts` modules —
 * each internal package now authors via the on-disk
 * `prisma-next contract emit` / `prisma-next migration plan` pipeline,
 * and the descriptor is the canonical reader of those artefacts.
 */

import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgresAdapterDescriptor from '@prisma-next/adapter-postgres/control';
import { executeDbInit } from '@prisma-next/cli/control-api';
import type { Contract } from '@prisma-next/contract/types';
import postgresDriverDescriptor from '@prisma-next/driver-postgres/control';
import sqlFamilyDescriptor from '@prisma-next/family-sql/control';
import {
  createControlStack,
  type MigrationPackage,
} from '@prisma-next/framework-components/control';
import { materialiseMigrationPackage } from '@prisma-next/migration-tools/io';
import { emitContractSpaceArtefacts } from '@prisma-next/migration-tools/spaces';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import postgresTargetDescriptor from '@prisma-next/target-postgres/control';
import { createDevDatabase, timeouts } from '@prisma-next/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { APP_USER_TABLE } from '../app/src/constants';
import appContractJson from '../app/src/contract.json' with { type: 'json' };

const APP_CONTRACT_HASH_VALUE = appContractJson.storage.storageHash;

import {
  AUDIT_BASELINE_INVARIANT_ID,
  AUDIT_EVENT_TABLE,
  AUDIT_SPACE_ID,
} from '../packages/audit/src/constants';
import auditExtensionDescriptor from '../packages/audit/src/control';
import {
  FEATURE_FLAG_TABLE,
  FEATURE_FLAGS_BASELINE_INVARIANT_ID,
  FEATURE_FLAGS_SPACE_ID,
} from '../packages/feature-flags/src/constants';
import featureFlagsExtensionDescriptor from '../packages/feature-flags/src/control';

function requireBaseline(
  descriptor: { readonly contractSpace?: { readonly migrations: readonly MigrationPackage[] } },
  spaceId: string,
): MigrationPackage {
  const baseline = descriptor.contractSpace?.migrations[0];
  if (!baseline) {
    throw new Error(`${spaceId} descriptor is missing its baseline migration package`);
  }
  return baseline;
}

const auditContractSpace = auditExtensionDescriptor.contractSpace;
if (!auditContractSpace) {
  throw new Error('audit descriptor is missing its contractSpace');
}
const auditBaselineMigration: MigrationPackage = requireBaseline(auditExtensionDescriptor, 'audit');
const auditContract = auditContractSpace.contractJson;
const AUDIT_STORAGE_HASH = auditContractSpace.headRef.hash;
const auditHeadRef = auditContractSpace.headRef;

const featureFlagsContractSpace = featureFlagsExtensionDescriptor.contractSpace;
if (!featureFlagsContractSpace) {
  throw new Error('feature-flags descriptor is missing its contractSpace');
}
const featureFlagsBaselineMigration: MigrationPackage = requireBaseline(
  featureFlagsExtensionDescriptor,
  'feature-flags',
);
const featureFlagsContract = featureFlagsContractSpace.contractJson;
const FEATURE_FLAGS_STORAGE_HASH = featureFlagsContractSpace.headRef.hash;
const featureFlagsHeadRef = featureFlagsContractSpace.headRef;

function buildFamilyInstance(declarationOrder: 'natural' | 'reverse') {
  const extensionPacks =
    declarationOrder === 'natural'
      ? [auditExtensionDescriptor, featureFlagsExtensionDescriptor]
      : [featureFlagsExtensionDescriptor, auditExtensionDescriptor];
  return sqlFamilyDescriptor.create(
    createControlStack({
      family: sqlFamilyDescriptor,
      target: postgresTargetDescriptor,
      adapter: postgresAdapterDescriptor,
      driver: postgresDriverDescriptor,
      extensionPacks,
    }),
  );
}

const appContract = buildFamilyInstance('natural').deserializeContract(
  appContractJson,
) as Contract<SqlStorage>;

const frameworkComponents = [
  postgresTargetDescriptor,
  postgresAdapterDescriptor,
  postgresDriverDescriptor,
  auditExtensionDescriptor,
  featureFlagsExtensionDescriptor,
] as const;

interface TestProject {
  readonly projectRoot: string;
  readonly migrationsDir: string;
}

async function setupTestProject(): Promise<TestProject> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'multi-extension-monorepo-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  await emitContractSpaceArtefacts(migrationsDir, AUDIT_SPACE_ID, {
    contract: auditContract,
    contractDts: '// rendered .d.ts for audit contract space\nexport interface Contract {}\n',
    headRef: { hash: auditHeadRef.hash, invariants: [...auditHeadRef.invariants] },
  });
  const auditSpaceDir = join(migrationsDir, AUDIT_SPACE_ID);
  await materialiseMigrationPackage(auditSpaceDir, auditBaselineMigration);

  await emitContractSpaceArtefacts(migrationsDir, FEATURE_FLAGS_SPACE_ID, {
    contract: featureFlagsContract,
    contractDts:
      '// rendered .d.ts for feature-flags contract space\nexport interface Contract {}\n',
    headRef: {
      hash: featureFlagsHeadRef.hash,
      invariants: [...featureFlagsHeadRef.invariants],
    },
  });
  const featureFlagsSpaceDir = join(migrationsDir, FEATURE_FLAGS_SPACE_ID);
  await materialiseMigrationPackage(featureFlagsSpaceDir, featureFlagsBaselineMigration);

  return { projectRoot, migrationsDir };
}

describe.sequential('multi-extension-monorepo end-to-end (PGlite)', {
  timeout: timeouts.spinUpPpgDev,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;
  let driver: Awaited<ReturnType<typeof postgresDriverDescriptor.create>> | undefined;
  let project: TestProject | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  beforeEach(async () => {
    driver = await postgresDriverDescriptor.create(database.connectionString);
    await driver.query('drop schema if exists public cascade');
    await driver.query('drop schema if exists prisma_contract cascade');
    await driver.query('create schema public');
  }, timeouts.spinUpPpgDev);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
    if (project) {
      await rm(project.projectRoot, { recursive: true, force: true });
      project = undefined;
    }
  });

  it('pinned per-space artefacts land for both extension spaces', async () => {
    project = await setupTestProject();

    const auditHeadJson = JSON.parse(
      await readFile(join(project.migrationsDir, AUDIT_SPACE_ID, 'refs', 'head.json'), 'utf-8'),
    );
    expect(auditHeadJson.hash).toBe(AUDIT_STORAGE_HASH);
    expect(auditHeadJson.invariants).toEqual([AUDIT_BASELINE_INVARIANT_ID]);

    const featureFlagsHeadJson = JSON.parse(
      await readFile(
        join(project.migrationsDir, FEATURE_FLAGS_SPACE_ID, 'refs', 'head.json'),
        'utf-8',
      ),
    );
    expect(featureFlagsHeadJson.hash).toBe(FEATURE_FLAGS_STORAGE_HASH);
    expect(featureFlagsHeadJson.invariants).toEqual([FEATURE_FLAGS_BASELINE_INVARIANT_ID]);

    const auditOps = JSON.parse(
      await readFile(
        join(project.migrationsDir, AUDIT_SPACE_ID, auditBaselineMigration.dirName, 'ops.json'),
        'utf-8',
      ),
    ) as ReadonlyArray<{ readonly invariantId?: string }>;
    expect(auditOps.find((op) => op.invariantId === AUDIT_BASELINE_INVARIANT_ID)).toBeDefined();

    const featureFlagsOps = JSON.parse(
      await readFile(
        join(
          project.migrationsDir,
          FEATURE_FLAGS_SPACE_ID,
          featureFlagsBaselineMigration.dirName,
          'ops.json',
        ),
        'utf-8',
      ),
    ) as ReadonlyArray<{ readonly invariantId?: string }>;
    expect(
      featureFlagsOps.find((op) => op.invariantId === FEATURE_FLAGS_BASELINE_INVARIANT_ID),
    ).toBeDefined();
  });

  it('mode=plan produces a plan across spaces ordered alphabetically (extensions first, app last)', async () => {
    project = await setupTestProject();

    const result = await executeDbInit({
      driver: driver!,
      familyInstance: buildFamilyInstance('natural'),
      contract: appContract,
      mode: 'plan',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: project.migrationsDir,
      targetId: 'postgres',
      extensionPacks: [auditExtensionDescriptor, featureFlagsExtensionDescriptor],
    });

    if (!result.ok) {
      throw new Error(
        `Expected plan ok but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }
    const opIdsInOrder = result.value.plan.operations.map((op: { readonly id: string }) => op.id);

    const auditIdx = opIdsInOrder.findIndex((id: string) =>
      id.includes(`audit.create-${AUDIT_EVENT_TABLE}`),
    );
    const featureFlagsIdx = opIdsInOrder.findIndex((id: string) =>
      id.includes(`feature-flags.create-${FEATURE_FLAG_TABLE}`),
    );
    const appIdx = opIdsInOrder.findIndex((id: string) => id.includes(APP_USER_TABLE));

    expect(auditIdx).toBeGreaterThanOrEqual(0);
    expect(featureFlagsIdx).toBeGreaterThan(auditIdx);
    expect(appIdx).toBeGreaterThan(featureFlagsIdx);
  });

  it('mode=apply: three spaces apply atomically; markers + round-trips OK', async () => {
    project = await setupTestProject();

    const result = await executeDbInit({
      driver: driver!,
      familyInstance: buildFamilyInstance('natural'),
      contract: appContract,
      mode: 'apply',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: project.migrationsDir,
      targetId: 'postgres',
      extensionPacks: [auditExtensionDescriptor, featureFlagsExtensionDescriptor],
    });

    if (!result.ok) {
      throw new Error(
        `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }

    const markers = await driver!.query<{
      space: string;
      core_hash: string;
      invariants: readonly string[];
    }>('select space, core_hash, invariants from prisma_contract.marker order by space');
    const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

    expect([...markerBySpace.keys()].sort()).toEqual(
      ['app', AUDIT_SPACE_ID, FEATURE_FLAGS_SPACE_ID].sort(),
    );

    expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH_VALUE);
    expect(markerBySpace.get(AUDIT_SPACE_ID)?.core_hash).toBe(AUDIT_STORAGE_HASH);
    expect(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.core_hash).toBe(FEATURE_FLAGS_STORAGE_HASH);

    expect([...(markerBySpace.get(AUDIT_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
      [...auditHeadRef.invariants].sort(),
    );
    expect([...(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.invariants ?? [])].sort()).toEqual(
      [...featureFlagsHeadRef.invariants].sort(),
    );

    const auditTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."${AUDIT_EVENT_TABLE}"') is not null as exists`,
    );
    expect(auditTable.rows[0]?.exists).toBe(true);

    const featureFlagsTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."${FEATURE_FLAG_TABLE}"') is not null as exists`,
    );
    expect(featureFlagsTable.rows[0]?.exists).toBe(true);

    const appTable = await driver!.query<{ exists: boolean }>(
      `select to_regclass('public."${APP_USER_TABLE}"') is not null as exists`,
    );
    expect(appTable.rows[0]?.exists).toBe(true);

    await driver!.query(
      `insert into public."${AUDIT_EVENT_TABLE}" ("id", "actor", "action") values ($1, $2, $3)`,
      ['evt-1', 'alice', 'login'],
    );
    const auditRows = await driver!.query<{ id: string; actor: string; action: string }>(
      `select "id", "actor", "action" from public."${AUDIT_EVENT_TABLE}"`,
    );
    expect(auditRows.rows.length).toBe(1);
    expect(auditRows.rows[0]?.actor).toBe('alice');

    await driver!.query(
      `insert into public."${FEATURE_FLAG_TABLE}" ("key", "enabled") values ($1, $2)`,
      ['dark-mode', true],
    );
    const featureFlagsRows = await driver!.query<{ key: string; enabled: boolean }>(
      `select "key", "enabled" from public."${FEATURE_FLAG_TABLE}"`,
    );
    expect(featureFlagsRows.rows.length).toBe(1);
    expect(featureFlagsRows.rows[0]?.enabled).toBe(true);

    await driver!.query(`insert into public."${APP_USER_TABLE}" ("id", "email") values ($1, $2)`, [
      'user-1',
      'alice@example.com',
    ]);
    const appRows = await driver!.query<{ id: string; email: string }>(
      `select "id", "email" from public."${APP_USER_TABLE}"`,
    );
    expect(appRows.rows.length).toBe(1);
    expect(appRows.rows[0]?.email).toBe('alice@example.com');
  });

  it('marker hashes are independent of `extensionPacks` declaration order', async () => {
    project = await setupTestProject();

    const result = await executeDbInit({
      driver: driver!,
      familyInstance: buildFamilyInstance('reverse'),
      contract: appContract,
      mode: 'apply',
      migrations: postgresTargetDescriptor.migrations,
      frameworkComponents: [...frameworkComponents],
      migrationsDir: project.migrationsDir,
      targetId: 'postgres',
      extensionPacks: [featureFlagsExtensionDescriptor, auditExtensionDescriptor],
    });

    if (!result.ok) {
      throw new Error(
        `Expected db apply success but got failure: ${JSON.stringify(result.failure, null, 2)}`,
      );
    }

    const markers = await driver!.query<{
      space: string;
      core_hash: string;
    }>('select space, core_hash from prisma_contract.marker order by space');
    const markerBySpace = new Map(markers.rows.map((row) => [row.space, row]));

    expect(markerBySpace.get(AUDIT_SPACE_ID)?.core_hash).toBe(AUDIT_STORAGE_HASH);
    expect(markerBySpace.get(FEATURE_FLAGS_SPACE_ID)?.core_hash).toBe(FEATURE_FLAGS_STORAGE_HASH);
    expect(markerBySpace.get('app')?.core_hash).toBe(APP_CONTRACT_HASH_VALUE);
  });
});
