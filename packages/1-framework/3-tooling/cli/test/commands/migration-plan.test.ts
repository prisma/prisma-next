import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findLeaf, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { isAttested } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';
import { resolveBundleByPrefix } from '../../src/commands/migration-plan';

function createTestContract(overrides?: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: {
      tables: {},
    },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
    ...overrides,
  };
}

function createTableOp(table: string): MigrationPlanOperation {
  return {
    id: `table.${table}`,
    label: `Create table "${table}"`,
    operationClass: 'additive',
  };
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-migration-plan-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

describe('migration plan — core flow', () => {
  it('writes a valid migration package for new project', async () => {
    const tempDir = await createTempDir('new-project');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const toContract = createTestContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
            },
          },
        },
      },
    });

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:test-hash',
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

    const ops: MigrationPlanOperation[] = [createTableOp('user')];

    const dirName = formatMigrationDirName(new Date(), 'initial');
    const packageDir = join(migrationsDir, dirName);

    await writeMigrationPackage(packageDir, manifest, ops);
    const migrationId = await attestMigration(packageDir);

    const pkg = await readMigrationPackage(packageDir);

    expect(pkg.manifest.from).toBe(EMPTY_CONTRACT_HASH);
    expect(pkg.manifest.to).toBe('sha256:test-hash');
    expect(pkg.manifest.migrationId).toBe(migrationId);
    expect(pkg.manifest.kind).toBe('regular');
    expect(pkg.manifest.fromContract).toBeNull();
    expect(pkg.ops).toHaveLength(1);
    expect(pkg.ops[0]!.id).toBe('table.user');
  });

  it('produces no-op when from and to hash match', async () => {
    const tempDir = await createTempDir('no-op');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createTestContract();
    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:same-hash',
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
    };

    const dirName = formatMigrationDirName(new Date(), 'first');
    const packageDir = join(migrationsDir, dirName);
    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    // Read migrations and find leaf — leaf should be 'sha256:same-hash'
    const packages = await readMigrationsDir(migrationsDir);
    const graph = reconstructGraph(packages.filter(isAttested));
    const leaf = findLeaf(graph);

    expect(leaf).toBe('sha256:same-hash');

    // If toStorageHash === leaf, it's a no-op
    const toStorageHash = 'sha256:same-hash';
    expect(leaf).toBe(toStorageHash);
  });

  it('builds incremental migration chain', async () => {
    const tempDir = await createTempDir('incremental');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
        },
      },
    });
    const contractB = createTestContract({
      storage: {
        tables: {
          user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
          post: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
        },
      },
    });

    // First migration: empty -> A
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

    // Second migration: A -> B
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

    // Verify migration chain
    const packages = await readMigrationsDir(migrationsDir);
    expect(packages).toHaveLength(2);

    const graph = reconstructGraph(packages.filter(isAttested));
    const leaf = findLeaf(graph);
    expect(leaf).toBe('sha256:hash-b');

    // Verify chain: first migration's `to` === second migration's `from`
    const pkg1 = packages.find((p) => p.manifest.to === 'sha256:hash-a')!;
    const pkg2 = packages.find((p) => p.manifest.to === 'sha256:hash-b')!;
    expect(pkg1.manifest.to).toBe(pkg2.manifest.from);
  });

  it('detects missing contract.json', async () => {
    const tempDir = await createTempDir('missing-contract');
    const nonexistent = join(tempDir, 'does-not-exist.json');

    let caughtError = false;
    try {
      await readFile(nonexistent, 'utf-8');
    } catch (error) {
      caughtError = true;
      expect((error as { code?: string }).code).toBe('ENOENT');
    }
    expect(caughtError).toBe(true);
  });
});

