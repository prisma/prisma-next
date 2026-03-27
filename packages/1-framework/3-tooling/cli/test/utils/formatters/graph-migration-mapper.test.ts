import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { describe, expect, it } from 'vitest';
import {
  type MigrationGraphInput,
  migrationGraphToRenderInput,
} from '../../../src/utils/formatters/graph-migration-mapper';
import { buildGraph, entry } from '../graph-helpers';

const ROOT = EMPTY_CONTRACT_HASH;

function sid(hash: string): string {
  return hash === ROOT ? '∅' : hash.slice(0, 7);
}

function makeInput(
  overrides: Partial<MigrationGraphInput> & Pick<MigrationGraphInput, 'graph'>,
): MigrationGraphInput {
  return {
    mode: 'offline',
    contractHash: EMPTY_CONTRACT_HASH,
    ...overrides,
  };
}

describe('migrationGraphToRenderInput', () => {
  // ROOT→A→B→C, marker=A, contract=C.
  // Verifies status icons are baked into labels, colorHints propagate,
  // db/contract markers are placed on the right nodes, relevant paths
  // cover the full chain, and spineTarget resolves to the contract.
  it('linear chain — marker mid-chain bakes status icons and markers', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry('A', 'B', 'm2'),
      entry('B', 'C', 'm3'),
    ]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'A',
        contractHash: 'C',
        edgeStatuses: [
          { dirName: 'm1', status: 'applied' },
          { dirName: 'm2', status: 'pending' },
          { dirName: 'm3', status: 'pending' },
        ],
      }),
    );

    expect(result.graph.edges.map((e) => e.label)).toEqual(['m1 ✓', 'm2 ⧗', 'm3 ⧗']);
    expect(result.graph.edges.map((e) => e.colorHint)).toEqual(['applied', 'pending', 'pending']);

    const nodeA = result.graph.nodes.find((n) => n.id === sid('A'));
    expect(nodeA?.markers).toContainEqual({ kind: 'db' });

    const nodeC = result.graph.nodes.find((n) => n.id === sid('C'));
    expect(nodeC?.markers).toContainEqual({ kind: 'contract', planned: true });

    // root→marker + marker→contract
    expect(result.relevantPaths).toContainEqual(['∅', sid('A')]);
    expect(result.relevantPaths).toContainEqual([sid('A'), sid('B'), sid('C')]);

    expect(result.options.spineTarget).toBe(sid('C'));
  });

  // Diamond: ROOT→A→C and ROOT→B→C, marker=A, ref=B, contract=C.
  // Both marker→C and ref→C paths are tried independently so both legs
  // of the diamond are visible in the default view.
  // Ref marker appears on node B. spineTarget resolves to ref (B), not contract.
  it('diamond — both marker and ref reach contract via different paths', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry(ROOT, 'B', 'm2'),
      entry('A', 'C', 'm3'),
      entry('B', 'C', 'm4'),
    ]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'A',
        contractHash: 'C',
        activeRefHash: 'B',
        refs: [{ name: 'production', hash: 'B', active: true }],
      }),
    );

    // Separate paths for each leg
    expect(result.relevantPaths).toContainEqual(['∅', sid('A')]);
    expect(result.relevantPaths).toContainEqual(['∅', sid('B')]);
    expect(result.relevantPaths).toContainEqual([sid('A'), sid('C')]);
    expect(result.relevantPaths).toContainEqual([sid('B'), sid('C')]);

    // Ref marker on node B
    const nodeB = result.graph.nodes.find((n) => n.id === sid('B'));
    expect(nodeB?.markers).toContainEqual({ kind: 'ref', name: 'production', active: true });

    // spineTarget prefers ref over contract
    expect(result.options.spineTarget).toBe(sid('B'));
  });

  // Marker is on branch A, contract is at the end of branch B.
  // marker→contract has no path, so the fallback root→contract fires.
  it('unreachable contract — falls back to root→contract path', () => {
    const graph = buildGraph([
      entry(ROOT, 'A', 'm1'),
      entry(ROOT, 'B', 'm2'),
      entry('B', 'C', 'm3'),
    ]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'A',
        contractHash: 'C',
      }),
    );

    // root→marker path
    expect(result.relevantPaths).toContainEqual(['∅', sid('A')]);
    // root→contract fallback (marker can't reach contract)
    expect(result.relevantPaths).toContainEqual(['∅', sid('B'), sid('C')]);

    expect(result.options.spineTarget).toBe(sid('C'));
  });

  // No marker, no ref, no contract — nothing targeted.
  // Falls back to the last edge's `to` node via root path.
  it('no targets — falls back to last edge in forwardChain', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        contractHash: EMPTY_CONTRACT_HASH,
      }),
    );

    expect(result.relevantPaths).toHaveLength(1);
    expect(result.relevantPaths[0]).toEqual(['∅', sid('A'), sid('B')]);

    expect(result.options.spineTarget).toBe(sid('B'));
  });

  // Offline mode ignores markerHash for db markers and omits status icons.
  it('offline mode — no db markers or status icons', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'offline',
        markerHash: 'A',
        contractHash: 'B',
      }),
    );

    const allMarkers = result.graph.nodes.flatMap((n) => n.markers ?? []);
    expect(allMarkers.filter((m) => m.kind === 'db')).toHaveLength(0);

    for (const edge of result.graph.edges) {
      expect(edge.label).not.toMatch(/[✓⧗✗]/);
      expect(edge.colorHint).toBeUndefined();
    }
  });

  // No edgeStatuses provided — edges get bare labels without icons or colorHints.
  it('edges without status — no icon, no colorHint', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1'), entry('A', 'B', 'm2')]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'B',
        contractHash: 'B',
      }),
    );

    expect(result.graph.edges.map((e) => e.label)).toEqual(['m1', 'm2']);
    for (const edge of result.graph.edges) {
      expect(edge.colorHint).toBeUndefined();
    }
  });

  // Contract hash not in graph — a detached node is created with
  // planned:false (contract exists but no migration targets it yet).
  it('detached contract node — contract not in graph', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1')]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'A',
        contractHash: 'DETACHED_HASH',
      }),
    );

    const detached = result.graph.nodes.find((n) => n.style === 'detached');
    expect(detached).toBeDefined();
    expect(detached!.markers).toContainEqual({ kind: 'contract', planned: false });
  });

  // marker === contract, both off-graph. The single detached node should
  // carry both db and contract markers.
  it('detached contract matching db marker — both markers on one node', () => {
    const graph = buildGraph([entry(ROOT, 'A', 'm1')]);
    const result = migrationGraphToRenderInput(
      makeInput({
        graph,
        mode: 'online',
        markerHash: 'OFF_GRAPH',
        contractHash: 'OFF_GRAPH',
      }),
    );

    const detached = result.graph.nodes.find((n) => n.style === 'detached');
    expect(detached).toBeDefined();
    expect(detached!.markers).toContainEqual({ kind: 'db' });
    expect(detached!.markers).toContainEqual({ kind: 'contract', planned: false });
  });
});
