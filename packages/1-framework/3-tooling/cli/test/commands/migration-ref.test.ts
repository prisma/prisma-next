import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { attestMigration } from '@prisma-next/migration-tools/attestation';
import { findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import { readRefs, resolveRef, writeRefs } from '@prisma-next/migration-tools/refs';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { isAttested, MigrationToolsError } from '@prisma-next/migration-tools/types';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

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
    `test-migration-ref-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
): Promise<{ dirName: string; migrationId: string }> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(migrationsDir, dirName);
  const manifest: MigrationManifest = {
    from: opts.from,
    to: opts.to,
    migrationId: null,
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
  const migrationId = await attestMigration(packageDir);
  return { dirName, migrationId };
}

describe('ref-aware pathfinding integration', { timeout: timeouts.databaseOperation }, () => {
  it('resolves ref to target hash for pathfinding', async () => {
    const tempDir = await createTempDir('ref-pathfind');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });
    const contractB = createTestContract({
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
    const contractC = createTestContract({
      storage: {
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
          post: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
          comment: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });

    await writeAttestedMigration(migrationsDir, {
      from: EMPTY_CONTRACT_HASH,
      to: HASH_A,
      fromContract: null,
      toContract: contractA,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      fromContract: contractA,
      toContract: contractB,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_B,
      to: HASH_C,
      fromContract: contractB,
      toContract: contractC,
      ops: [createTableOp('comment')],
      timestamp: new Date(2026, 0, 3, 10, 0),
      slug: 'add_comment',
    });

    const refsPath = join(migrationsDir, 'refs.json');
    await writeRefs(refsPath, {
      staging: HASH_C,
      production: HASH_B,
    });

    const refs = await readRefs(refsPath);
    const stagingHash = resolveRef(refs, 'staging');
    const productionHash = resolveRef(refs, 'production');

    expect(stagingHash).toBe(HASH_C);
    expect(productionHash).toBe(HASH_B);

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter(isAttested);
    const graph = reconstructGraph(attested);

    const pathToStaging = findPath(graph, EMPTY_CONTRACT_HASH, stagingHash);
    expect(pathToStaging).toHaveLength(3);

    const pathToProduction = findPath(graph, EMPTY_CONTRACT_HASH, productionHash);
    expect(pathToProduction).toHaveLength(2);

    const pathStagingFromProd = findPath(graph, productionHash, stagingHash);
    expect(pathStagingFromProd).toHaveLength(1);
  });

  it('apply does not mutate refs.json', async () => {
    const tempDir = await createTempDir('ref-readonly');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const refsPath = join(migrationsDir, 'refs.json');
    const originalRefs = { staging: HASH_A, production: HASH_B };
    await writeRefs(refsPath, originalRefs);

    const refs = await readRefs(refsPath);
    resolveRef(refs, 'staging');

    const refsAfter = await readRefs(refsPath);
    expect(refsAfter).toEqual(originalRefs);
  });

  it('reports error for unknown ref', () => {
    const refs = { staging: HASH_A };
    expect(() => resolveRef(refs, 'production')).toThrow();

    try {
      resolveRef(refs, 'production');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      expect((e as MigrationToolsError).code).toBe('MIGRATION.UNKNOWN_REF');
    }
  });

  it('marker ahead of ref target produces no forward path', async () => {
    const tempDir = await createTempDir('ref-ahead');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });
    const contractB = createTestContract({
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
      to: HASH_A,
      fromContract: null,
      toContract: contractA,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      fromContract: contractA,
      toContract: contractB,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const refsPath = join(migrationsDir, 'refs.json');
    await writeRefs(refsPath, { production: HASH_A });

    const refs = await readRefs(refsPath);
    const refHash = resolveRef(refs, 'production');

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter(isAttested);
    const graph = reconstructGraph(attested);

    const markerHash = HASH_B;
    const forwardPath = findPath(graph, markerHash, refHash);
    expect(forwardPath).toBeNull();

    const reversePath = findPath(graph, refHash, markerHash);
    expect(reversePath).toHaveLength(1);
  });

  it('ref CRUD operations with atomic writes', async () => {
    const tempDir = await createTempDir('ref-crud');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });
    const refsPath = join(migrationsDir, 'refs.json');

    let refs = await readRefs(refsPath);
    expect(refs).toEqual({});

    await writeRefs(refsPath, { staging: HASH_A });
    refs = await readRefs(refsPath);
    expect(refs).toEqual({ staging: HASH_A });

    await writeRefs(refsPath, { ...refs, production: HASH_B });
    refs = await readRefs(refsPath);
    expect(refs).toEqual({ staging: HASH_A, production: HASH_B });

    await writeRefs(refsPath, { ...refs, staging: HASH_C });
    refs = await readRefs(refsPath);
    expect(refs['staging']).toBe(HASH_C);

    const { staging: _, ...remaining } = refs;
    await writeRefs(refsPath, remaining);
    refs = await readRefs(refsPath);
    expect(refs).toEqual({ production: HASH_B });

    const raw = await readFile(refsPath, 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('status reports distance behind ref target', async () => {
    const tempDir = await createTempDir('ref-distance');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });
    const contractB = createTestContract({
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
      to: HASH_A,
      fromContract: null,
      toContract: contractA,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      fromContract: contractA,
      toContract: contractB,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter(isAttested);
    const graph = reconstructGraph(attested);

    const refsPath = join(migrationsDir, 'refs.json');
    await writeRefs(refsPath, { production: HASH_B });

    const refs = await readRefs(refsPath);
    const refHash = resolveRef(refs, 'production');

    const markerHash = EMPTY_CONTRACT_HASH;
    const pathToRef = findPath(graph, markerHash, refHash);
    expect(pathToRef).toHaveLength(2);

    const atTarget = markerHash === refHash;
    expect(atTarget).toBe(false);

    const markerAtA = HASH_A;
    const pathFromA = findPath(graph, markerAtA, refHash);
    expect(pathFromA).toHaveLength(1);

    const markerAtB = HASH_B;
    expect(markerAtB === refHash).toBe(true);
  });

  it('independent applies against different refs produce correct results', async () => {
    const tempDir = await createTempDir('ref-independent');
    const migrationsDir = join(tempDir, 'migrations');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createTestContract({
      storage: {
        tables: {
          user: {
            columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
          },
        },
      },
    });
    const contractB = createTestContract({
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
      to: HASH_A,
      fromContract: null,
      toContract: contractA,
      ops: [createTableOp('user')],
      timestamp: new Date(2026, 0, 1, 10, 0),
      slug: 'add_user',
    });

    await writeAttestedMigration(migrationsDir, {
      from: HASH_A,
      to: HASH_B,
      fromContract: contractA,
      toContract: contractB,
      ops: [createTableOp('post')],
      timestamp: new Date(2026, 0, 2, 10, 0),
      slug: 'add_post',
    });

    const refsPath = join(migrationsDir, 'refs.json');
    await writeRefs(refsPath, {
      staging: HASH_B,
      production: HASH_A,
    });

    const refs = await readRefs(refsPath);
    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages.filter(isAttested);
    const graph = reconstructGraph(attested);

    const stagingPath = findPath(graph, EMPTY_CONTRACT_HASH, resolveRef(refs, 'staging'));
    expect(stagingPath).toHaveLength(2);

    const productionPath = findPath(graph, EMPTY_CONTRACT_HASH, resolveRef(refs, 'production'));
    expect(productionPath).toHaveLength(1);

    const refsAfter = await readRefs(refsPath);
    expect(refsAfter).toEqual({ staging: HASH_B, production: HASH_A });
  });
});
