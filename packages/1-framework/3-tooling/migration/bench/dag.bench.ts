import { bench, describe } from 'vitest';
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
import { buildBundles, buildGraph, expectedLeaf, type GraphShape, rootHash } from './generators';

/**
 * Benchmark suite for the migration graph layer.
 *
 * Organised by operation. Each operation is benchmarked across several graph
 * shapes and sizes so `pnpm bench`'s output reveals the scaling behaviour
 * (look at ops/s across size classes within an operation).
 *
 * Notes:
 *  - We materialise the graph once per bench (outside the bench callback) so we
 *    measure the operation, not construction. `reconstructGraph` is the
 *    exception — it benchmarks construction.
 *  - Bench sizes stay under ~100k edges to keep the total run under a few
 *    minutes on a developer laptop. Scale up via env var `PN_BENCH_LARGE=1`
 *    for deeper runs.
 */

const LARGE = process.env['PN_BENCH_LARGE'] === '1';

const linearSizes = LARGE ? [10, 100, 1_000, 10_000, 50_000] : [10, 100, 1_000, 10_000];
const pathologicalCycleSizes = LARGE ? [100, 1_000, 10_000] : [100, 1_000];
// detectCycles-specific sizes; the recursive implementation overflowed at ~5k.
const detectCyclesLinearSizes = LARGE ? [10, 100, 1_000, 10_000, 50_000] : [10, 100, 1_000, 10_000];

function named(shape: GraphShape): string {
  switch (shape.kind) {
    case 'linear':
      return `linear(${shape.length})`;
    case 'diamond':
      return `diamond(${shape.branchLength})`;
    case 'wide-tree':
      return `wide-tree(b=${shape.branchingFactor},d=${shape.depth})`;
    case 'merge-heavy':
      return `merge-heavy(spine=${shape.spineLength},k=${shape.parallelBranches},every=${shape.mergeEvery})`;
    case 'ambiguous-leaves':
      return `ambiguous-leaves(spine=${shape.spineLength},branches=${shape.unmergedBranches},len=${shape.branchLength})`;
    case 'pathological-cycle':
      return `pathological-cycle(${shape.length})`;
    case 'realistic-mixed':
      return `realistic-mixed(spine=${shape.spineLength},rate=${shape.featureBranchRate},branch=${shape.branchLength})`;
    case 'disconnected-orphans':
      return `disconnected-orphans(spine=${shape.reachableSpine},clusters=${shape.orphanClusters},size=${shape.orphanSize})`;
  }
}

describe('reconstructGraph', () => {
  const shapes: GraphShape[] = [
    ...linearSizes.map<GraphShape>((n) => ({ kind: 'linear', length: n })),
    { kind: 'wide-tree', branchingFactor: 5, depth: 6 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'realistic-mixed', spineLength: 1_000, featureBranchRate: 0.2, branchLength: 3 },
  ];

  for (const shape of shapes) {
    const bundles = buildBundles(shape);
    bench(named(shape), () => {
      reconstructGraph(bundles);
    });
  }
});

