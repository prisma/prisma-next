import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { describe, expect, it } from 'vitest';
import { deriveEdgeStatuses } from '../../src/commands/migration-status';
import { buildGraph, entry } from '../utils/graph-helpers';

const ROOT = EMPTY_CONTRACT_HASH;

describe('deriveEdgeStatuses', () => {
  // No DB connection means we can't know what's applied.
  it('returns empty array in offline mode', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1')]);
    expect(deriveEdgeStatuses(graph, 'A', 'A', 'A', 'offline')).toEqual([]);
  });

  // The most common scenario: user has applied some migrations and
  // has more waiting. The marker splits the chain into applied/pending.
  //
  // ROOT → A → B → C, marker=A, target=C
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

  // Fresh database — no migrations ever applied. Everything is pending.
  // This uses the effectiveMarker fallback (ROOT) since markerHash is undefined.
  //
  // ROOT → A → B, marker=undefined, target=B
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

  // Database is fully up to date — nothing to apply.
  //
  // ROOT → A → B, marker=B, target=B
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

  // The DB went down one branch but the target is on another.
  // `apply` cannot reach the target without first switching branches,
  // so those edges are unreachable.
  //
  // ROOT → A ─┬→ B (marker)
  //            └→ C → D (target)
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

  // Diamond: two routes from A to D. BFS picks one for pending, the
  // other is never traversed. The shared prefix (ROOT→A) must not be
  // double-counted — assignedKeys prevents an edge from being labeled
  // both applied and unreachable.
  //
  // ROOT → A ─┬→ B ─┐
  //            └→ C ─┘→ D
  describe('diamond — shared edges not double-counted', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('A', 'C', 'm3'),
      entry('B', 'D', 'm4'),
      entry('C', 'D', 'm5'),
    ]);

    it('labels the shared edge exactly once', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'A', 'online');
      const m1 = result.filter((e) => e.dirName === 'm1');
      expect(m1).toEqual([{ dirName: 'm1', status: 'applied' }]);

      const dirNames = result.map((e) => e.dirName);
      expect(dirNames.length).toBe(new Set(dirNames).size);
    });

    // BFS picks a single route to D for both pendingPath and targetPath,
    // so the other branch is never visited — it gets no label at all.
    // This is intentional: unlabeled edges render unstyled in the graph.
    it('leaves the unchosen branch unlabeled', () => {
      const result = deriveEdgeStatuses(graph, 'D', 'D', 'A', 'online');
      const pending = result.filter((e) => e.status === 'pending');
      expect(pending.length).toBe(2);
      expect(result.length).toBe(3); // 1 applied + 2 pending
    });
  });

  // When --ref targets a node before the contract, migrations between
  // the ref and contract are still pending — the user needs them applied
  // to reach the contract state.
  //
  // ROOT → A → B(ref/target) → C(contract), marker=A
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

  // No contract has been emitted yet (contractHash is the empty sentinel).
  // The beyondTarget logic is skipped entirely — there's nothing beyond
  // the target to check. Only the normal applied/pending split applies.
  //
  // ROOT → A → B(target), contract=ROOT (empty), marker=A
  describe('no contract emitted — empty contract hash', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);

    it('does not attempt beyondTarget extension', () => {
      const result = deriveEdgeStatuses(graph, 'B', ROOT, 'A', 'online');
      expect(result).toEqual([
        { dirName: 'm1', status: 'applied' },
        { dirName: 'm2', status: 'pending' },
      ]);
    });
  });

  // User changed the contract but hasn't planned a migration yet.
  // The contract hash doesn't exist in the graph, so the beyondTarget
  // logic has nothing to extend — only the normal applied/pending split applies.
  //
  // ROOT → A → B(target), contract='off-graph-contract', marker=A
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
