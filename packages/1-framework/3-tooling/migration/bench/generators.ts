import { EMPTY_CONTRACT_HASH } from '../src/constants';
import type {
  AttestedMigrationBundle,
  AttestedMigrationManifest,
  MigrationChainEntry,
  MigrationGraph,
} from '../src/types';

/**
 * Graph generators for performance benchmarking.
 *
 * Two construction paths:
 *  - `buildGraph(shape)` → `MigrationGraph` directly (skips construction cost when
 *    benchmarking traversal ops in isolation).
 *  - `buildBundles(shape)` → `AttestedMigrationBundle[]` suitable for `reconstructGraph`.
 *
 * Every shape uses `EMPTY_CONTRACT_HASH` as the root and deterministic synthetic
 * hashes (`h:<index>`) for non-root nodes so generated graphs are reproducible.
 */

export type GraphShape =
  | { kind: 'linear'; length: number }
  | { kind: 'diamond'; branchLength: number }
  | { kind: 'wide-tree'; branchingFactor: number; depth: number }
  | { kind: 'merge-heavy'; spineLength: number; parallelBranches: number; mergeEvery: number }
  | {
      kind: 'ambiguous-leaves';
      spineLength: number;
      unmergedBranches: number;
      branchLength: number;
    }
  | { kind: 'pathological-cycle'; length: number }
  | {
      kind: 'realistic-mixed';
      spineLength: number;
      featureBranchRate: number;
      branchLength: number;
    }
  | {
      kind: 'disconnected-orphans';
      reachableSpine: number;
      orphanClusters: number;
      orphanSize: number;
    };

interface EdgeSpec {
  readonly from: string;
  readonly to: string;
  readonly labels: readonly string[];
}

const MAIN = ['main'] as const;
const FEATURE = ['feature'] as const;
const NO_LABEL: readonly string[] = [];

const BASE_TIME = Date.UTC(2026, 0, 1);

function isoAt(index: number): string {
  // 1 second per edge keeps ordering stable and lexicographic-friendly.
  return new Date(BASE_TIME + index * 1_000).toISOString();
}

function hashNode(n: number): string {
  return `h:${n.toString(36)}`;
}

/**
 * Builds a flat edge list for a shape. Consumers either materialise this into a
 * `MigrationGraph` (via `edgesToGraph`) or into `AttestedMigrationBundle[]` (via
 * `edgesToBundles`).
 */
