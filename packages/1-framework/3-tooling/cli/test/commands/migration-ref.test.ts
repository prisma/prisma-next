import { mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSqlContract } from '@prisma-next/contract/testing';
import type { Contract } from '@prisma-next/contract/types';
import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import { computeMigrationId } from '@prisma-next/migration-tools/attestation';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { findPath, reconstructGraph } from '@prisma-next/migration-tools/dag';
import {
  formatMigrationDirName,
  readMigrationsDir,
  writeMigrationPackage,
} from '@prisma-next/migration-tools/io';
import type { RefEntry } from '@prisma-next/migration-tools/refs';
import {
  deleteRef,
  readRef,
  readRefs,
  resolveRef,
  writeRef,
} from '@prisma-next/migration-tools/refs';
import type { MigrationManifest } from '@prisma-next/migration-tools/types';
import { MigrationToolsError } from '@prisma-next/migration-tools/types';
import { timeouts } from '@prisma-next/test-utils';
import { describe, expect, it } from 'vitest';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

const ENTRY_A: RefEntry = { hash: HASH_A, invariants: [] };
const ENTRY_B: RefEntry = { hash: HASH_B, invariants: [] };
const ENTRY_C: RefEntry = { hash: HASH_C, invariants: [] };

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
    fromContract: Contract | null;
    toContract: Contract;
    ops: MigrationPlanOperation[];
    timestamp: Date;
    slug: string;
  },
): Promise<{ dirName: string; migrationId: string }> {
  const dirName = formatMigrationDirName(opts.timestamp, opts.slug);
  const packageDir = join(migrationsDir, dirName);
  const baseManifest: Omit<MigrationManifest, 'migrationId'> = {
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
  const migrationId = computeMigrationId(baseManifest, opts.ops);
  const manifest: MigrationManifest = { ...baseManifest, migrationId };
  await writeMigrationPackage(packageDir, manifest, opts.ops);
  return { dirName, migrationId };
}

describe('ref-aware pathfinding integration', { timeout: timeouts.databaseOperation }, () => {
  it('resolves ref to target hash for pathfinding', async () => {
    const tempDir = await createTempDir('ref-pathfind');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
        },
      },
    });
    const contractB = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          post: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
        },
      },
    });
    const contractC = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          post: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          comment: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
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

    await writeRef(refsDir, 'staging', ENTRY_C);
    await writeRef(refsDir, 'production', ENTRY_B);

    const stagingEntry = await readRef(refsDir, 'staging');
    const productionEntry = await readRef(refsDir, 'production');

    expect(stagingEntry.hash).toBe(HASH_C);
    expect(productionEntry.hash).toBe(HASH_B);

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages;
    const graph = reconstructGraph(attested);

    const pathToStaging = findPath(graph, EMPTY_CONTRACT_HASH, stagingEntry.hash);
    expect(pathToStaging).toHaveLength(3);

    const pathToProduction = findPath(graph, EMPTY_CONTRACT_HASH, productionEntry.hash);
    expect(pathToProduction).toHaveLength(2);

    const pathStagingFromProd = findPath(graph, productionEntry.hash, stagingEntry.hash);
    expect(pathStagingFromProd).toHaveLength(1);
  });

  it('reports error for unknown ref', () => {
    const refs = { staging: ENTRY_A };
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
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
        },
      },
    });
    const contractB = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          post: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
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

    await writeRef(refsDir, 'production', ENTRY_A);

    const entry = await readRef(refsDir, 'production');

    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages;
    const graph = reconstructGraph(attested);

    const markerHash = HASH_B;
    const forwardPath = findPath(graph, markerHash, entry.hash);
    expect(forwardPath).toBeNull();

    const reversePath = findPath(graph, entry.hash, markerHash);
    expect(reversePath).toHaveLength(1);
  });

  it('ref CRUD operations with per-file writes', async () => {
    const tempDir = await createTempDir('ref-crud');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    let refs = await readRefs(refsDir);
    expect(refs).toEqual({});

    await writeRef(refsDir, 'staging', ENTRY_A);
    refs = await readRefs(refsDir);
    expect(refs).toEqual({ staging: ENTRY_A });

    await writeRef(refsDir, 'production', ENTRY_B);
    refs = await readRefs(refsDir);
    expect(refs).toEqual({ staging: ENTRY_A, production: ENTRY_B });

    await writeRef(refsDir, 'staging', ENTRY_C);
    refs = await readRefs(refsDir);
    expect(refs['staging']).toEqual(ENTRY_C);

    await deleteRef(refsDir, 'staging');
    refs = await readRefs(refsDir);
    expect(refs).toEqual({ production: ENTRY_B });

    const raw = await readFile(join(refsDir, 'production.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('status reports distance behind ref target', async () => {
    const tempDir = await createTempDir('ref-distance');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
        },
      },
    });
    const contractB = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          post: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
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
    const attested = packages;
    const graph = reconstructGraph(attested);

    await writeRef(refsDir, 'production', ENTRY_B);

    const refs = await readRefs(refsDir);
    const refEntry = resolveRef(refs, 'production');

    const markerHash = EMPTY_CONTRACT_HASH;
    const pathToRef = findPath(graph, markerHash, refEntry.hash);
    expect(pathToRef).toHaveLength(2);

    const atTarget = markerHash === refEntry.hash;
    expect(atTarget).toBe(false);

    const markerAtA = HASH_A;
    const pathFromA = findPath(graph, markerAtA, refEntry.hash);
    expect(pathFromA).toHaveLength(1);

    const markerAtB = HASH_B;
    const pathFromB = findPath(graph, markerAtB, refEntry.hash);
    expect(pathFromB).toEqual([]);
  });

  it('independent applies against different refs produce correct results', async () => {
    const tempDir = await createTempDir('ref-independent');
    const migrationsDir = join(tempDir, 'migrations');
    const refsDir = join(migrationsDir, 'refs');
    await mkdir(migrationsDir, { recursive: true });

    const contractA = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
        },
      },
    });
    const contractB = createSqlContract({
      storage: {
        tables: {
          user: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
          },
          post: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
              },
            },
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

    await writeRef(refsDir, 'staging', { hash: HASH_B, invariants: [] });
    await writeRef(refsDir, 'production', ENTRY_A);

    const refs = await readRefs(refsDir);
    const packages = await readMigrationsDir(migrationsDir);
    const attested = packages;
    const graph = reconstructGraph(attested);

    const stagingPath = findPath(graph, EMPTY_CONTRACT_HASH, resolveRef(refs, 'staging').hash);
    expect(stagingPath).toHaveLength(2);

    const productionPath = findPath(
      graph,
      EMPTY_CONTRACT_HASH,
      resolveRef(refs, 'production').hash,
    );
    expect(productionPath).toHaveLength(1);

    const refsAfter = await readRefs(refsDir);
    expect(refsAfter).toEqual({
      staging: { hash: HASH_B, invariants: [] },
      production: ENTRY_A,
    });
  });
});
