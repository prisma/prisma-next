import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContractIR } from '@prisma-next/contract/ir';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationPlanOperation } from '@prisma-next/core-control-plane/types';
import { describe, expect, it } from 'vitest';
import { attestMigration } from '../src/attestation';
import { findLeaf, findPath, findReachableLeaves, reconstructGraph } from '../src/dag';
import { MigrationToolsError } from '../src/errors';
import { formatMigrationDirName, readMigrationsDir, writeMigrationPackage } from '../src/io';
import { readRefs, resolveRef, writeRefs } from '../src/refs';
import type { MigrationManifest } from '../src/types';

const E = EMPTY_CONTRACT_HASH;

function contract(
  tables: Record<
    string,
    Record<string, { nativeType: string; codecId: string; nullable: boolean }>
  >,
): ContractIR {
  const storageTables: Record<string, unknown> = {};
  for (const [name, columns] of Object.entries(tables)) {
    storageTables[name] = { columns };
  }
  return {
    schemaVersion: '1',
    targetFamily: 'sql',
    target: 'postgres',
    models: {},
    relations: {},
    storage: { tables: storageTables },
    extensionPacks: {},
    capabilities: {},
    meta: {},
    sources: {},
  };
}

function op(
  table: string,
  cls: MigrationPlanOperation['operationClass'] = 'additive',
): MigrationPlanOperation {
  return { id: `table.${table}`, label: `Create table "${table}"`, operationClass: cls };
}

let counter = 0;

async function writeMigration(
  migrationsDir: string,
  from: string,
  to: string,
  toContract: ContractIR,
  ops: MigrationPlanOperation[],
  opts?: { fromContract?: ContractIR; slug?: string; timestamp?: Date },
): Promise<string> {
  const slug = opts?.slug ?? `step-${counter++}`;
  const timestamp = opts?.timestamp ?? new Date(2026, 0, 1 + counter, 10, 0);
  const dirName = formatMigrationDirName(timestamp, slug);
  const packageDir = join(migrationsDir, dirName);
  const manifest: MigrationManifest = {
    from,
    to,
    migrationId: null,
    kind: 'regular',
    fromContract: opts?.fromContract ?? null,
    toContract,
    hints: {
      used: [],
      applied: ['additive_only'],
      plannerVersion: '1.0.0',
      planningStrategy: 'additive',
    },
    labels: [],
    createdAt: timestamp.toISOString(),
  };
  await writeMigrationPackage(packageDir, manifest, ops);
  await attestMigration(packageDir);
  return dirName;
}