function buildEdges(shape: GraphShape): EdgeSpec[] {
  switch (shape.kind) {
    case 'linear': {
      const edges: EdgeSpec[] = [];
      let prev: string = EMPTY_CONTRACT_HASH;
      for (let i = 0; i < shape.length; i++) {
        const next = hashNode(i);
        edges.push({ from: prev, to: next, labels: MAIN });
        prev = next;
      }
      return edges;
    }

    case 'diamond': {
      const edges: EdgeSpec[] = [];
      const leftNodes: string[] = [EMPTY_CONTRACT_HASH];
      const rightNodes: string[] = [EMPTY_CONTRACT_HASH];
      for (let i = 0; i < shape.branchLength; i++) {
        leftNodes.push(hashNode(i));
        rightNodes.push(hashNode(shape.branchLength + i));
      }
      const merge = hashNode(shape.branchLength * 2);
      for (let i = 0; i < shape.branchLength; i++) {
        edges.push({ from: leftNodes[i]!, to: leftNodes[i + 1]!, labels: MAIN });
        edges.push({ from: rightNodes[i]!, to: rightNodes[i + 1]!, labels: FEATURE });
      }
      edges.push({ from: leftNodes.at(-1)!, to: merge, labels: MAIN });
      edges.push({ from: rightNodes.at(-1)!, to: merge, labels: FEATURE });
      return edges;
    }

    case 'wide-tree': {
      const edges: EdgeSpec[] = [];
      let nodeCounter = 0;
      const nextNode = () => hashNode(nodeCounter++);
      const { branchingFactor, depth: maxDepth } = shape;

      function recurse(parent: string, depth: number): void {
        if (depth === 0) return;
        for (let i = 0; i < branchingFactor; i++) {
          const child = nextNode();
          edges.push({ from: parent, to: child, labels: i === 0 ? MAIN : FEATURE });
          recurse(child, depth - 1);
        }
      }
      recurse(EMPTY_CONTRACT_HASH, maxDepth);
      return edges;
    }

    case 'merge-heavy': {
      const edges: EdgeSpec[] = [];
      let nodeCounter = 0;
      const nextNode = () => hashNode(nodeCounter++);

      // Build a spine of canonical nodes.
      const spine: string[] = [EMPTY_CONTRACT_HASH];
      for (let i = 0; i < shape.spineLength; i++) {
        const node = nextNode();
        edges.push({ from: spine.at(-1)!, to: node, labels: MAIN });
        spine.push(node);
      }

      // Every `mergeEvery` steps on the spine, spawn K parallel branches that
      // diverge at spine[i] and rejoin at spine[i + mergeEvery].
      for (let i = 0; i + shape.mergeEvery < spine.length; i += shape.mergeEvery) {
        const divergence = spine[i]!;
        const convergence = spine[i + shape.mergeEvery]!;
        for (let b = 0; b < shape.parallelBranches; b++) {
          // Each branch is a short chain of length (mergeEvery) parallel to spine.
          let prev = divergence;
          for (let s = 0; s < shape.mergeEvery - 1; s++) {
            const mid = nextNode();
            edges.push({ from: prev, to: mid, labels: FEATURE });
            prev = mid;
          }
          edges.push({ from: prev, to: convergence, labels: FEATURE });
        }
      }
      return edges;
    }

    case 'ambiguous-leaves': {
      const edges: EdgeSpec[] = [];
      let nodeCounter = 0;
      const nextNode = () => hashNode(nodeCounter++);

      const spine: string[] = [EMPTY_CONTRACT_HASH];
      for (let i = 0; i < shape.spineLength; i++) {
        const node = nextNode();
        edges.push({ from: spine.at(-1)!, to: node, labels: MAIN });
        spine.push(node);
      }
      // Attach K unmerged branches forking from the last spine node.
      for (let b = 0; b < shape.unmergedBranches; b++) {
        let prev = spine.at(-1)!;
        for (let s = 0; s < shape.branchLength; s++) {
          const node = nextNode();
          edges.push({ from: prev, to: node, labels: FEATURE });
          prev = node;
        }
      }
      return edges;
    }

    case 'pathological-cycle': {
      const edges: EdgeSpec[] = [];
      let prev: string = EMPTY_CONTRACT_HASH;
      const nodes: string[] = [prev];
      for (let i = 0; i < shape.length; i++) {
        const next = hashNode(i);
        edges.push({ from: prev, to: next, labels: MAIN });
        nodes.push(next);
        prev = next;
      }
      // Add a back-edge from the tail to roughly the midpoint, creating a cycle.
      const midpoint = nodes[Math.floor(nodes.length / 2)]!;
      edges.push({ from: nodes.at(-1)!, to: midpoint, labels: FEATURE });
      return edges;
    }

    case 'realistic-mixed': {
      const edges: EdgeSpec[] = [];
      let nodeCounter = 0;
      const nextNode = () => hashNode(nodeCounter++);

      const spine: string[] = [EMPTY_CONTRACT_HASH];
      for (let i = 0; i < shape.spineLength; i++) {
        const node = nextNode();
        edges.push({ from: spine.at(-1)!, to: node, labels: MAIN });
        spine.push(node);
      }
      // Every 1/rate spine nodes, spawn a short rejoining feature branch.
      const step = Math.max(2, Math.round(1 / shape.featureBranchRate));
      for (let i = step; i + shape.branchLength < spine.length; i += step) {
        let prev = spine[i]!;
        for (let s = 0; s < shape.branchLength - 1; s++) {
          const mid = nextNode();
          edges.push({ from: prev, to: mid, labels: FEATURE });
          prev = mid;
        }
        edges.push({ from: prev, to: spine[i + shape.branchLength]!, labels: FEATURE });
      }
      return edges;
    }

    case 'disconnected-orphans': {
      const edges: EdgeSpec[] = [];
      let nodeCounter = 0;
      const nextNode = () => hashNode(nodeCounter++);

      let prev: string = EMPTY_CONTRACT_HASH;
      for (let i = 0; i < shape.reachableSpine; i++) {
        const node = nextNode();
        edges.push({ from: prev, to: node, labels: MAIN });
        prev = node;
      }
      // Disconnected clusters — short chains not reachable from root.
      for (let c = 0; c < shape.orphanClusters; c++) {
        let chainPrev = nextNode();
        for (let s = 0; s < shape.orphanSize; s++) {
          const node = nextNode();
          edges.push({ from: chainPrev, to: node, labels: NO_LABEL });
          chainPrev = node;
        }
      }
      return edges;
    }
  }
}

