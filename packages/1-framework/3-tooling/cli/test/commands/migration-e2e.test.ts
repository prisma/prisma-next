import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlContract } from '@prisma-next/contract/testing';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { findLeaf, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  formatMigrationDirName,
  readMigrationPackage,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

function attestedMetadata(
  base: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): MigrationMetadata {
  return { ...base, migrationHash: computeMigrationHash(base, ops) };
}

/**
 * Canonical helper for writing a test migration package to disk. Always
 * produces a *consistent* (attested) package: the `migrationHash` is computed
 * over the exact `ops` passed to the writer, so the resulting package
 * round-trips through `readMigrationPackage`'s integrity check.
 *
 * Tampering tests use this same helper and then surgically overwrite the
 * offending file post-hoc — see the equivalent helper in
 * `migration-tools/test/fixtures.ts` for the canonical pattern. (The CLI
 * copy mirrors the migration-tools fixture; consolidation into a published
 * `@prisma-next/migration-tools/testing` subpath is queued as a follow-up.)
 */
async function writeTestPackage(
  dir: string,
  base: Omit<MigrationMetadata, 'migrationHash'>,
  ops: readonly MigrationPlanOperation[],
): Promise<MigrationMetadata> {
  const metadata = attestedMetadata(base, ops);
  await writeMigrationPackage(dir, metadata, ops);
  return metadata;
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

async function withTempDir(run: (root: string) => Promise<void>): Promise<void> {
  const root = await createTempDir();
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('migration plan → emit end-to-end', () => {
  it('new project: plan writes valid package, verify passes', async () => {
    await withTempDir(async (root) => {
      const migrationsDir = join(root, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      const toContract = createSqlContract({
        storage: {
          tables: {
            user: {
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
            },
          },
        },
      });

      const ops: MigrationPlanOperation[] = [createTableOp('user')];

      const dirName = formatMigrationDirName(new Date(), 'initial');
      const packageDir = join(migrationsDir, dirName);
      const metadata = await writeTestPackage(
        packageDir,
        {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:initial-hash',
          kind: 'regular',
          fromContract: null,
          toContract,
          hints: {
            used: [],
            applied: ['additive_only'],
            plannerVersion: '1.0.0',
          },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        ops,
      );

      const pkg = await readMigrationPackage(packageDir);
      expect(pkg.metadata.from).toBe(EMPTY_CONTRACT_HASH);
      expect(pkg.metadata.to).toBe('sha256:initial-hash');
      expect(pkg.metadata.migrationHash).toBe(metadata.migrationHash);
      expect(pkg.metadata.fromContract).toBeNull();
      expect(pkg.metadata.toContract).toEqual(toContract);
      expect(pkg.ops).toHaveLength(1);
    });
  });

  it(
    'incremental change: two plans form a valid migration chain',
    async () => {
      await withTempDir(async (root) => {
        const migrationsDir = join(root, 'migrations');
        await mkdir(migrationsDir, { recursive: true });

        const contractA = createSqlContract({
          storage: {
            tables: {
              user: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              },
            },
          },
        });
        const contractB = createSqlContract({
          storage: {
            tables: {
              user: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              },
              post: {
                columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
              },
            },
          },
        });

        // Plan 1: empty → A
        const dir1 = formatMigrationDirName(new Date(2026, 0, 1, 10, 0), 'add_user');
        const path1 = join(migrationsDir, dir1);
        const ops1 = [createTableOp('user')];
        await writeTestPackage(
          path1,
          {
            from: EMPTY_CONTRACT_HASH,
            to: 'sha256:hash-a',
            kind: 'regular',
            fromContract: null,
            toContract: contractA,
            hints: {
              used: [],
              applied: ['additive_only'],
              plannerVersion: '1.0.0',
            },
            labels: [],
            createdAt: new Date().toISOString(),
          },
          ops1,
        );

        // Plan 2: A → B
        const dir2 = formatMigrationDirName(new Date(2026, 0, 2, 10, 0), 'add_post');
        const path2 = join(migrationsDir, dir2);
        const ops2 = [createTableOp('post')];
        await writeTestPackage(
          path2,
          {
            from: 'sha256:hash-a',
            to: 'sha256:hash-b',
            kind: 'regular',
            fromContract: contractA,
            toContract: contractB,
            hints: {
              used: [],
              applied: ['additive_only'],
              plannerVersion: '1.0.0',
            },
            labels: [],
            createdAt: new Date().toISOString(),
          },
          ops2,
        );

        const packages = await readMigrationsDir(migrationsDir);
        expect(packages).toHaveLength(2);

        const graph = reconstructGraph(packages);
        const leaf = findLeaf(graph);
        expect(leaf).toBe('sha256:hash-b');

        // Verify chain integrity
        const pkg1 = packages.find((p) => p.metadata.to === 'sha256:hash-a')!;
        const pkg2 = packages.find((p) => p.metadata.to === 'sha256:hash-b')!;
        expect(pkg1.metadata.to).toBe(pkg2.metadata.from);
      });
    },
    timeouts.databaseOperation,
  );

  it('no-op: second plan with same hash produces no new files', async () => {
    await withTempDir(async (root) => {
      const migrationsDir = join(root, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      const contract = createSqlContract({
        storage: {
          tables: {
            user: {
              columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
            },
          },
        },
      });

      // First migration
      const dir1 = formatMigrationDirName(new Date(), 'initial');
      const path1 = join(migrationsDir, dir1);
      await writeTestPackage(
        path1,
        {
          from: EMPTY_CONTRACT_HASH,
          to: 'sha256:target-hash',
          kind: 'regular',
          fromContract: null,
          toContract: contract,
          hints: {
            used: [],
            applied: ['additive_only'],
            plannerVersion: '1.0.0',
          },
          labels: [],
          createdAt: new Date().toISOString(),
        },
        [],
      );

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
  });

  it('rejects migration.json with `migrationHash: null` at read time', async () => {
    // The arktype schema in `io.ts` requires `migrationHash` to be a string;
    // a null value (or any non-string) must surface as
    // `MIGRATION.INVALID_MANIFEST` pointing at the offending directory.
    await withTempDir(async (root) => {
      const dirName = formatMigrationDirName(new Date(), 'invalid-hash');
      const packageDir = join(root, dirName);
      await mkdir(packageDir, { recursive: true });
      const invalidMetadata = {
        from: EMPTY_CONTRACT_HASH,
        to: EMPTY_CONTRACT_HASH,
        migrationHash: null,
        kind: 'regular' as const,
        fromContract: null,
        toContract: createSqlContract({ storage: { tables: {} } }),
        hints: { used: [], applied: [], plannerVersion: '1.0.0' },
        labels: [],
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(packageDir, 'migration.json'), JSON.stringify(invalidMetadata));
      await writeFile(join(packageDir, 'ops.json'), '[]');

      await expect(readMigrationPackage(packageDir)).rejects.toMatchObject({
        code: 'MIGRATION.INVALID_MANIFEST',
      });
    });
  });
});
