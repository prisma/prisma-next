import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { describe, expect, it } from 'vitest';
import { computeMigrationId } from '../src/attestation';
import { findLeaf, findPath, findReachableLeaves, reconstructGraph } from '../src/dag';
import { MigrationToolsError } from '../src/errors';
import type { MigrationPackage } from '../src/types';
import { createTestManifest, createTestOps } from './fixtures';

const E = EMPTY_CONTRACT_HASH;

const C1 = `sha256:${'1'.repeat(64)}`;
const C2 = `sha256:${'2'.repeat(64)}`;
const C3 = `sha256:${'3'.repeat(64)}`;

let migrationCounter = 0;

function edge(from: string, to: string, dirName: string): MigrationPackage {
  const manifest = createTestManifest({ from, to });
  const ops = createTestOps();
  const migrationId = computeMigrationId(
    { ...manifest, createdAt: `${manifest.createdAt}-${migrationCounter++}` },
    ops,
  );
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    manifest: { ...manifest, migrationId },
    ops,
  };
}

function graph(...specs: Array<[string, string, string]>) {
  const packages = specs.map(([from, to, dirName]) => edge(from!, to!, dirName!));
  return { graph: reconstructGraph(packages), packages };
}

describe('Spec scenario S-1: Linear happy path', () => {
  it('selects C1 -> C2 -> C3 as the only path from C1 to C3', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post'], [C2, C3, 'add-comment']);

    const path = findPath(g, C1, C3);

    expect(path).toHaveLength(2);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C2);
    expect(path![1]!.from).toBe(C2);
    expect(path![1]!.to).toBe(C3);
  });

  it('returns no-op when marker equals target', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post']);

    const path = findPath(g, C2, C2);
    expect(path).toEqual([]);
  });
});

describe('Spec scenario S-2: Staging rollback cycle', () => {
  it('findLeaf throws NO_RESOLVABLE_LEAF before exit edge is added', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'deploy'], [C2, C1, 'rollback']);

    try {
      findLeaf(g);
      expect.fail('expected NO_RESOLVABLE_LEAF error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.NO_RESOLVABLE_LEAF');
      expect(mte.fix).toContain('--from');
    }
  });

  it('selects direct C1 -> C3 path, skipping C1 -> C2 -> C1 detour', () => {
    const { graph: g } = graph(
      [E, C1, 'init'],
      [C1, C2, 'deploy'],
      [C2, C1, 'rollback'],
      [C1, C3, 'new-approach'],
    );

    const path = findPath(g, C1, C3);

    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('revisited-hash C1->C2->C1->C3 resolves via graph topology alone', () => {
    const { graph: g } = graph(
      [E, C1, 'init'],
      [C1, C2, 'stage'],
      [C2, C1, 'revert'],
      [C1, C3, 'redo'],
    );

    const fullPath = findPath(g, E, C3);
    expect(fullPath).toHaveLength(2);
    expect(fullPath![0]!.from).toBe(E);
    expect(fullPath![0]!.to).toBe(C1);
    expect(fullPath![1]!.from).toBe(C1);
    expect(fullPath![1]!.to).toBe(C3);
  });
});

describe('Spec scenario S-3: Converging paths', () => {
  it('selects shortest path C1 -> C3 over C1 -> C2 -> C3', () => {
    const { graph: g } = graph(
      [E, C1, 'init'],
      [C1, C2, 'long-a'],
      [C2, C3, 'long-b'],
      [C1, C3, 'direct'],
    );

    const path = findPath(g, C1, C3);

    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('single leaf despite converging paths', () => {
    const { graph: g } = graph(
      [E, C1, 'init'],
      [C1, C2, 'long-a'],
      [C2, C3, 'long-b'],
      [C1, C3, 'short'],
    );

    expect(findLeaf(g)).toBe(C3);
  });
});

describe('Spec scenario S-4: Same-base divergence', () => {
  it('errors with AMBIGUOUS_LEAF when no explicit target specified', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'alice'], [C1, C3, 'bob']);

    try {
      findLeaf(g);
      expect.fail('expected AMBIGUOUS_LEAF error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.AMBIGUOUS_LEAF');
      expect(mte.details!['leaves']).toEqual(expect.arrayContaining([C2, C3]));
    }
  });

  it('findReachableLeaves returns both divergent leaves', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'alice'], [C1, C3, 'bob']);

    const leaves = findReachableLeaves(g, E);
    expect(leaves).toHaveLength(2);
    expect(leaves).toEqual(expect.arrayContaining([C2, C3]));
  });

  it('explicit target resolves divergence — selects path to C3', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'alice'], [C1, C3, 'bob']);

    const path = findPath(g, C1, C3);
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C3);
  });

  it('C1 -> C2 edge is inert when targeting C3', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'alice'], [C1, C3, 'bob']);

    const path = findPath(g, C1, C3);
    const visitedHashes = path!.flatMap((e) => [e.from, e.to]);
    expect(visitedHashes).not.toContain(C2);
  });
});

