import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findLeaf, findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';

function createTestContract(overrides?: Partial<ContractIR>): ContractIR {
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: { tables: {} },
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
    fromContract: ContractIR | null;
    toContract: ContractIR;
    ops: MigrationPlanOperation[];
    timestamp: Date;
    slug: string;
  },
): Promise<string> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(migrationsDir, dirName);
  const manifest: MigrationManifest = {
    from: opts.from,
    to: opts.to,
    edgeId: null,
    kind: 'regular',
    fromContract: opts.fromContract,
    toContract: opts.toContract,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '1.0.0',
      planningStrategy: 'additive',
    },
    labels: [],
    createdAt: opts.timestamp.toISOString(),
  };
  await writeMigrationPackage(packageDir, manifest, opts.ops);
  await attestMigration(packageDir);
  return dirName;
}

describe('migration apply — pending migration resolution', () => {
  it('finds pending path from empty marker to leaf', async () => {
    const tempDir = await createTempDir('pending-empty');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: { columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } } },
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
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);

    // DB has no marker → markerHash = EMPTY_CONTRACT_HASH
    const markerHash = EMPTY_CONTRACT_HASH;
    const path = findPath(graph, markerHash, leaf);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(EMPTY_CONTRACT_HASH);
    expect(path![0]!.to).toBe('sha256:hash-a');
  });

  it('finds pending path for multi-step migration', async () => {
    const tempDir = await createTempDir('pending-multi');
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
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);

    // DB at hash-a → only hash-b pending
    const path = findPath(graph, 'sha256:hash-a', leaf);
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe('sha256:hash-a');
    expect(path![0]!.to).toBe('sha256:hash-b');

    // DB empty → both pending
    const fullPath = findPath(graph, EMPTY_CONTRACT_HASH, leaf);
    expect(fullPath).toHaveLength(2);
    expect(fullPath![0]!.to).toBe('sha256:hash-a');
    expect(fullPath![1]!.to).toBe('sha256:hash-b');
  });

  it('returns empty path when marker already at leaf', async () => {
    const tempDir = await createTempDir('at-leaf');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:hash-a',
      fromContract: null,
      toContract: createTestContract(),
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);

    const path = findPath(graph, 'sha256:hash-a', leaf);
    expect(path).toHaveLength(0);
  });

  it('returns null when marker hash is not in DAG', async () => {
    const tempDir = await createTempDir('unknown-marker');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:hash-a',
      fromContract: null,
      toContract: createTestContract(),
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);

    const path = findPath(graph, 'sha256:unknown-hash', leaf);
    expect(path).toBeNull();
  });

  it('skips draft migrations when resolving pending path', async () => {
    const tempDir = await createTempDir('skip-drafts');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    await writeAttestedMigration(migrationsDir, {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:hash-a',
      fromContract: null,
      toContract: createTestContract(),
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'initial',
    });

    // Write a draft (not attested)
    const draftManifest: MigrationManifest = {
      from: 'sha256:hash-a',
      to: EMPTY_CONTRACT_HASH,
      edgeId: null,
      kind: 'regular',
      fromContract: createTestContract(),
      toContract: createTestContract(),
      hints: { used: [], applied: [], plannerVersion: '1.0.0', planningStrategy: 'manual' },
      labels: [],
      createdAt: new Date().toISOString(),
    };
    const draftDir = join(migrationsDir, formatMigrationDirName(new Date(2026, 0, 2), 'draft'));
    await writeMigrationPackage(draftDir, draftManifest, []);

    const allPackages = await readMigrationsDir(migrationsDir);
    expect(allPackages).toHaveLength(2);

    const attested = allPackages.filter((p) => p.manifest.edgeId !== null);
    expect(attested).toHaveLength(1);

    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);
    expect(leaf).toBe('sha256:hash-a');

    const path = findPath(graph, EMPTY_CONTRACT_HASH, leaf);
    expect(path).toHaveLength(1);
  });

  it('resolves correct package for each edge in path', async () => {
    const tempDir = await createTempDir('edge-packages');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract();
    const contractB = createTestContract();

    const dir1 = await writeAttestedMigration(migrationsDir, {
      from: EMPTY_CONTRACT_HASH,
      to: 'sha256:hash-a',
      fromContract: null,
      toContract: contractA,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'first',
    });

    const dir2 = await writeAttestedMigration(migrationsDir, {
      from: 'sha256:hash-a',
      to: 'sha256:hash-b',
      fromContract: contractA,
      toContract: contractB,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'second',
    });

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter((p) => p.manifest.edgeId !== null);
    const graph = reconstructGraph(attested);
    const leaf = findLeaf(graph);
    const path = findPath(graph, EMPTY_CONTRACT_HASH, leaf)!;

    expect(path).toHaveLength(2);

    // Each edge's dirName matches a package
    for (const edge of path) {
      const pkg = attested.find((p) => p.dirName === edge.dirName);
      expect(pkg).toBeDefined();
      expect(pkg!.manifest.from).toBe(edge.from);
      expect(pkg!.manifest.to).toBe(edge.to);
    }

    expect(path[0]!.dirName).toBe(dir1);
    expect(path[1]!.dirName).toBe(dir2);
  });
});