async function tempMigrationsDir(label: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `test-scenario-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    'migrations',
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

async function loadGraph(migrationsDir: string) {
  const packages = await readMigrationsDir(migrationsDir);
  const attested = packages.filter((p) => p.manifest.migrationId !== null);
  return { graph: reconstructGraph(attested), packages: attested };
}

const C1 = `sha256:${'1'.repeat(64)}`;
const C2 = `sha256:${'2'.repeat(64)}`;
const C3 = `sha256:${'3'.repeat(64)}`;

const contractC1 = contract({
  user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
});
const contractC2 = contract({
  user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
  post: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
});
const contractC3 = contract({
  user: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
  post: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
  comment: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
});

describe('Spec scenario S-1: Linear happy path', () => {
  it('selects C1 -> C2 -> C3 as the only path from C1 to C3', async () => {
    const dir = await tempMigrationsDir('s1');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });

    await writeRefs(join(dir, 'refs.json'), { production: C3 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));
    const target = resolveRef(refs, 'production');

    const markerHash = C1;
    const path = findPath(graph, markerHash, target);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(2);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C2);
    expect(path![1]!.from).toBe(C2);
    expect(path![1]!.to).toBe(C3);
  });

  it('returns no-op when marker equals target', async () => {
    const dir = await tempMigrationsDir('s1-noop');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });

    await writeRefs(join(dir, 'refs.json'), { production: C2 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));
    const target = resolveRef(refs, 'production');

    const path = findPath(graph, C2, target);
    expect(path).toEqual([]);
  });
});

describe('Spec scenario S-2: Staging rollback cycle', () => {
  it('selects direct C1 -> C3 path, skipping C1 -> C2 -> C1 detour', async () => {
    const dir = await tempMigrationsDir('s2');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'deploy-staging',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C1, contractC1, [op('post')], {
      slug: 'rollback-staging',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'new-approach',
      timestamp: new Date(2026, 0, 4),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);

    const path = findPath(graph, C1, C3);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('revisited-hash C1->C2->C1->C3 resolves via graph topology alone', async () => {
    const dir = await tempMigrationsDir('s2-revisited');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'stage',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C1, contractC1, [op('post')], {
      slug: 'revert',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'redo',
      timestamp: new Date(2026, 0, 4),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);

    const fullPath = findPath(graph, E, C3);
    expect(fullPath).not.toBeNull();
    expect(fullPath).toHaveLength(2);
    expect(fullPath![0]!.from).toBe(E);
    expect(fullPath![0]!.to).toBe(C1);
    expect(fullPath![1]!.from).toBe(C1);
    expect(fullPath![1]!.to).toBe(C3);
  });
});

describe('Spec scenario S-3: Converging paths', () => {
  it('selects shortest path C1 -> C3 over C1 -> C2 -> C3', async () => {
    const dir = await tempMigrationsDir('s3');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-phone',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-email',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'direct',
      timestamp: new Date(2026, 0, 4),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);

    const path = findPath(graph, C1, C3);

    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('single leaf despite converging paths', async () => {
    const dir = await tempMigrationsDir('s3-leaf');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'long-a',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'long-b',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'short',
      timestamp: new Date(2026, 0, 4),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);
    const leaf = findLeaf(graph);
    expect(leaf).toBe(C3);
  });
});

describe('Spec scenario S-4: Same-base divergence', () => {
  it('errors with AMBIGUOUS_LEAF when no explicit target specified', async () => {
    const dir = await tempMigrationsDir('s4-error');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'alice',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'bob',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);

    expect(() => findLeaf(graph)).toThrow();

    try {
      findLeaf(graph);
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.AMBIGUOUS_LEAF');
      expect(mte.details!['leaves']).toEqual(expect.arrayContaining([C2, C3]));
    }
  });

  it('findReachableLeaves returns both divergent leaves', async () => {
    const dir = await tempMigrationsDir('s4-leaves');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'alice',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'bob',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);
    const leaves = findReachableLeaves(graph, E);
    expect(leaves).toHaveLength(2);
    expect(leaves).toEqual(expect.arrayContaining([C2, C3]));
  });

  it('explicit ref target resolves divergence — selects path to C3', async () => {
    const dir = await tempMigrationsDir('s4-ref');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'alice',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'bob',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC1,
    });

    await writeRefs(join(dir, 'refs.json'), { production: C3 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));
    const target = resolveRef(refs, 'production');

    const path = findPath(graph, C1, target);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('C1 -> C2 edge is inert when targeting C3', async () => {
    const dir = await tempMigrationsDir('s4-inert');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'alice',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C1, C3, contractC3, [op('comment')], {
      slug: 'bob',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC1,
    });

    const { graph } = await loadGraph(dir);
    const path = findPath(graph, C1, C3);
    const visitedHashes = path!.flatMap((e) => [e.from, e.to]);
    expect(visitedHashes).not.toContain(C2);
  });
});

describe('Spec scenario S-5: Staging ahead of production', () => {
  it('independent ref targets route independently', async () => {
    const dir = await tempMigrationsDir('s5');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });

    await writeRefs(join(dir, 'refs.json'), { staging: C3, production: C2 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));

    const prodTarget = resolveRef(refs, 'production');
    const stagingTarget = resolveRef(refs, 'staging');

    const prodPath = findPath(graph, E, prodTarget);
    expect(prodPath).toHaveLength(2);
    expect(prodPath![1]!.to).toBe(C2);

    const stagingPath = findPath(graph, E, stagingTarget);
    expect(stagingPath).toHaveLength(3);
    expect(stagingPath![2]!.to).toBe(C3);
  });

  it('production marker at C1 routes to C2, staging marker at C1 routes to C3', async () => {
    const dir = await tempMigrationsDir('s5-from-c1');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });

    await writeRefs(join(dir, 'refs.json'), { staging: C3, production: C2 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));

    const prodPath = findPath(graph, C1, resolveRef(refs, 'production'));
    expect(prodPath).toHaveLength(1);
    expect(prodPath![0]!.to).toBe(C2);

    const stagingPath = findPath(graph, C1, resolveRef(refs, 'staging'));
    expect(stagingPath).toHaveLength(2);
    expect(stagingPath![1]!.to).toBe(C3);
  });

  it('does not trigger divergence — single leaf at C3', async () => {
    const dir = await tempMigrationsDir('s5-no-diverge');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });

    const { graph } = await loadGraph(dir);
    const leaf = findLeaf(graph);
    expect(leaf).toBe(C3);
  });
});

describe('Spec scenario S-6: DB marker ahead of ref target', () => {
  it('no forward path from C3 to C2 when no backward edge exists', async () => {
    const dir = await tempMigrationsDir('s6');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });

    await writeRefs(join(dir, 'refs.json'), { production: C2 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));
    const refTarget = resolveRef(refs, 'production');

    const markerHash = C3;
    const path = findPath(graph, markerHash, refTarget);
    expect(path).toBeNull();
  });

  it('backward edge C3 -> C2 would be applied if it exists', async () => {
    const dir = await tempMigrationsDir('s6-backward');

    await writeMigration(dir, E, C1, contractC1, [op('user')], {
      slug: 'init',
      timestamp: new Date(2026, 0, 1),
    });
    await writeMigration(dir, C1, C2, contractC2, [op('post')], {
      slug: 'add-post',
      timestamp: new Date(2026, 0, 2),
      fromContract: contractC1,
    });
    await writeMigration(dir, C2, C3, contractC3, [op('comment')], {
      slug: 'add-comment',
      timestamp: new Date(2026, 0, 3),
      fromContract: contractC2,
    });
    await writeMigration(dir, C3, C2, contractC2, [op('comment')], {
      slug: 'rollback',
      timestamp: new Date(2026, 0, 4),
      fromContract: contractC3,
    });

    await writeRefs(join(dir, 'refs.json'), { production: C2 });

    const { graph } = await loadGraph(dir);
    const refs = await readRefs(join(dir, 'refs.json'));
    const refTarget = resolveRef(refs, 'production');

    const path = findPath(graph, C3, refTarget);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C3);
    expect(path![0]!.to).toBe(C2);
  });
});