describe('Spec scenario S-5: Staging ahead of production', () => {
  it('independent ref targets route independently', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post'], [C2, C3, 'add-comment']);

    const prodPath = findPath(g, E, C2);
    expect(prodPath).toHaveLength(2);
    expect(prodPath![1]!.to).toBe(C2);

    const stagingPath = findPath(g, E, C3);
    expect(stagingPath).toHaveLength(3);
    expect(stagingPath![2]!.to).toBe(C3);
  });

  it('production marker at C1 routes to C2, staging marker at C1 routes to C3', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post'], [C2, C3, 'add-comment']);

    const prodPath = findPath(g, C1, C2);
    expect(prodPath).toHaveLength(1);
    expect(prodPath![0]!.to).toBe(C2);

    const stagingPath = findPath(g, C1, C3);
    expect(stagingPath).toHaveLength(2);
    expect(stagingPath![1]!.to).toBe(C3);
  });

  it('does not trigger divergence — single leaf at C3', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post'], [C2, C3, 'add-comment']);

    expect(findLeaf(g)).toBe(C3);
  });
});

describe('Spec scenario S-6: DB marker ahead of ref target', () => {
  it('no forward path from C3 to C2 when no backward edge exists', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post'], [C2, C3, 'add-comment']);

    const path = findPath(g, C3, C2);
    expect(path).toBeNull();
  });

  it('backward edge C3 -> C2 would be applied if it exists', () => {
    const { graph: g } = graph(
      [E, C1, 'init'],
      [C1, C2, 'add-post'],
      [C2, C3, 'add-comment'],
      [C3, C2, 'rollback'],
    );

    const path = findPath(g, C3, C2);
    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C3);
    expect(path![0]!.to).toBe(C2);
  });
});

describe('Spec scenario S-7: Transition from db update to migrations', () => {
  it('path from marker at C1 skips baseline EMPTY→C1 edge', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post']);

    const path = findPath(g, C1, C2);

    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C1);
    expect(path![0]!.to).toBe(C2);
  });
});

describe('Spec scenario S-8: Mixed db update and migrations', () => {
  it('path is empty when marker already at target', () => {
    const { graph: g } = graph([E, C1, 'init'], [C1, C2, 'add-post']);

    const path = findPath(g, C2, C2);
    expect(path).toEqual([]);
  });
});

describe('Spec scenario S-9: Adopting migrations on existing production database', () => {
  it('baseline EMPTY→C2 is skipped when marker at C2, incremental C2→C3 is found', () => {
    const { graph: g } = graph([E, C2, 'baseline'], [C2, C3, 'add-comment']);

    const path = findPath(g, C2, C3);

    expect(path).toHaveLength(1);
    expect(path![0]!.from).toBe(C2);
    expect(path![0]!.to).toBe(C3);
  });

  it('full path from EMPTY includes baseline when marker is at EMPTY', () => {
    const { graph: g } = graph([E, C2, 'baseline'], [C2, C3, 'add-comment']);

    const path = findPath(g, E, C3);

    expect(path).toHaveLength(2);
    expect(path![0]!.from).toBe(E);
    expect(path![0]!.to).toBe(C2);
    expect(path![1]!.from).toBe(C2);
    expect(path![1]!.to).toBe(C3);
  });
});
