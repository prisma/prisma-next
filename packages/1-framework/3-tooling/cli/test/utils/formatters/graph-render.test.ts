import { describe, expect, it } from 'vitest';
import {
  extractRelevantSubgraph,
  extractSubgraph,
  graphRenderer,
  isLinearGraph,
  truncateGraph,
} from '../../../src/utils/formatters/graph-render';
import { RenderGraph } from '../../../src/utils/formatters/graph-types';
import type { TestGraph } from './test-graphs';
import {
  allGraphs,
  diamond,
  linearChain,
  longSpineOnGraphContract,
  longSpineWithBranches,
  singleBranch,
} from './test-graphs';

function renderNoColor(graph: TestGraph) {
  return graphRenderer.render(graph.graph, {
    ...graph.options,
    colorize: false,
  });
}

describe('Graph renderer — render full graph', () => {
  for (const graph of allGraphs) {
    it(`renders ${graph.name}`, () => {
      const output = renderNoColor(graph);
      expect(output).toMatchSnapshot();
    });
  }

  it('produces deterministic output', () => {
    const a = renderNoColor(diamond);
    const b = renderNoColor(diamond);
    expect(a).toBe(b);
  });

  it('renders without color codes when colorize is false', () => {
    const output = renderNoColor(linearChain);
    expect(output).not.toContain('\x1b[');
  });
});

describe('Graph renderer — render extracted subgraph', () => {
  it('extracts and renders spine from branching graph', () => {
    const spine = ['∅', 'A', 'B', 'C'];
    const sub = extractSubgraph(singleBranch.graph, spine);
    const output = graphRenderer.render(sub, {
      ...singleBranch.options,
      colorize: false,
    });
    expect(output).toMatchSnapshot();
    expect(output).toContain('A');
    expect(output).toContain('B');
    expect(output).toContain('C');
    expect(output).not.toContain('X');
    expect(output).not.toContain('Y');
  });

  it('preserves markers on spine nodes', () => {
    const spine = ['∅', 'abc1234', '7e1b9a0', 'f03da82'];
    const sub = extractSubgraph(linearChain.graph, spine);
    const output = graphRenderer.render(sub, {
      ...linearChain.options,
      colorize: false,
    });
    expect(output).toContain('◆ db');
    expect(output).toContain('prod');
  });
});

describe('extractSubgraph', () => {
  it('filters to path nodes and edges only', () => {
    const path = ['∅', 'A', 'B', 'C'];
    const sub = extractSubgraph(singleBranch.graph, path);
    expect(sub.nodes.map((n) => n.id)).toEqual(['∅', 'A', 'B', 'C']);
    expect(sub.edges).toHaveLength(3);
    expect(sub.edges.every((e) => path.includes(e.from) && path.includes(e.to))).toBe(true);
  });

  it('preserves node markers', () => {
    const path = ['∅', 'A', 'B', 'C'];
    const sub = extractSubgraph(singleBranch.graph, path);
    const nodeC = sub.nodes.find((n) => n.id === 'C');
    expect(nodeC?.markers).toBeDefined();
    expect(nodeC?.markers?.[0]).toEqual({ kind: 'ref', name: 'prod', active: true });
  });

  it('returns empty for non-existent path', () => {
    const sub = extractSubgraph(singleBranch.graph, ['nonexistent']);
    expect(sub.nodes).toHaveLength(0);
    expect(sub.edges).toHaveLength(0);
  });
});

