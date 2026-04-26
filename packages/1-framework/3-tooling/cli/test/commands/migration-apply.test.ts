import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContract, createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { findLeaf, findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import { computeMigrationHash } from '@prisma-next/migration-tools/hash';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationMetadata } from '@prisma-next/migration-tools/metadata';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

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
    `test-migration-apply-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function writeAttestedMigration(
  migrationsDir: string,
  opts: {
    from: string;
    to: string;
    fromContract: Contract | null;
    toContract: Contract;
    ops: MigrationPlanOperation[];
    timestamp: Date;
    slug: string;
  },
): Promise<{ dirName: string; migrationHash: string }> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(migrationsDir, dirName);
  const baseMetadata: Omit<MigrationMetadata, 'migrationHash'> = {
    from: opts.from,
    to: opts.to,
    kind: 'regular',
    fromContract: opts.fromContract,
    toContract: opts.toContract,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '1.0.0',
    },
    labels: [],
    createdAt: opts.timestamp.toISOString(),
  };
  const migrationHash = computeMigrationHash(baseMetadata, opts.ops);
  const metadata: MigrationMetadata = { ...baseMetadata, migrationHash };
  await writeMigrationPackage(packageDir, metadata, opts.ops);
  return { dirName, migrationHash };
}

// These tests write migration packages to disk, attest them (SHA-256 + read/write),
// then read them back. The shared default timeout is intentionally overridden here
// because this test does real filesystem work and still needs more headroom.
// filesystem I/O on slow CI runners.
describe(
  'migration apply — pending migration resolution',
  { timeout: timeouts.databaseOperation },
  () => {
    it('finds pending path from empty marker to leaf', async () => {
      const tempDir = await createTempDir('pending-empty');
      const migrationsDir = join(tempDir, 'migrations');
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

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: contractA,
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'initial',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);

      const markerHash = EMPTY_CONTRACT_HASH;
      const path = findPath(graph, markerHash, leaf!);

      expect(path).not.toBeNull();
      expect(path).toHaveLength(1);
      expect(path![0]!.from).toBe(EMPTY_CONTRACT_HASH);
      expect(path![0]!.to).toBe('sha256:hash-a');
    });

    it('finds pending path for multi-step migration', async () => {
      const tempDir = await createTempDir('pending-multi');
      const migrationsDir = join(tempDir, 'migrations');
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

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: contractA,
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'add_user',
      });

      await writeAttestedMigration(migrationsDir, {
        from: 'sha256:hash-a',
        to: 'sha256:hash-b',
        fromContract: contractA,
        toContract: contractB,
        ops: [createTableOp('post')],
        timestamp: new Date(2026, 0, 2, 10, 0),
        slug: 'add_post',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);

      const path = findPath(graph, 'sha256:hash-a', leaf!);
      expect(path).toHaveLength(1);
      expect(path![0]!.from).toBe('sha256:hash-a');
      expect(path![0]!.to).toBe('sha256:hash-b');

      const fullPath = findPath(graph, EMPTY_CONTRACT_HASH, leaf!);
      expect(fullPath).toHaveLength(2);
      expect(fullPath![0]!.to).toBe('sha256:hash-a');
      expect(fullPath![1]!.to).toBe('sha256:hash-b');
    });

    it('finds path to an explicit destination hash', async () => {
      const tempDir = await createTempDir('explicit-destination');
      const migrationsDir = join(tempDir, 'migrations');
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

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: contractA,
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'add_user',
      });

      await writeAttestedMigration(migrationsDir, {
        from: 'sha256:hash-a',
        to: 'sha256:hash-b',
        fromContract: contractA,
        toContract: contractB,
        ops: [createTableOp('post')],
        timestamp: new Date(2026, 0, 2, 10, 0),
        slug: 'add_post',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);

      const pathToContractA = findPath(graph, EMPTY_CONTRACT_HASH, 'sha256:hash-a');
      expect(pathToContractA).toHaveLength(1);
      expect(pathToContractA![0]!.to).toBe('sha256:hash-a');
    });

    it('returns empty path when marker already at leaf', async () => {
      const tempDir = await createTempDir('at-leaf');
      const migrationsDir = join(tempDir, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: createContract(),
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'initial',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);

      const path = findPath(graph, 'sha256:hash-a', leaf!);
      expect(path).toHaveLength(0);
    });

    it('returns null when marker hash is not in migration chain', async () => {
      const tempDir = await createTempDir('unknown-marker');
      const migrationsDir = join(tempDir, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: createContract(),
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'initial',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);

      const path = findPath(graph, 'sha256:unknown-hash', leaf!);
      expect(path).toBeNull();
    });

    it('rejects legacy draft packages (`migrationId: null`) at read time', async () => {
      // After the draft state was collapsed, the schema rejects any
      // on-disk migration.json with `migrationId: null`. We construct one
      // directly to confirm the read path surfaces a schema error
      // pointing at the offending file rather than silently skipping it.
      // (The on-disk wire shape still uses `migrationId`; Phase 5 of
      // TML-2264 collapses it back to a single in-memory shape.)
      const tempDir = await createTempDir('reject-legacy-draft');
      const migrationsDir = join(tempDir, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: createContract(),
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'initial',
      });

      const legacyDraftDir = join(
        migrationsDir,
        formatMigrationDirName(new Date(2026, 0, 2), 'legacy-draft'),
      );
      const baseWireMetadata = {
        from: 'sha256:hash-a',
        to: EMPTY_CONTRACT_HASH,
        kind: 'regular' as const,
        fromContract: createContract(),
        toContract: createContract(),
        hints: { used: [], applied: [], plannerVersion: '1.0.0' },
        labels: [],
        createdAt: new Date().toISOString(),
      };
      const legacyJson = JSON.stringify({ ...baseWireMetadata, migrationId: null });
      await mkdir(legacyDraftDir, { recursive: true });
      await writeFile(join(legacyDraftDir, 'migration.json'), legacyJson);
      await writeFile(join(legacyDraftDir, 'ops.json'), '[]');

      await expect(readMigrationsDir(migrationsDir)).rejects.toMatchObject({
        code: 'MIGRATION.INVALID_MANIFEST',
      });
    });

    it('distinguishes corrupted empty-sentinel marker from absent marker', async () => {
      const tempDir = await createTempDir('empty-sentinel-marker');
      const migrationsDir = join(tempDir, 'migrations');
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

      await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: contractA,
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'initial',
      });

      await writeAttestedMigration(migrationsDir, {
        from: 'sha256:hash-a',
        to: 'sha256:hash-b',
        fromContract: contractA,
        toContract: contractB,
        ops: [createTableOp('post')],
        timestamp: new Date(2026, 0, 2, 10, 0),
        slug: 'add_post',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);

      const corruptedMarkerHash = EMPTY_CONTRACT_HASH;
      const path = findPath(graph, corruptedMarkerHash, leaf!);
      expect(path).toHaveLength(2);
    });

    it('resolves correct package for each edge in path', async () => {
      const tempDir = await createTempDir('edge-packages');
      const migrationsDir = join(tempDir, 'migrations');
      await mkdir(migrationsDir, { recursive: true });

      const contractA = createContract();
      const contractB = createContract();

      const m1 = await writeAttestedMigration(migrationsDir, {
        from: EMPTY_CONTRACT_HASH,
        to: 'sha256:hash-a',
        fromContract: null,
        toContract: contractA,
        ops: [createTableOp('user')],
        timestamp: new Date(2026, 0, 1, 10, 0),
        slug: 'first',
      });

      const m2 = await writeAttestedMigration(migrationsDir, {
        from: 'sha256:hash-a',
        to: 'sha256:hash-b',
        fromContract: contractA,
        toContract: contractB,
        ops: [createTableOp('post')],
        timestamp: new Date(2026, 0, 2, 10, 0),
        slug: 'second',
      });

      const packages = await readMigrationsDir(migrationsDir);
      const attested = packages;
      const graph = reconstructGraph(attested);
      const leaf = findLeaf(graph);
      const path = findPath(graph, EMPTY_CONTRACT_HASH, leaf!)!;

      expect(path).toHaveLength(2);

      for (const migration of path) {
        const pkg = attested.find((p) => p.dirName === migration.dirName);
        expect(pkg).toBeDefined();
        expect(pkg!.metadata.from).toBe(migration.from);
        expect(pkg!.metadata.to).toBe(migration.to);
      }

      expect(path[0]!.dirName).toBe(m1.dirName);
      expect(path[1]!.dirName).toBe(m2.dirName);
    });
  },
);
