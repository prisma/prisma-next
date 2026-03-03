import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { errorAmbiguousLeaf, errorNoLeaf, errorSelfLoop } from './errors';
import type { MigrationGraph, MigrationGraphEdge, MigrationPackage } from './types';

export function reconstructGraph(packages: readonly MigrationPackage[]): MigrationGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, MigrationGraphEdge[]>();
  const reverseEdges = new Map<string, MigrationGraphEdge[]>();
  const edgeById = new Map<string, MigrationGraphEdge>();
  const childEdges = new Map<string | null, MigrationGraphEdge[]>();

  for (const pkg of packages) {
    const { from, to } = pkg.manifest;

    if (from === to) {
      throw errorSelfLoop(pkg.dirName, from);
    }

    nodes.add(from);
    nodes.add(to);

    const edge: MigrationGraphEdge = {
      from,
      to,
      edgeId: pkg.manifest.edgeId,
      parentEdgeId: pkg.manifest.parentEdgeId,
      dirName: pkg.dirName,
      createdAt: pkg.manifest.createdAt,
      labels: pkg.manifest.labels,
    };

    if (edge.edgeId !== null) {
      edgeById.set(edge.edgeId, edge);
    }

    const parentId = edge.parentEdgeId;
    const siblings = childEdges.get(parentId);
    if (siblings) {
      siblings.push(edge);
    } else {
      childEdges.set(parentId, [edge]);
    }

    const fwd = edges.get(from);
    if (fwd) {
      fwd.push(edge);
    } else {
      edges.set(from, [edge]);
    }

    const rev = reverseEdges.get(to);
    if (rev) {
      rev.push(edge);
    } else {
      reverseEdges.set(to, [edge]);
    }
  }

  return { nodes, edges, reverseEdges, edgeById, childEdges };
}

/**
 * Walk the parent-edge chain to find the terminal edge.
 * Returns the edge with no children, or null for an empty graph.
 * Throws AMBIGUOUS_LEAF if the chain branches.
 */
export function findLeafEdge(graph: MigrationGraph): MigrationGraphEdge | null {
  if (graph.nodes.size === 0) {
    return null;
  }

  const roots = graph.childEdges.get(null);
  if (!roots || roots.length === 0) {
    throw errorNoLeaf([...graph.nodes].sort());
  }

  if (roots.length > 1) {
    throw errorAmbiguousLeaf(roots.map((e) => e.to));
  }

  let current = roots[0];
  if (!current) {
    throw errorNoLeaf([...graph.nodes].sort());
  }

  for (let depth = 0; depth < graph.edgeById.size + 1; depth++) {
    const children = current.edgeId !== null ? graph.childEdges.get(current.edgeId) : undefined;

    if (!children || children.length === 0) {
      return current;
    }

    if (children.length > 1) {
      throw errorAmbiguousLeaf(children.map((e) => e.to));
    }

    const next = children[0];
    if (!next) break;
    current = next;
  }

  throw errorNoLeaf([...graph.nodes].sort());
}

/**
 * Find the leaf contract hash of the migration chain.
 * Convenience wrapper around findLeafEdge.
 */
export function findLeaf(graph: MigrationGraph): string {
  const edge = findLeafEdge(graph);
  return edge ? edge.to : EMPTY_CONTRACT_HASH;
}

/**
 * Find the ordered chain of edges from `fromHash` to `toHash` by walking the
 * parent-edge chain. Returns the sub-sequence of edges whose cumulative path
 * goes from `fromHash` to `toHash`.
 *
 * This reconstructs the full chain from root to leaf via parent pointers, then
 * extracts the segment between the two hashes. This correctly handles revisited
 * contract hashes (e.g. A→B→A) because it operates on edges, not nodes.
 */
export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationGraphEdge[] | null {
  if (fromHash === toHash) return [];

  const chain = buildChain(graph);
  if (!chain) return null;

  let startIdx = -1;
  if (
    fromHash === EMPTY_CONTRACT_HASH &&
    chain.length > 0 &&
    chain[0]?.from === EMPTY_CONTRACT_HASH
  ) {
    startIdx = 0;
  } else {
    for (let i = chain.length - 1; i >= 0; i--) {
      if (chain[i]?.to === fromHash) {
        startIdx = i + 1;
        break;
      }
    }
  }

  if (startIdx === -1) return null;

  let endIdx = -1;
  for (let i = chain.length - 1; i >= startIdx; i--) {
    if (chain[i]?.to === toHash) {
      endIdx = i + 1;
      break;
    }
  }

  if (endIdx === -1) return null;

  return chain.slice(startIdx, endIdx);
}

/**
 * Build the full ordered chain of edges from root to leaf by following
 * parent pointers. Returns null if the chain cannot be reconstructed
 * (e.g. missing root, branches).
 */
function buildChain(graph: MigrationGraph): readonly MigrationGraphEdge[] | null {
  const roots = graph.childEdges.get(null);
  if (!roots || roots.length !== 1) return null;

  const chain: MigrationGraphEdge[] = [];
  let current: MigrationGraphEdge | undefined = roots[0];

  for (let depth = 0; depth < graph.edgeById.size + 1 && current; depth++) {
    chain.push(current);
    const children = current.edgeId !== null ? graph.childEdges.get(current.edgeId) : undefined;
    if (!children || children.length === 0) break;
    if (children.length > 1) return null;
    current = children[0];
  }

  return chain;
}

export function detectCycles(graph: MigrationGraph): readonly string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const node of graph.nodes) {
    color.set(node, WHITE);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);

    const outgoing = graph.edges.get(u);
    if (outgoing) {
      for (const edge of outgoing) {
        const v = edge.to;
        if (color.get(v) === GRAY) {
          // Back edge found — reconstruct cycle
          const cycle: string[] = [v];
          let cur = u;
          while (cur !== v) {
            cycle.push(cur);
            cur = parent.get(cur) ?? v;
          }
          cycle.reverse();
          cycles.push(cycle);
        } else if (color.get(v) === WHITE) {
          parent.set(v, u);
          dfs(v);
        }
      }
    }

    color.set(u, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node) === WHITE) {
      parent.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}

export function detectOrphans(graph: MigrationGraph): readonly MigrationGraphEdge[] {
  if (graph.nodes.size === 0) return [];

  const reachable = new Set<string>();
  const queue: string[] = [EMPTY_CONTRACT_HASH];
  reachable.add(EMPTY_CONTRACT_HASH);

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    const outgoing = graph.edges.get(node);
    if (!outgoing) continue;

    for (const edge of outgoing) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  const orphans: MigrationGraphEdge[] = [];
  for (const [from, edgeList] of graph.edges) {
    if (!reachable.has(from)) {
      orphans.push(...edgeList);
    }
  }

  return orphans;
}