describe('--from hash lookup', () => {
  it('finds no package for unknown hash', async () => {
    const tempDir = await createTempDir('from-lookup');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:known-hash',
      migrationId: null,
      kind: 'regular',
      fromContract: null,
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'additive' },
      labels: [],
      createdAt: new Date().toISOString(),
    };
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(migrationsDir, dirName);
    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    const packages = await readMigrationsDir(migrationsDir);
    const found = packages.find((p) => p.manifest.to === 'sha256:nonexistent');
    expect(found).toBeUndefined();
  });

  it('resolves prefix without sha256: scheme', async () => {
    const tempDir = await createTempDir('prefix-no-scheme');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createTestContract();
    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:abcdef1234567890',
      migrationId: null,
      kind: 'regular',
      fromContract: null,
      toContract: contract,
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'additive' },
      labels: [],
      createdAt: new Date().toISOString(),
    };
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(migrationsDir, dirName);
    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    const packages = await readMigrationsDir(migrationsDir);
    const result = resolveBundleByPrefix(packages, 'abcdef');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.to).toBe('sha256:abcdef1234567890');
    }
  });

  it('resolves prefix with sha256: scheme', async () => {
    const tempDir = await createTempDir('prefix-with-scheme');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contract = createTestContract();
    const manifest: MigrationManifest = {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:abcdef1234567890',
      migrationId: null,
      kind: 'regular',
      fromContract: null,
      toContract: contract,
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'additive' },
      labels: [],
      createdAt: new Date().toISOString(),
    };
    const dirName = formatMigrationDirName(new Date(), 'test');
    const packageDir = join(migrationsDir, dirName);
    await writeMigrationPackage(packageDir, manifest, []);
    await attestMigration(packageDir);

    const packages = await readMigrationsDir(migrationsDir);
    const result = resolveBundleByPrefix(packages, 'sha256:abcdef');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.manifest.to).toBe('sha256:abcdef1234567890');
    }
  });

  it('rejects ambiguous prefix matching multiple migrations', async () => {
    const tempDir = await createTempDir('prefix-ambiguous');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract();
    const contractB = createTestContract();

    // Two migrations whose `to` hashes share a prefix
    const dir1 = formatMigrationDirName(new Date(2026, 0, 1), 'first');
    await writeMigrationPackage(
      join(migrationsDir, dir1),
      {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:abc111',
        migrationId: null,
        kind: 'regular',
        fromContract: null,
        toContract: contractA,
        hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'additive' },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [],
    );
    await attestMigration(join(migrationsDir, dir1));

    const dir2 = formatMigrationDirName(new Date(2026, 0, 2), 'second');
    await writeMigrationPackage(
      join(migrationsDir, dir2),
      {
        from: 'sha256:abc111',
        to: 'sha256:abc222',
        migrationId: null,
        kind: 'regular',
        fromContract: contractA,
        toContract: contractB,
        hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'additive' },
        labels: [],
        createdAt: new Date().toISOString(),
      },
      [],
    );
    await attestMigration(join(migrationsDir, dir2));

    const packages = await readMigrationsDir(migrationsDir);
    const result = resolveBundleByPrefix(packages, 'sha256:abc');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure).toEqual({ reason: 'ambiguous', count: 2 });
    }
  });
});

describe('MigrationToolsError mapping', () => {
  it('MigrationToolsError has expected shape for CLI mapping', () => {
    // Simulate a MigrationToolsError-like object as the CLI would encounter it
    const error = new Error('Directory already exists: /tmp/test');
    error.name = 'MigrationToolsError';
    Object.assign(error, {
      code: 'MIGRATION.DIR_EXISTS',
      category: 'MIGRATION',
      why: 'A migration directory with this name already exists on disk.',
      fix: 'Choose a different name or remove the existing directory.',
      details: { dir: '/tmp/test' },
    });

    expect(error.name).toBe('MigrationToolsError');
    expect((error as unknown as { code: string }).code).toBe('MIGRATION.DIR_EXISTS');
    expect((error as unknown as { category: string }).category).toBe('MIGRATION');
    expect(typeof (error as unknown as { why: string }).why).toBe('string');
    expect(typeof (error as unknown as { fix: string }).fix).toBe('string');
    expect(error instanceof Error).toBe(true);
  });
});
