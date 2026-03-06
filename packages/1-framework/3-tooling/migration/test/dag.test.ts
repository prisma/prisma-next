import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { describe, expect, it } from 'vitest';
import { computeMigrationId } from '../src/attestation';
import {
  detectCycles,
  detectOrphans,
  findLatestMigration,
  findLeaf,
  findPath,
  reconstructGraph,
} from '../src/dag';
import { MigrationToolsError } from '../src/errors';
import type { MigrationPackage } from '../src/types';
import { createTestManifest, createTestOps } from './fixtures';

let migrationCounter = 0;

function pkg(
  from: string,
  to: string,
  dirName: string,
  parentMigrationId: string | null = null,
  createdAt = '2026-02-25T14:00:00.000Z',
): MigrationPackage {
  const manifest = createTestManifest({ from, to, parentMigrationId, createdAt });
  const ops = createTestOps();
  const migrationId = computeMigrationId(
    { ...manifest, createdAt: `${createdAt}-${migrationCounter++}` },
    ops,
  );
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    manifest: { ...manifest, migrationId },
    ops,
  };
}

function chain(...specs: Array<[string, string, string]>): MigrationPackage[] {
  const packages: MigrationPackage[] = [];
  let parentId: string | null = null;
  for (const [from, to, dirName] of specs) {
    const p = pkg(from!, to!, dirName!, parentId);
    packages.push(p);
    parentId = p.manifest.migrationId;
  }
  return packages;
}

const E = EMPTY_CONTRACT_HASH;

describe('reconstructGraph', () => {
  it('builds graph from single migration', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has(E)).toBe(true);
    expect(graph.nodes.has('H1')).toBe(true);
    expect(graph.forwardChain.get(E)).toHaveLength(1);
    expect(graph.reverseChain.get('H1')).toHaveLength(1);
  });

  it('builds graph from empty packages', () => {
    const graph = reconstructGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.forwardChain.size).toBe(0);
  });

  it('builds graph from linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    expect(graph.nodes.size).toBe(4);
    expect(graph.forwardChain.get(E)).toHaveLength(1);
    expect(graph.forwardChain.get('H1')).toHaveLength(1);
    expect(graph.forwardChain.get('H2')).toHaveLength(1);
  });

  it('builds migrationById and childrenByParentId indexes', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(graph.migrationById.size).toBe(2);
    expect(graph.childrenByParentId.get(null)).toHaveLength(1);
    const rootMigration = graph.childrenByParentId.get(null)![0]!;
    expect(graph.childrenByParentId.get(rootMigration.migrationId!)).toHaveLength(1);
  });

  it('rejects self-loop with code MIGRATION.SELF_LOOP', () => {
    try {
      reconstructGraph([pkg('H1', 'H1', 'm1')]);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.SELF_LOOP');
      expect(mte.category).toBe('MIGRATION');
      expect(mte.details).toHaveProperty('dirName', 'm1');
      expect(mte.details).toHaveProperty('hash', 'H1');
      expect(mte.fix).toBeTruthy();
    }
  });

  it('rejects duplicate migrationId values', () => {
    const first = pkg(E, 'H1', 'm1');
    const secondBase = pkg('H1', 'H2', 'm2', first.manifest.migrationId);
    const second = {
      ...secondBase,
      manifest: {
        ...secondBase.manifest,
        migrationId: first.manifest.migrationId,
      },
    };

    expect(() => reconstructGraph([first, second])).toThrow('Duplicate migrationId');
  });
});