describe('findPath (root → leaf)', () => {
  const shapes: GraphShape[] = [
    ...linearSizes.map<GraphShape>((n) => ({ kind: 'linear', length: n })),
    { kind: 'diamond', branchLength: 100 },
    { kind: 'diamond', branchLength: 1_000 },
    { kind: 'merge-heavy', spineLength: 100, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'realistic-mixed', spineLength: 1_000, featureBranchRate: 0.2, branchLength: 3 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    const leaf = expectedLeaf(shape);
    if (leaf === null) continue;
    bench(named(shape), () => {
      findPath(graph, rootHash(), leaf);
    });
  }
});

describe('findPath (root → random interior)', () => {
  const shapes: GraphShape[] = [
    { kind: 'linear', length: 1_000 },
    { kind: 'linear', length: 10_000 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    const targets = [...graph.nodes].filter((n) => n !== rootHash()).slice(0, 16);
    let i = 0;
    bench(named(shape), () => {
      // Rotate through a fixed set of targets to average over path lengths.
      const target = targets[i++ % targets.length]!;
      findPath(graph, rootHash(), target);
    });
  }
});

describe('findPathWithDecision', () => {
  const shapes: GraphShape[] = [
    { kind: 'diamond', branchLength: 100 },
    { kind: 'diamond', branchLength: 1_000 },
    { kind: 'merge-heavy', spineLength: 100, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 5, mergeEvery: 100 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    const leaf = expectedLeaf(shape);
    if (leaf === null) continue;
    bench(named(shape), () => {
      findPathWithDecision(graph, rootHash(), leaf);
    });
  }
});

describe('findReachableLeaves', () => {
  const shapes: GraphShape[] = [
    { kind: 'wide-tree', branchingFactor: 2, depth: 12 },
    { kind: 'wide-tree', branchingFactor: 5, depth: 6 },
    { kind: 'wide-tree', branchingFactor: 10, depth: 4 },
    { kind: 'ambiguous-leaves', spineLength: 100, unmergedBranches: 10, branchLength: 20 },
    { kind: 'ambiguous-leaves', spineLength: 1_000, unmergedBranches: 20, branchLength: 50 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    bench(named(shape), () => {
      findReachableLeaves(graph, rootHash());
    });
  }
});

describe('findLeaf', () => {
  // Fast path (single leaf).
  const fastShapes: GraphShape[] = [
    { kind: 'linear', length: 100 },
    { kind: 'linear', length: 10_000 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
  ];
  for (const shape of fastShapes) {
    const graph = buildGraph(shape);
    bench(`ok · ${named(shape)}`, () => {
      findLeaf(graph);
    });
  }

  // Throw path: AMBIGUOUS_TARGET. Cost of computing the diagnostic matters for
  // apply/status UX when the graph is ambiguous.
  const throwShapes: GraphShape[] = [
    { kind: 'ambiguous-leaves', spineLength: 100, unmergedBranches: 5, branchLength: 20 },
    { kind: 'ambiguous-leaves', spineLength: 1_000, unmergedBranches: 10, branchLength: 50 },
  ];
  for (const shape of throwShapes) {
    const graph = buildGraph(shape);
    bench(`throw · ${named(shape)}`, () => {
      try {
        findLeaf(graph);
      } catch {
        // Expected: AMBIGUOUS_TARGET. We measure the cost of building the
        // divergence-point + branch diagnostic.
      }
    });
  }
});

describe('findLatestMigration', () => {
  const shapes: GraphShape[] = [
    { kind: 'linear', length: 100 },
    { kind: 'linear', length: 10_000 },
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
    { kind: 'realistic-mixed', spineLength: 1_000, featureBranchRate: 0.2, branchLength: 3 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    bench(named(shape), () => {
      findLatestMigration(graph);
    });
  }
});

describe('detectCycles', () => {
  const shapes: GraphShape[] = [
    ...detectCyclesLinearSizes.map<GraphShape>((n) => ({ kind: 'linear', length: n })),
    { kind: 'merge-heavy', spineLength: 1_000, parallelBranches: 3, mergeEvery: 10 },
    ...pathologicalCycleSizes.map<GraphShape>((n) => ({ kind: 'pathological-cycle', length: n })),
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    bench(named(shape), () => {
      detectCycles(graph);
    });
  }
});

describe('detectOrphans', () => {
  const shapes: GraphShape[] = [
    { kind: 'linear', length: 1_000 },
    { kind: 'wide-tree', branchingFactor: 5, depth: 6 },
    { kind: 'disconnected-orphans', reachableSpine: 500, orphanClusters: 10, orphanSize: 50 },
    { kind: 'disconnected-orphans', reachableSpine: 5_000, orphanClusters: 50, orphanSize: 100 },
  ];

  for (const shape of shapes) {
    const graph = buildGraph(shape);
    bench(named(shape), () => {
      detectOrphans(graph);
    });
  }
});