/**
 * Materialises an edge list directly into a `MigrationGraph`, bypassing
 * `reconstructGraph`. Use for benchmarking traversal ops in isolation.
 */
export function buildGraph(shape: GraphShape): MigrationGraph {
  const edges = buildEdges(shape);
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationById = new Map<string, MigrationChainEntry>();

  edges.forEach((edge, i) => {
    nodes.add(edge.from);
    nodes.add(edge.to);
    const entry: MigrationChainEntry = {
      from: edge.from,
      to: edge.to,
      migrationId: `mid:${i}`,
      dirName: `m${i}`,
      createdAt: isoAt(i),
      labels: edge.labels,
    };

    const fwd = forwardChain.get(edge.from);
    if (fwd) fwd.push(entry);
    else forwardChain.set(edge.from, [entry]);

    const rev = reverseChain.get(edge.to);
    if (rev) rev.push(entry);
    else reverseChain.set(edge.to, [entry]);

    migrationById.set(entry.migrationId, entry);
  });

  return { nodes, forwardChain, reverseChain, migrationById };
}

/**
 * Builds minimal `AttestedMigrationBundle[]` for benchmarking `reconstructGraph`.
 * Contract fields are stubbed — the graph reconstruction code only reads
 * manifest metadata, so we don't need real contracts.
 */
export function buildBundles(shape: GraphShape): AttestedMigrationBundle[] {
  const edges = buildEdges(shape);
  const stubContract = { version: '0', models: [], codecs: [] } as unknown;
  return edges.map((edge, i) => {
    const manifest: AttestedMigrationManifest = {
      from: edge.from,
      to: edge.to,
      migrationId: `mid:${i}`,
      kind: 'regular',
      fromContract: null,
      toContract: stubContract as AttestedMigrationManifest['toContract'],
      hints: {
        used: [],
        applied: [],
        plannerVersion: '0.0.1',
        planningStrategy: 'additive',
      },
      labels: edge.labels,
      createdAt: isoAt(i),
    };
    return {
      dirName: `m${i}`,
      dirPath: `/migrations/m${i}`,
      manifest,
      ops: [],
    };
  });
}

/**
 * Returns the deterministic "leaf" (final spine node) of a shape, or `null`
 * if the shape has multiple leaves. Useful for `findPath(root → leaf)` setups.
 */
export function expectedLeaf(shape: GraphShape): string | null {
  switch (shape.kind) {
    case 'linear':
    case 'pathological-cycle':
      return hashNode(shape.length - 1);
    case 'diamond':
      return hashNode(shape.branchLength * 2);
    case 'merge-heavy':
      // Spine-only nodes are the first `spineLength` indices.
      return hashNode(shape.spineLength - 1);
    case 'realistic-mixed':
      return hashNode(shape.spineLength - 1);
    case 'ambiguous-leaves':
      return null;
    case 'wide-tree':
      return null;
    case 'disconnected-orphans':
      return hashNode(shape.reachableSpine - 1);
  }
}

export function rootHash(): string {
  return EMPTY_CONTRACT_HASH;
}