describe('findLeaf', () => {
  it('returns EMPTY_CONTRACT_HASH for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(findLeaf(graph)).toBe(E);
  });

  it('returns H1 for single migration', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(findLeaf(graph)).toBe('H1');
  });

  it('returns H3 for linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    expect(findLeaf(graph)).toBe('H3');
  });

  it('handles revisited contract hashes (A→B→A)', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H1', 'm3']);
    const graph = reconstructGraph(packages);
    expect(findLeaf(graph)).toBe('H1');
  });

  it('handles longer revisit chains (A→B→C→A)', () => {
    const packages = chain(
      [E, 'H1', 'm1'],
      ['H1', 'H2', 'm2'],
      ['H2', 'H3', 'm3'],
      ['H3', 'H1', 'm4'],
    );
    const graph = reconstructGraph(packages);
    expect(findLeaf(graph)).toBe('H1');
  });

  it('errors on branching with code MIGRATION.AMBIGUOUS_LEAF', () => {
    const root = chain([E, 'H1', 'm1']);
    const rootMigrationId = root[0]!.manifest.migrationId;
    const branch1 = pkg('H1', 'H2a', 'm2a', rootMigrationId);
    const branch2 = pkg('H1', 'H2b', 'm2b', rootMigrationId);
    const graph = reconstructGraph([...root, branch1, branch2]);
    try {
      findLeaf(graph);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.AMBIGUOUS_LEAF');
      expect(mte.category).toBe('MIGRATION');
      expect(mte.details).toHaveProperty('leaves');
      expect(mte.fix).toContain('--from');
    }
  });

  it('errors with MIGRATION.NO_ROOT when no root edges exist', () => {
    const p1 = pkg('A', 'B', 'm1', 'sha256:nonexistent');
    const graph = reconstructGraph([p1]);
    try {
      findLeaf(graph);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.NO_ROOT');
      expect(mte.category).toBe('MIGRATION');
      expect(mte.details).toHaveProperty('nodes');
    }
  });
});

describe('findLatestMigration', () => {
  it('returns null for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(findLatestMigration(graph)).toBeNull();
  });

  it('returns the latest migration', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const latest = findLatestMigration(graph);
    expect(latest).not.toBeNull();
    expect(latest!.dirName).toBe('m2');
    expect(latest!.to).toBe('H2');
  });

  it('returns the latest migration for revisited hashes', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H1', 'm3']);
    const graph = reconstructGraph(packages);
    const latest = findLatestMigration(graph);
    expect(latest).not.toBeNull();
    expect(latest!.dirName).toBe('m3');
    expect(latest!.to).toBe('H1');
  });
});

describe('findPath', () => {
  it('finds path in linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, E, 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns null when no path exists', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, E, 'H99');
    expect(path).toBeNull();
  });

  it('returns empty array when from === to', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H1');
    expect(path).toEqual([]);
  });

  it('finds path through revisited hashes (A→B→A)', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H1', 'm3']);
    const graph = reconstructGraph(packages);

    const fullPath = findPath(graph, E, 'H1');
    expect(fullPath).not.toBeNull();
    expect(fullPath!.map((e) => e.dirName)).toEqual(['m1', 'm2', 'm3']);
  });

  it('finds partial path from intermediate hash to leaf with revisit', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H1', 'm3']);
    const graph = reconstructGraph(packages);

    const partial = findPath(graph, 'H2', 'H1');
    expect(partial).not.toBeNull();
    expect(partial!.map((e) => e.dirName)).toEqual(['m3']);
  });

  it('finds sub-path in middle of chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m2', 'm3']);
  });

  it('finds path when fromHash equals non-empty chain root', () => {
    const packages = chain(['H0', 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H0', 'H2');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2']);
  });
});

describe('detectCycles', () => {
  it('reports no cycles in linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects cycle in node graph', () => {
    const packages: MigrationPackage[] = [
      pkg('A', 'B', 'm1'),
      pkg('B', 'C', 'm2'),
      pkg('C', 'A', 'm3'),
    ];
    const graph = reconstructGraph(packages);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });
});

describe('detectOrphans', () => {
  it('reports no orphans when all reachable', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectOrphans(graph)).toEqual([]);
  });

  it('detects orphan migration', () => {
    const p1 = chain([E, 'H1', 'm1']);
    const orphan = pkg('D', 'E2', 'm_orphan');
    const graph = reconstructGraph([...p1, orphan]);
    const orphans = detectOrphans(graph);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.dirName).toBe('m_orphan');
  });

  it('reports no orphans for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(detectOrphans(graph)).toEqual([]);
  });

  it('reports no orphans when root chain starts from non-empty hash', () => {
    const packages = chain(['H0', 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectOrphans(graph)).toEqual([]);
  });
});
