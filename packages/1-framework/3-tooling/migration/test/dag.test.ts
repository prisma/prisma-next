import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/abstract-ops';
import { describe, expect, it } from 'vitest';
import { detectCycles, detectOrphans, findLeaf, findPath, reconstructGraph } from '../src/dag';
import type { MigrationPackage } from '../src/types';
import { createTestManifest, createTestOps } from './fixtures';

function pkg(
  from: string,
  to: string,
  dirName: string,
  createdAt = '2026-02-25T14:00:00.000Z',
): MigrationPackage {
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    manifest: createTestManifest({ from, to, createdAt }),
    ops: createTestOps(),
  };
}

const E = EMPTY_CONTRACT_HASH;

describe('reconstructGraph', () => {
  it('builds graph from single migration', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has(E)).toBe(true);
    expect(graph.nodes.has('H1')).toBe(true);
    expect(graph.edges.get(E)).toHaveLength(1);
    expect(graph.reverseEdges.get('H1')).toHaveLength(1);
  });

  it('builds graph from empty packages', () => {
    const graph = reconstructGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.edges.size).toBe(0);
  });

  it('builds graph from linear chain', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
    ]);
    expect(graph.nodes.size).toBe(4);
    expect(graph.edges.get(E)).toHaveLength(1);
    expect(graph.edges.get('H1')).toHaveLength(1);
    expect(graph.edges.get('H2')).toHaveLength(1);
  });

  it('rejects self-loop', () => {
    expect(() => reconstructGraph([pkg('H1', 'H1', 'm1')])).toThrow(/self-loop/i);
  });
});

describe('findLeaf', () => {
  it('returns EMPTY_CONTRACT_HASH for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(findLeaf(graph)).toBe(E);
  });

  it('returns H1 for single migration', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    expect(findLeaf(graph)).toBe('H1');
  });

  it('returns H3 for linear chain', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
    ]);
    expect(findLeaf(graph)).toBe('H3');
  });

  it('errors on branching (ambiguous leaves)', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2a', 'm2a'),
      pkg('H1', 'H2b', 'm2b'),
    ]);
    expect(() => findLeaf(graph)).toThrow(/ambiguous|multiple/i);
  });
});

describe('findPath', () => {
  it('finds path in linear chain', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
    ]);
    const path = findPath(graph, E, 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns null when no path exists', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    const path = findPath(graph, E, 'H99');
    expect(path).toBeNull();
  });

  it('returns empty array when from === to', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    const path = findPath(graph, 'H1', 'H1');
    expect(path).toEqual([]);
  });

  it('uses deterministic tie-breaking by createdAt', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2a', 'm2a', '2026-02-25T15:00:00.000Z'),
      pkg('H1', 'H2b', 'm2b', '2026-02-25T14:00:00.000Z'),
      pkg('H2b', 'H3', 'm3'),
    ]);
    const path = findPath(graph, E, 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2b', 'm3']);
  });
});

describe('detectCycles', () => {
  it('reports no cycles in linear chain', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1'), pkg('H1', 'H2', 'm2')]);
    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects cycle', () => {
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
    const graph = reconstructGraph([pkg(E, 'H1', 'm1'), pkg('H1', 'H2', 'm2')]);
    expect(detectOrphans(graph)).toEqual([]);
  });

  it('detects orphan edge', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1'), pkg('D', 'E2', 'm_orphan')]);
    const orphans = detectOrphans(graph);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.dirName).toBe('m_orphan');
  });

  it('reports no orphans for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(detectOrphans(graph)).toEqual([]);
  });
});
