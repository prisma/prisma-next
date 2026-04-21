import { describe, expect, it } from 'vitest';
import { bfs } from '../src/graph-ops';

/**
 * Fixture: a tiny explicit edge list. Encoded as (from → to).
 *   A → B
 *   A → C
 *   B → D
 *   C → D
 *   D → E
 */
interface TestEdge {
  readonly from: string;
  readonly to: string;
  readonly label?: string;
}

function forward(edges: readonly TestEdge[]) {
  return (node: string): Iterable<{ next: string; edge: TestEdge }> => {
    return edges.filter((e) => e.from === node).map((e) => ({ next: e.to, edge: e }));
  };
}

function reverse(edges: readonly TestEdge[]) {
  return (node: string): Iterable<{ next: string; edge: TestEdge }> => {
    return edges.filter((e) => e.to === node).map((e) => ({ next: e.from, edge: e }));
  };
}

const sampleEdges: readonly TestEdge[] = [
  { from: 'A', to: 'B' },
  { from: 'A', to: 'C' },
  { from: 'B', to: 'D' },
  { from: 'C', to: 'D' },
  { from: 'D', to: 'E' },
];

describe('bfs', () => {
  it('visits every reachable node exactly once starting from a single root', () => {
    const visited: string[] = [];
    for (const step of bfs(['A'], forward(sampleEdges))) {
      visited.push(step.node);
    }
    expect(visited.sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('yields the starting node with parent=null and incomingEdge=null', () => {
    const first = bfs(['A'], forward(sampleEdges)).next();
    expect(first.done).toBe(false);
    if (first.done) return;
    expect(first.value.node).toBe('A');
    expect(first.value.parent).toBeNull();
    expect(first.value.incomingEdge).toBeNull();
  });

  it('yields parent and incomingEdge for non-start nodes', () => {
    const steps = [...bfs(['A'], forward(sampleEdges))];
    const b = steps.find((s) => s.node === 'B');
    expect(b?.parent).toBe('A');
    expect(b?.incomingEdge).toEqual({ from: 'A', to: 'B' });
  });

  it('supports multiple start nodes', () => {
    // Two disconnected components: A→B and X→Y.
    const edges: readonly TestEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'X', to: 'Y' },
    ];
    const visited = new Set<string>();
    for (const step of bfs(['A', 'X'], forward(edges))) {
      visited.add(step.node);
    }
    expect(visited).toEqual(new Set(['A', 'B', 'X', 'Y']));
  });

  it('supports reverse traversal when neighbours return incoming edges', () => {
    // Start at E and walk back to A via reverse edges.
    const visited: string[] = [];
    for (const step of bfs(['E'], reverse(sampleEdges))) {
      visited.push(step.node);
    }
    expect(visited.sort()).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('reaches target via shortest path when ordering is applied', () => {
    // Diamond A→B→D and A→C→D. Ordering prefers edges labelled 'main'.
    const edges: readonly TestEdge[] = [
      { from: 'A', to: 'B', label: 'feature' },
      { from: 'A', to: 'C', label: 'main' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
    ];
    const preferMain = (
      items: readonly { next: string; edge: TestEdge }[],
    ): readonly { next: string; edge: TestEdge }[] =>
      items.slice().sort((a, b) => {
        if (a.edge.label === 'main' && b.edge.label !== 'main') return -1;
        if (b.edge.label === 'main' && a.edge.label !== 'main') return 1;
        return 0;
      });

    const steps = [...bfs(['A'], forward(edges), preferMain)];
    const dStep = steps.find((s) => s.node === 'D');
    // D's parent must be C (via main), not B (via feature), because main was
    // pushed first.
    expect(dStep?.parent).toBe('C');
  });

  it('does not revisit nodes in a cyclic graph', () => {
    const edges: readonly TestEdge[] = [
      { from: 'A', to: 'B' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'A' }, // back-edge
    ];
    const visited: string[] = [];
    for (const step of bfs(['A'], forward(edges))) {
      visited.push(step.node);
    }
    expect(visited).toEqual(['A', 'B', 'C']);
  });

  it('supports early termination via break', () => {
    const visited: string[] = [];
    for (const step of bfs(['A'], forward(sampleEdges))) {
      visited.push(step.node);
      if (step.node === 'B') break;
    }
    // We should have seen A and then B (or A, C, B depending on order) —
    // but certainly not D or E.
    expect(visited).toContain('A');
    expect(visited).toContain('B');
    expect(visited).not.toContain('D');
    expect(visited).not.toContain('E');
  });

  it('yields nothing when starts is empty', () => {
    const visited: string[] = [];
    for (const step of bfs([], forward(sampleEdges))) {
      visited.push(step.node);
    }
    expect(visited).toEqual([]);
  });

  it('deduplicates start nodes', () => {
    const visited: string[] = [];
    for (const step of bfs(['A', 'A', 'A'], forward(sampleEdges))) {
      visited.push(step.node);
    }
    // A should appear exactly once at the start.
    expect(visited.filter((n) => n === 'A')).toHaveLength(1);
  });
});
