import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import type { MigrationChainEntry, MigrationGraph } from '@prisma-next/migration-tools/types';
import { describe, expect, it } from 'vitest';
import { deriveEdgeStatuses } from '../../src/commands/migration-status';

function entry(from: string, to: string, dirName: string): MigrationChainEntry {
  return { from, to, dirName, migrationId: `mid_${dirName}`, createdAt: '', labels: [] };
}

function buildGraph(entries: MigrationChainEntry[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationById = new Map<string, MigrationChainEntry>();

  for (const e of entries) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!forwardChain.has(e.from)) forwardChain.set(e.from, []);
    forwardChain.get(e.from)!.push(e);
    if (!reverseChain.has(e.to)) reverseChain.set(e.to, []);
    reverseChain.get(e.to)!.push(e);
    migrationById.set(e.migrationId, e);
  }

  return { nodes, forwardChain, reverseChain, migrationById };
}

const ROOT = EMPTY_CONTRACT_HASH;

describe('deriveEdgeStatuses', () => {
  // Verifies the early return: offline mode has no DB connection,
  // so no status can be determined.
  it('returns empty array in offline mode', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1')]);
    expect(deriveEdgeStatuses(graph, 'A', 'A', 'A', 'offline')).toEqual([]);
  });

  // ROOT → A → B → C
  // marker=A, target=C, contract=C
  //
  // Exercises the core split: edges before the marker are applied,
  // edges after are pending. No branching, so nothing is unreachable.
  describe('linear chain — marker mid-chain', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('B', 'C', 'm3'),
    ]);

    it('marks edges before marker as applied', () => {
      const result = deriveEdgeStatuses(graph, 'C', 'C', 'A', 'online');
      const applied = result.filter((e) => e.status === 'applied');
      expect(applied.map((e) => e.dirName)).toEqual(['m1']);
    });

    it('marks edges after marker as pending', () => {
      const result = deriveEdgeStatuses(graph, 'C', 'C', 'A', 'online');
      const pending = result.filter((e) => e.status === 'pending');
      expect(pending.map((e) => e.dirName)).toEqual(['m2', 'm3']);
    });

    it('produces no unreachable edges', () => {
      const result = deriveEdgeStatuses(graph, 'C', 'C', 'A', 'online');
      expect(result.filter((e) => e.status === 'unreachable')).toEqual([]);
    });
  });

  // ROOT → A → B
  // marker=undefined, target=B, contract=B
  //
  // When the DB is empty, markerHash is undefined. The function uses
  // effectiveMarker = ROOT (so pendingPath = ROOT→B), and appliedPath
  // is explicitly null (no marker means nothing was applied).
  describe('empty DB — marker undefined', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);

    it('marks all edges as pending', () => {
      const result = deriveEdgeStatuses(graph, 'B', 'B', undefined, 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'pending' },
        { dirName: 'm2', status: 'pending' },
      ]);
    });
  });

  // ROOT → A → B
  // marker=ROOT, target=B, contract=B
  //
  // Different code path from undefined marker: appliedPath is ROOT→ROOT
  // (zero-length, no edges), pendingPath is ROOT→B. Should produce the
  // same result as undefined marker — all pending, nothing applied.
  describe('empty DB — marker equals root', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);

    it('marks all edges as pending (same as undefined marker)', () => {
      const result = deriveEdgeStatuses(graph, 'B', 'B', ROOT, 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'pending' },
        { dirName: 'm2', status: 'pending' },
      ]);
    });
  });

  // ROOT → A → B
  // marker=B, target=B, contract=B
  //
  // All migrations have been applied. appliedPath covers ROOT→A→B,
  // pendingPath is B→B (zero-length). Verifies the "up to date" state.
  describe('fully applied — marker at target', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);

    it('marks all edges as applied with no pending', () => {
      const result = deriveEdgeStatuses(graph, 'B', 'B', 'B', 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'applied' },
        { dirName: 'm2', status: 'applied' },
      ]);
    });
  });

  // ROOT → A ─┬→ B (marker)
  //            └→ C → D (target)
  // marker=B, target=D, contract=D
  //
  // The marker is on a different branch than the target. apply cannot
  // reach the target without first moving the DB to this branch.
  // - ROOT→A→B is the appliedPath
  // - pendingPath from B→D is null (no path between branches)
  // - targetPath ROOT→A→C→D has m1 (already applied via assignedKeys),
  //   m3 and m4 are unreachable
  describe('branching — marker on different branch', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('A', 'C', 'm3'),
      entry('C', 'D', 'm4'),
    ]);

    it('marks root→marker as applied', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'B', 'online');
      const applied = result.filter((e) => e.status === 'applied');
      expect(applied.map((e) => e.dirName)).toEqual(['m1', 'm2']);
    });

    it('marks edges on target branch as unreachable', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'B', 'online');
      const unreachable = result.filter((e) => e.status === 'unreachable');
      expect(unreachable.map((e) => e.dirName)).toEqual(['m3', 'm4']);
    });

    it('produces no pending edges', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'B', 'online');
      expect(result.filter((e) => e.status === 'pending')).toEqual([]);
    });
  });

  // ROOT → A ─┬→ B ─┐
  //            └→ C ─┘→ D
  // marker=A, target=D, contract=D
  //
  // Diamond topology: two paths from A to D. pendingPath picks one
  // route (say A→B→D). targetPath (ROOT→A→...→D) may pick a different
  // route. The assignedKeys set prevents m1 (ROOT→A) from being
  // double-counted as both applied and unreachable. Edges on the
  // unchosen branch of the diamond get marked unreachable.
  describe('diamond — deduplication via assignedKeys', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('A', 'C', 'm3'),
      entry('B', 'D', 'm4'),
      entry('C', 'D', 'm5'),
    ]);

    it('does not double-count shared edges', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'A', 'online');

      // m1 must appear exactly once (applied), never as unreachable
      const m1 = result.filter((e) => e.dirName === 'm1');
      expect(m1).toEqual([{ dirName: 'm1', status: 'applied' }]);

      // All edges accounted for — no dirName appears twice
      const dirNames = result.map((e) => e.dirName);
      expect(dirNames.length).toBe(new Set(dirNames).size);
    });

    // targetPath (ROOT→D) uses BFS which picks the same route as
    // pendingPath. The unchosen branch is never visited by any path
    // computation, so it gets no status at all (not even unreachable).
    // This is correct: unreachable means "on a path to the target but
    // not reachable from the marker." Edges on neither path are simply
    // unlabeled and rendered unstyled.
    it('leaves the unchosen diamond branch unlabeled', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'A', 'online');
      const labeled = new Set(result.map((e) => e.dirName));

      // One A→D route is pending (2 edges), the other has no status
      const pending = result.filter((e) => e.status === 'pending');
      expect(pending.length).toBe(2);

      // Exactly 3 edges labeled: m1 (applied) + 2 pending
      expect(labeled.size).toBe(3);
    });
  });

  // ROOT → A → B(ref/target) → C(contract)
  // marker=A, target=B, contract=C
  //
  // When --ref points to a node before the contract, the target is the
  // ref but the contract is further along. The "beyondTarget" logic
  // (target→contract) marks those extra edges as pending too.
  describe('ref target with contract beyond', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('B', 'C', 'm3'),
    ]);

    it('marks edges beyond target as pending when contract is reachable', () => {
      const result = deriveEdgeStatuses(graph, 'B', 'C', 'A', 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'applied' },
        { dirName: 'm2', status: 'pending' },
        { dirName: 'm3', status: 'pending' },
      ]);
    });
  });

  // ROOT → A → B(target)
  // marker=A, target=B, contract='off-graph-contract'
  //
  // The contract hash is not a node in the graph (user changed the
  // contract but hasn't planned a migration yet). The beyondTarget
  // check requires graph.nodes.has(contractHash), which fails —
  // no extra edges are added.
  describe('contract not in graph', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);

    it('does not add extra pending edges for off-graph contract', () => {
      const result = deriveEdgeStatuses(graph, 'B', 'off-graph-contract', 'A', 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'applied' },
        { dirName: 'm2', status: 'pending' },
      ]);
    });
  });
});