describe('extractRelevantSubgraph', () => {
  it('unions multiple paths into a single subgraph', () => {
    // singleBranch: ∅→A→B→C (spine) and A→X→Y (branch)
    const path1 = ['∅', 'A', 'B', 'C'];
    const path2 = ['∅', 'A', 'X', 'Y'];
    const sub = extractRelevantSubgraph(singleBranch.graph, [path1, path2]);
    const nodeIds = sub.nodes.map((n) => n.id);
    expect(nodeIds).toContain('∅');
    expect(nodeIds).toContain('A');
    expect(nodeIds).toContain('B');
    expect(nodeIds).toContain('C');
    expect(nodeIds).toContain('X');
    expect(nodeIds).toContain('Y');
    expect(sub.edges).toHaveLength(5);
  });

  it('deduplicates shared prefix nodes and edges', () => {
    const path1 = ['∅', 'A', 'B', 'C'];
    const path2 = ['∅', 'A', 'B'];
    const sub = extractRelevantSubgraph(singleBranch.graph, [path1, path2]);
    const nodeIds = sub.nodes.map((n) => n.id);
    expect(nodeIds).toEqual(['∅', 'A', 'B', 'C']);
    expect(sub.edges).toHaveLength(3);
  });

  it('produces identical result to extractSubgraph for a single path', () => {
    const path = ['∅', 'A', 'B', 'C'];
    const single = extractSubgraph(singleBranch.graph, path);
    const multi = extractRelevantSubgraph(singleBranch.graph, [path]);
    expect(multi.nodes.map((n) => n.id)).toEqual(single.nodes.map((n) => n.id));
    expect(multi.edges).toHaveLength(single.edges.length);
  });

  it('preserves detached nodes', () => {
    const path = ['∅', 'A'];
    const graph = new RenderGraph(
      [{ id: '∅' }, { id: 'A' }, { id: 'detached', style: 'detached' }],
      [{ from: '∅', to: 'A' }],
    );
    const sub = extractRelevantSubgraph(graph, [path]);
    expect(sub.nodes.some((n) => n.id === 'detached')).toBe(true);
  });

  it('returns empty for no paths', () => {
    const sub = extractRelevantSubgraph(singleBranch.graph, []);
    expect(sub.nodes).toHaveLength(0);
    expect(sub.edges).toHaveLength(0);
  });

  it('preserves node markers across paths', () => {
    const path1 = ['∅', 'A', 'B', 'C'];
    const path2 = ['∅', 'A', 'X', 'Y'];
    const sub = extractRelevantSubgraph(singleBranch.graph, [path1, path2]);
    const nodeC = sub.nodes.find((n) => n.id === 'C');
    expect(nodeC?.markers?.[0]).toEqual({ kind: 'ref', name: 'prod', active: true });
    const nodeY = sub.nodes.find((n) => n.id === 'Y');
    expect(nodeY?.markers?.[0]).toMatchObject({ kind: 'ref', name: 'staging' });
  });
});

// ---------------------------------------------------------------------------
// Truncation
// ---------------------------------------------------------------------------

const longSpine = [
  '∅',
  'S01',
  'S02',
  'S03',
  'S04',
  'S05',
  'S06',
  'S07',
  'S08',
  'S09',
  'S10',
  'S11',
  'S12',
  'S13',
  'S14',
];

describe('truncateGraph', () => {
  it('returns original when limit >= spine length', () => {
    const result = truncateGraph(longSpineWithBranches.graph, longSpine, 20);
    expect(result.elidedCount).toBe(0);
    expect(result.spine).toEqual(longSpine);
    expect(result.graph.nodes).toBe(longSpineWithBranches.graph.nodes);
  });

  it('returns original when limit equals spine edge count', () => {
    const result = truncateGraph(longSpineWithBranches.graph, longSpine, 14);
    expect(result.elidedCount).toBe(0);
  });

  it('truncates to last N spine edges', () => {
    const result = truncateGraph(longSpineOnGraphContract.graph, longSpine, 3);
    expect(result.spine).toEqual(['S11', 'S12', 'S13', 'S14']);
    expect(result.elidedCount).toBe(11);
  });

  it('expands to include DB marker when limit is too small', () => {
    const result = truncateGraph(longSpineOnGraphContract.graph, longSpine, 1);
    expect(result.spine).toEqual(['S11', 'S12', 'S13', 'S14']);
    expect(result.elidedCount).toBe(11);
    expect(result.graph.nodes.some((n) => n.id === 'S11')).toBe(true);
    expect(result.graph.nodes.some((n) => n.markers?.some((m) => m.kind === 'db'))).toBe(true);
  });

  it('includes branches forking from visible spine', () => {
    const result = truncateGraph(longSpineOnGraphContract.graph, longSpine, 5);
    expect(result.graph.nodes.some((n) => n.id === 'B5a')).toBe(true);
    expect(result.graph.nodes.some((n) => n.id === 'R1')).toBe(true);
  });

  it('excludes branches from truncated portion', () => {
    const result = truncateGraph(longSpineOnGraphContract.graph, longSpine, 5);
    expect(result.graph.nodes.some((n) => n.id === 'B1a')).toBe(false);
    expect(result.graph.nodes.some((n) => n.id === 'B2a')).toBe(false);
    expect(result.graph.nodes.some((n) => n.id === 'B4a')).toBe(false);
  });

  it('preserves detached nodes even when truncated', () => {
    const result = truncateGraph(longSpineWithBranches.graph, longSpine, 3);
    expect(result.graph.nodes.some((n) => n.style === 'detached')).toBe(true);
    expect(result.graph.nodes.some((n) => n.id === 'planned')).toBe(true);
  });

  it('handles single-node spine', () => {
    const result = truncateGraph(new RenderGraph([{ id: '∅' }], []), ['∅'], 5);
    expect(result.elidedCount).toBe(0);
    expect(result.spine).toEqual(['∅']);
  });
});

