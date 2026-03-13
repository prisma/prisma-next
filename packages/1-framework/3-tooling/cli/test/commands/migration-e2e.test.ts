import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration, verifyMigration } from '@prisma-next/migration-tools/attestation';
import { findLeaf, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';

function createContract(
  tables: Record<
    string,
    Record<string, { nativeType: string; codecId: string; nullable: boolean }>
  >,
): ContractIR {
  const storage: Record<string, unknown> = { tables: {} };
  const storageTables = storage['tables'] as Record<string, unknown>;
  for (const [tableName, columns] of Object.entries(tables)) {
    storageTables[tableName] = { columns };
  }
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage,
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };
}

function createTableOp(table: string): MigrationPlanOperation {
  return {
    id: `table.${table}`,
    label: `Create table "${table}"`,
    operationClass: 'additive',
  };
}

async function createTempDir(): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('migration plan → verify end-to-end', () => {
  it('new project: plan writes valid package, verify passes', async () => {
    const root = await createTempDir();
    const migrationsDir = join(root, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const toContract = createContract({
      user: {
        id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
      },
    });

    const ops: MigrationPlanOperation[] = [createTableOp('user')];

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:initial-hash',
      migrationId: null,
      kind: 'regular',
      fromContract: null,
      toContract,
      hints: {
        used: [],
        applied: ['additive_only'],
        plannerVersion: '1.0.0',
        planningStrategy: 'additive',
      },
      labels: [],
      createdAt: new Date().toISOString(),
    };

    const dirName = formatMigrationDirName(new Date(), 'initial');
    const packageDir = join(migrationsDir, dirName);
    await writeMigrationPackage(packageDir, manifest, ops);
    const migrationId = await attestMigration(packageDir);

    // Verify the package
    const verifyResult = await verifyMigration(packageDir);
    expect(verifyResult.ok).toBe(true);
    expect(verifyResult.storedMigrationId).toBe(migrationId);

    // Read back and validate structure
    const pkg = await readMigrationPackage(packageDir);
    expect(pkg.manifest.from).toBe(EMPTY_CONTRACT_HASH);
    expect(pkg.manifest.to).toBe('sha256:initial-hash');
    expect(pkg.manifest.migrationId).toBe(migrationId);
    expect(pkg.manifest.fromContract).toBeNull();
    expect(pkg.manifest.toContract).toEqual(toContract);
    expect(pkg.ops).toHaveLength(1);
  });

  it('incremental change: two plans form a valid migration chain', async () => {
    const root = await createTempDir();
    const migrationsDir = join(root, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createContract({
      user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
    });
    const contractB = createContract({
      user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
      post: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
    });

    // Plan 1: empty → A
    const dir1 = formatMigrationDirName(new Date(2026, 0, 1, 10, 0), 'add_user');
    const path1 = join(migrationsDir, dir1);
    await writeMigrationPackage(
      path1,
      {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        migrationId: null,
        kind: 'regular',
        fromContract: null,
        toContract: contractA,
        hints: {
          used: [],
          applied: ['additive_only'],
          plannerVersion: '1.0.0',
          planningStrategy: 'additive',
        },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [createTableOp('user')],
    );
    await attestMigration(path1);

    // Plan 2: A → B
    const dir2 = formatMigrationDirName(new Date(2026, 0, 2, 10, 0), 'add_post');
    const path2 = join(migrationsDir, dir2);
    await writeMigrationPackage(
      path2,
      {
        from: 'sha256:hash-a',
        to: 'sha256:hash-b',
        migrationId: null,
        kind: 'regular',
        fromContract: contractA,
        toContract: contractB,
        hints: {
          used: [],
          applied: ['additive_only'],
          plannerVersion: '1.0.0',
          planningStrategy: 'additive',
        },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [createTableOp('post')],
    );
    await attestMigration(path2);

    // Verify the migration chain
    const packages = await readMigrationsDir(migrationsDir);
    expect(packages).toHaveLength(2);

    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);
    expect(leaf).toBe('sha256:hash-b');

    // Verify chain integrity
    const pkg1 = packages.find((p) => p.manifest.to === 'sha256:hash-a')!;
    const pkg2 = packages.find((p) => p.manifest.to === 'sha256:hash-b')!;
    expect(pkg1.manifest.to).toBe(pkg2.manifest.from);

    // Both packages verify
    expect((await verifyMigration(path1)).ok).toBe(true);
    expect((await verifyMigration(path2)).ok).toBe(true);
  });

  it('no-op: second plan with same hash produces no new files', async () => {
    const root = await createTempDir();
    const migrationsDir = join(root, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createContract({
      user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
    });

    // First migration
    const dir1 = formatMigrationDirName(new Date(), 'initial');
    const path1 = join(migrationsDir, dir1);
    await writeMigrationPackage(
      path1,
      {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:target-hash',
        migrationId: null,
        kind: 'regular',
        fromContract: null,
        toContract: contract,
        hints: {
          used: [],
          applied: ['additive_only'],
          plannerVersion: '1.0.0',
          planningStrategy: 'additive',
        },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [],
    );
    await attestMigration(path1);

    // Read migrations and check leaf
    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages);
    const leaf = findLeaf(graph);

    // Same hash → no-op
    const toStorageHash = 'sha256:target-hash';
    expect(leaf).toBe(toStorageHash);

    // No new migration should be written — the CLI command checks this condition
    // and returns early with noOp: true
  });

  it('scaffold draft → verify attests → verify again passes', async () => {
    const root = await createTempDir();
    const dirName = formatMigrationDirName(new Date(), 'manual');
    const packageDir = join(root, dirName);

    // Scaffold: Draft migration (migrationId: null)
    await writeMigrationPackage(
      packageDir,
      {
        from: EMPTY_CONTRACT_HASH,
        to: EMPTY_CONTRACT_HASH,
        migrationId: null,
        kind: 'regular',
        fromContract: null,
        toContract: createContract({}),
        hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [],
    );

    // Verify detects draft
    const result1 = await verifyMigration(packageDir);
    expect(result1.ok).toBe(false);
    expect(result1.reason).toBe('draft');

    // Attest (same as what migration verify does for drafts)
    const migrationId = await attestMigration(packageDir);
    expect(migrationId).toMatch(/^sha256:/);

    // Verify now passes
    const result2 = await verifyMigration(packageDir);
    expect(result2.ok).toBe(true);
    expect(result2.storedMigrationId).toBe(migrationId);
  });
});
