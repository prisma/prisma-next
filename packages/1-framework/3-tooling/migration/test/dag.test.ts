import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { describe, expect, it } from 'vitest';
import { computeMigrationId } from '../src/attestation';
import {
  detectCycles,
  detectOrphans,
  findLatestMigration,
  findLeaf,
  findPath,
  findPathWithDecision,
  findReachableLeaves,
  reconstructGraph,
} from '../src/dag';
import { MigrationToolsError } from '../src/errors';
import type { AttestedMigrationBundle } from '../src/types';
import { createAttestedManifest, createTestOps } from './fixtures';

let migrationCounter = 0;

function pkg(
  from: string,
  to: string,
  dirName: string,
  createdAt = '2026-02-25T14:00:00.000Z',
  labels: readonly string[] = [],
): AttestedMigrationBundle {
  const manifest = createAttestedManifest({ from, to, createdAt, labels });
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

function chain(...specs: Array<[string, string, string]>): AttestedMigrationBundle[] {
  return specs.map(([from, to, dirName]) => pkg(from!, to!, dirName!));
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

  it('builds migrationById index', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(graph.migrationById.size).toBe(2);
  });

  it('rejects same source and target with code MIGRATION.SAME_SOURCE_AND_TARGET', () => {
    try {
      reconstructGraph([pkg('H1', 'H1', 'm1')]);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.SAME_SOURCE_AND_TARGET');
      expect(mte.category).toBe('MIGRATION');
      expect(mte.details).toHaveProperty('dirName', 'm1');
      expect(mte.details).toHaveProperty('hash', 'H1');
      expect(mte.fix).toBeTruthy();
    }
  });

  it('rejects duplicate migrationId values', () => {
    const first = pkg(E, 'H1', 'm1');
    const secondBase = pkg('H1', 'H2', 'm2');
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

  it('throws NO_TARGET on cycle-without-exit (A→B→A)', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H1', 'm3']);
    const graph = reconstructGraph(packages);
    try {
      findLeaf(graph);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.NO_TARGET');
      expect(mte.fix).toContain('--from');
      expect(mte.details).toHaveProperty('reachableHashes');
    }
  });

  it('handles cycle with an exit node', () => {
    const packages = chain(
      [E, 'H1', 'm1'],
      ['H1', 'H2', 'm2'],
      ['H2', 'H1', 'm3'],
      ['H1', 'H3', 'm4'],
    );
    const graph = reconstructGraph(packages);
    expect(findLeaf(graph)).toBe('H3');
  });

  it('errors on branching with code MIGRATION.AMBIGUOUS_TARGET', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2a', 'm2a'], ['H1', 'H2b', 'm2b']);
    const graph = reconstructGraph(packages);
    try {
      findLeaf(graph);
      expect.fail('expected error');
    } catch (e) {
      expect(MigrationToolsError.is(e)).toBe(true);
      const mte = e as MigrationToolsError;
      expect(mte.code).toBe('MIGRATION.AMBIGUOUS_TARGET');
      expect(mte.category).toBe('MIGRATION');
      expect(mte.details).toHaveProperty('branchTips');
      expect(mte.fix).toContain('--from');
    }
  });
});

describe('findReachableLeaves', () => {
  it('returns single leaf for linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(findReachableLeaves(graph, E)).toEqual(['H2']);
  });

  it('returns multiple leaves for branching graph', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H1', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    const leaves = findReachableLeaves(graph, E);
    expect(leaves).toHaveLength(2);
    expect(leaves).toContain('H2');
    expect(leaves).toContain('H3');
  });

  it('returns start node if it has no outgoing edges', () => {
    const graph = reconstructGraph([]);
    expect(findReachableLeaves(graph, 'orphan')).toEqual(['orphan']);
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

  it('finds shortest path when multiple paths exist', () => {
    const packages = [
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
      pkg('H1', 'H3', 'm_shortcut'),
    ];
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H3');
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path![0]!.dirName).toBe('m_shortcut');
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

  it('uses deterministic tie-breaking (createdAt ascending)', () => {
    const early = pkg('H1', 'H2', 'm_early', '2026-01-01T00:00:00.000Z');
    const late = pkg('H1', 'H2', 'm_late', '2026-12-01T00:00:00.000Z');
    const graph = reconstructGraph([pkg(E, 'H1', 'm0'), early, late]);
    const path = findPath(graph, 'H1', 'H2');
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path![0]!.dirName).toBe('m_early');
  });
});

describe('detectCycles', () => {
  it('reports no cycles in linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects cycle in node graph', () => {
    const packages: AttestedMigrationBundle[] = [
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

describe('findPathWithDecision', () => {
  it('returns no-op decision when from === to', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, 'H1', 'H1');
    expect(decision).not.toBeNull();
    expect(decision!.selectedPath).toEqual([]);
    expect(decision!.fromHash).toBe('H1');
    expect(decision!.toHash).toBe('H1');
    expect(decision!.alternativeCount).toBe(0);
    expect(decision!.tieBreakReasons).toEqual([]);
  });

  it('returns null when no path exists', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(findPathWithDecision(graph, 'H1', 'H99')).toBeNull();
  });

  it('includes ref metadata when provided', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, 'H1', 'H2', 'production');
    expect(decision).not.toBeNull();
    expect(decision!.refName).toBe('production');
  });

  it('omits ref metadata when not provided', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, 'H1', 'H2');
    expect(decision).not.toBeNull();
    expect(decision!.refName).toBeUndefined();
  });

  it('reports alternative count for converging paths', () => {
    const packages = [
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
      pkg('H1', 'H3', 'm_shortcut'),
    ];
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, 'H1', 'H3');
    expect(decision).not.toBeNull();
    expect(decision!.selectedPath).toHaveLength(1);
    expect(decision!.alternativeCount).toBeGreaterThan(0);
  });

  it('output shape matches expected keys', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, E, 'H2', 'staging');
    expect(decision).not.toBeNull();
    expect(Object.keys(decision!).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "refName",
        "selectedPath",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });

  it('output shape without ref matches expected keys', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const decision = findPathWithDecision(graph, E, 'H1');
    expect(decision).not.toBeNull();
    expect(Object.keys(decision!).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "selectedPath",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });
});