describe('render with truncation', () => {
  it('renders truncated graph with ⋮ indicator', () => {
    const output = graphRenderer.render(longSpineOnGraphContract.graph, {
      ...longSpineOnGraphContract.options,
      colorize: false,
      limit: 5,
    });
    expect(output).toContain('earlier migrations');
    expect(output).toContain('┊');
    expect(output).toMatchSnapshot();
  });

  it('renders without truncation when limit is large', () => {
    const output = graphRenderer.render(longSpineOnGraphContract.graph, {
      ...longSpineOnGraphContract.options,
      colorize: false,
      limit: 100,
    });
    expect(output).not.toContain('earlier migration');
  });

  it('renders truncated graph with detached contract', () => {
    const output = graphRenderer.render(longSpineWithBranches.graph, {
      ...longSpineWithBranches.options,
      colorize: false,
      limit: 3,
    });
    expect(output).toContain('earlier migrations');
    expect(output).toContain('planned');
    expect(output).toContain('◆ contract');
    expect(output).toMatchSnapshot();
  });

  it('renders truncated extracted subgraph with elided indicator', () => {
    const sub = extractSubgraph(longSpineOnGraphContract.graph, longSpine);
    const output = graphRenderer.render(sub, {
      ...longSpineOnGraphContract.options,
      colorize: false,
      limit: 5,
    });
    expect(output).toContain('earlier migrations');
    expect(output).toContain('┊');
    expect(output).not.toContain('S01');
    expect(output).toContain('S14');
    expect(output).toMatchSnapshot();
  });

  it('renders singular "1 earlier migration" label', () => {
    const spine3 = ['∅', 'abc1234', '7e1b9a0', 'f03da82'];
    const sub = extractSubgraph(linearChain.graph, spine3);
    const output = graphRenderer.render(sub, {
      ...linearChain.options,
      colorize: false,
      limit: 2,
    });
    expect(output).toContain('1 earlier migration)');
    expect(output).not.toContain('migrations)');
  });

  it('expands truncation to include DB marker', () => {
    const sub = extractSubgraph(longSpineOnGraphContract.graph, longSpine);
    const output = graphRenderer.render(sub, {
      ...longSpineOnGraphContract.options,
      colorize: false,
      limit: 1,
    });
    expect(output).toContain('◆ db');
    expect(output).toContain('S11');
    expect(output).toContain('S14');
  });

  it('does not truncate when limit is undefined', () => {
    const sub = extractSubgraph(longSpineOnGraphContract.graph, longSpine);
    const output = graphRenderer.render(sub, {
      ...longSpineOnGraphContract.options,
      colorize: false,
    });
    expect(output).not.toContain('⋮');
    expect(output).toContain('S01');
    expect(output).toContain('S14');
  });
});

describe('isLinearGraph', () => {
  it('returns true for a single node', () => {
    const g = new RenderGraph([{ id: 'A' }], []);
    expect(isLinearGraph(g)).toBe(true);
  });

  it('returns true for a linear chain', () => {
    const g = new RenderGraph(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
      ],
    );
    expect(isLinearGraph(g)).toBe(true);
  });

  it('returns false for a graph with one branch', () => {
    const g = new RenderGraph(
      [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
      [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
      ],
    );
    expect(isLinearGraph(g)).toBe(false);
  });

  it('ignores detached nodes', () => {
    const g = new RenderGraph(
      [{ id: 'A' }, { id: 'B' }, { id: 'C', style: 'detached' }],
      [{ from: 'A', to: 'B' }],
    );
    expect(isLinearGraph(g)).toBe(true);
  });

  it('returns true for an empty graph', () => {
    const g = new RenderGraph([], []);
    expect(isLinearGraph(g)).toBe(true);
  });
});
