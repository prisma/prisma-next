import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { errorAmbiguousLeaf, errorSelfLoop } from './errors';
import type { MigrationGraph, MigrationGraphEdge, MigrationPackage } from './types';

export function reconstructGraph(packages: readonly MigrationPackage[]): MigrationGraph {
  const nodes = new Set<string>();
  const edges = new Map<string, MigrationGraphEdge[]>();
  const reverseEdges = new Map<string, MigrationGraphEdge[]>();

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
      dirName: pkg.dirName,
      createdAt: pkg.manifest.createdAt,
      labels: pkg.manifest.labels,
    };

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

  return { nodes, edges, reverseEdges };
}

function sortEdgesForTieBreaking(
  edgeList: readonly MigrationGraphEdge[],
): readonly MigrationGraphEdge[] {
  return [...edgeList].sort((a, b) => {
    const cmp = a.createdAt.localeCompare(b.createdAt);
    if (cmp !== 0) return cmp;
    const toCmp = a.to.localeCompare(b.to);
    if (toCmp !== 0) return toCmp;
    return (a.edgeId ?? '').localeCompare(b.edgeId ?? '');
  });
}

export function findLeaf(graph: MigrationGraph): string {
  if (graph.nodes.size === 0) {
    return EMPTY_CONTRACT_HASH;
  }

  const nodesWithOutgoing = new Set(graph.edges.keys());
  const leaves: string[] = [];

  for (const node of graph.nodes) {
    if (!nodesWithOutgoing.has(node) || (graph.edges.get(node)?.length ?? 0) === 0) {
      if (graph.reverseEdges.has(node) || node === EMPTY_CONTRACT_HASH) {
        leaves.push(node);
      }
    }
  }

  // Also filter: only include nodes that are actually targets of edges (or the root)
  // Nodes that are only sources (the EMPTY_CONTRACT_HASH with outgoing) are not leaves
  const realLeaves = leaves.filter((n) => graph.reverseEdges.has(n));

  if (realLeaves.length === 0) {
    return EMPTY_CONTRACT_HASH;
  }

  if (realLeaves.length === 1) {
    return realLeaves[0]!;
  }

  throw errorAmbiguousLeaf(realLeaves);
}

export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationGraphEdge[] | null {
  if (fromHash === toHash) return [];

  const visited = new Set<string>();
  const queue: Array<{ node: string; path: MigrationGraphEdge[] }> = [{ node: fromHash, path: [] }];

  while (queue.length > 0) {
    const current = queue.shift()!;

    if (current.node === toHash) {
      return current.path;
    }

    if (visited.has(current.node)) continue;
    visited.add(current.node);

    const outgoing = graph.edges.get(current.node);
    if (!outgoing) continue;

    for (const edge of sortEdgesForTieBreaking(outgoing)) {
      if (!visited.has(edge.to)) {
        queue.push({ node: edge.to, path: [...current.path, edge] });
      }
    }
  }

  return null;
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
            cur = parent.get(cur)!;
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
    const node = queue.shift()!;
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
