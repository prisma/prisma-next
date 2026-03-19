import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { ifDefined } from '@prisma-next/utils/defined';
import {
  errorAmbiguousLeaf,
  errorDuplicateMigrationId,
  errorNoResolvableLeaf,
  errorNoRoot,
  errorSelfLoop,
} from './errors';
import type { MigrationBundle, MigrationChainEntry, MigrationGraph } from './types';

export function reconstructGraph(packages: readonly MigrationBundle[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationById = new Map<string, MigrationChainEntry>();

  for (const pkg of packages) {
    const { from, to } = pkg.manifest;

    if (from === to) {
      throw errorSelfLoop(pkg.dirName, from);
    }

    nodes.add(from);
    nodes.add(to);

    const migration: MigrationChainEntry = {
      from,
      to,
      migrationId: pkg.manifest.migrationId,
      dirName: pkg.dirName,
      createdAt: pkg.manifest.createdAt,
      labels: pkg.manifest.labels,
    };

    if (migration.migrationId !== null) {
      if (migrationById.has(migration.migrationId)) {
        throw errorDuplicateMigrationId(migration.migrationId);
      }
      migrationById.set(migration.migrationId, migration);
    }

    const fwd = forwardChain.get(from);
    if (fwd) {
      fwd.push(migration);
    } else {
      forwardChain.set(from, [migration]);
    }

    const rev = reverseChain.get(to);
    if (rev) {
      rev.push(migration);
    } else {
      reverseChain.set(to, [migration]);
    }
  }

  return { nodes, forwardChain, reverseChain, migrationById };
}

const LABEL_PRIORITY: Record<string, number> = { main: 0, default: 1, feature: 2 };

function labelPriority(labels: readonly string[]): number {
  let best = 3;
  for (const l of labels) {
    const p = LABEL_PRIORITY[l];
    if (p !== undefined && p < best) best = p;
  }
  return best;
}

function sortedNeighbors(edges: readonly MigrationChainEntry[]): readonly MigrationChainEntry[] {
  return [...edges].sort((a, b) => {
    const lp = labelPriority(a.labels) - labelPriority(b.labels);
    if (lp !== 0) return lp;
    const ca = a.createdAt.localeCompare(b.createdAt);
    if (ca !== 0) return ca;
    const tc = a.to.localeCompare(b.to);
    if (tc !== 0) return tc;
    return (a.migrationId ?? '').localeCompare(b.migrationId ?? '');
  });
}

/**
 * Find the shortest path from `fromHash` to `toHash` using BFS over the
 * contract-hash graph. Returns the ordered list of edges, or null if no path
 * exists. Returns an empty array when `fromHash === toHash` (no-op).
 *
 * Neighbor ordering is deterministic via the tie-break sort key:
 * label priority → createdAt → to → migrationId.
 */
export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationChainEntry[] | null {
  if (fromHash === toHash) return [];

  const visited = new Set<string>();
  const parent = new Map<string, { node: string; edge: MigrationChainEntry }>();
  const queue: string[] = [fromHash];
  visited.add(fromHash);

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    if (current === toHash) {
      const path: MigrationChainEntry[] = [];
      let node = toHash;
      let entry = parent.get(node);
      while (entry) {
        const { node: prev, edge } = entry;
        path.push(edge);
        node = prev;
        entry = parent.get(node);
      }
      path.reverse();
      return path;
    }

    const outgoing = graph.forwardChain.get(current);
    if (!outgoing) continue;

    for (const edge of sortedNeighbors(outgoing)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        parent.set(edge.to, { node: current, edge });
        queue.push(edge.to);
      }
    }
  }

  return null;
}

export interface PathDecision {
  readonly selectedPath: readonly MigrationChainEntry[];
  readonly fromHash: string;
  readonly toHash: string;
  readonly alternativeCount: number;
  readonly tieBreakReasons: readonly string[];
  readonly refName?: string;
}

/**
 * Find the shortest path from `fromHash` to `toHash` and return structured
 * path-decision metadata for machine-readable output.
 */
export function findPathWithDecision(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
  refName?: string,
): PathDecision | null {
  if (fromHash === toHash) {
    return {
      selectedPath: [],
      fromHash,
      toHash,
      alternativeCount: 0,
      tieBreakReasons: [],
      ...ifDefined('refName', refName),
    };
  }

  const path = findPath(graph, fromHash, toHash);
  if (!path) return null;

  const tieBreakReasons: string[] = [];
  let alternativeCount = 0;

  for (const edge of path) {
    const outgoing = graph.forwardChain.get(edge.from);
    if (outgoing && outgoing.length > 1) {
      const reachable = outgoing.filter((e) => {
        const pathFromE = findPath(graph, e.to, toHash);
        return pathFromE !== null || e.to === toHash;
      });
      if (reachable.length > 1) {
        alternativeCount += reachable.length - 1;
        const sorted = sortedNeighbors(reachable);
        if (sorted[0] && sorted[0].migrationId === edge.migrationId) {
          if (reachable.some((e) => e.migrationId !== edge.migrationId)) {
            tieBreakReasons.push(
              `at ${edge.from}: ${reachable.length} candidates, selected by tie-break`,
            );
          }
        }
      }
    }
  }

  return {
    selectedPath: path,
    fromHash,
    toHash,
    alternativeCount,
    tieBreakReasons,
    ...ifDefined('refName', refName),
  };
}

/**
 * Walk ancestors of each leaf back from the leaves to find the last node
 * that appears on all paths. Returns `fromHash` if no shared ancestor is found.
 */
function findDivergencePoint(
  graph: MigrationGraph,
  fromHash: string,
  leaves: readonly string[],
): string {
  const ancestorSets = leaves.map((leaf) => {
    const ancestors = new Set<string>();
    const queue = [leaf];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (ancestors.has(current)) continue;
      ancestors.add(current);
      const incoming = graph.reverseChain.get(current);
      if (incoming) {
        for (const edge of incoming) {
          queue.push(edge.from);
        }
      }
    }
    return ancestors;
  });

  const commonAncestors = [...(ancestorSets[0] ?? [])].filter((node) =>
    ancestorSets.every((s) => s.has(node)),
  );

  let deepest = fromHash;
  let deepestDepth = -1;
  for (const ancestor of commonAncestors) {
    const path = findPath(graph, fromHash, ancestor);
    const depth = path ? path.length : 0;
    if (depth > deepestDepth) {
      deepestDepth = depth;
      deepest = ancestor;
    }
  }
  return deepest;
}

/**
 * Find all leaf nodes reachable from `fromHash` via forward edges.
 * A leaf is a node with no outgoing edges in the graph.
 */
export function findReachableLeaves(graph: MigrationGraph, fromHash: string): readonly string[] {
  const visited = new Set<string>();
  const queue: string[] = [fromHash];
  visited.add(fromHash);
  const leaves: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    const outgoing = graph.forwardChain.get(current);

    if (!outgoing || outgoing.length === 0) {
      leaves.push(current);
    } else {
      for (const edge of outgoing) {
        if (!visited.has(edge.to)) {
          visited.add(edge.to);
          queue.push(edge.to);
        }
      }
    }
  }

  return leaves;
}

/**
 * Find the leaf contract hash of the migration graph reachable from
 * EMPTY_CONTRACT_HASH. Throws NO_ROOT if the graph has nodes but none
 * originate from the empty hash (e.g. root migration was deleted).
 * Throws AMBIGUOUS_LEAF if multiple leaves exist.
 */
export function findLeaf(graph: MigrationGraph): string {
  if (graph.nodes.size === 0) {
    return EMPTY_CONTRACT_HASH;
  }

  if (!graph.nodes.has(EMPTY_CONTRACT_HASH)) {
    throw errorNoRoot([...graph.nodes]);
  }

  const leaves = findReachableLeaves(graph, EMPTY_CONTRACT_HASH);

  if (leaves.length === 0) {
    const reachable = [...graph.nodes].filter((n) => n !== EMPTY_CONTRACT_HASH);
    if (reachable.length > 0) {
      throw errorNoResolvableLeaf(reachable);
    }
    return EMPTY_CONTRACT_HASH;
  }

  if (leaves.length > 1) {
    const divergencePoint = findDivergencePoint(graph, EMPTY_CONTRACT_HASH, leaves);
    const branches = leaves.map((leaf) => {
      const path = findPath(graph, divergencePoint, leaf);
      return {
        leaf,
        edges: (path ?? []).map((e) => ({ dirName: e.dirName, from: e.from, to: e.to })),
      };
    });
    throw errorAmbiguousLeaf(leaves, { divergencePoint, branches });
  }

  const leaf = leaves[0];
  return leaf !== undefined ? leaf : EMPTY_CONTRACT_HASH;
}

/**
 * Find the latest migration entry by traversing from EMPTY_CONTRACT_HASH
 * to the single leaf. Returns null for an empty graph.
 * Throws AMBIGUOUS_LEAF if the graph has multiple leaves.
 */
export function findLatestMigration(graph: MigrationGraph): MigrationChainEntry | null {
  if (graph.nodes.size === 0) {
    return null;
  }

  const leafHash = findLeaf(graph);
  if (leafHash === EMPTY_CONTRACT_HASH) {
    return null;
  }

  const path = findPath(graph, EMPTY_CONTRACT_HASH, leafHash);
  if (!path || path.length === 0) {
    return null;
  }

  return path[path.length - 1] ?? null;
}

export function detectCycles(graph: MigrationGraph): readonly string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;

  const color = new Map<string, number>();
  const parentMap = new Map<string, string | null>();
  const cycles: string[][] = [];

  for (const node of graph.nodes) {
    color.set(node, WHITE);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);

    const outgoing = graph.forwardChain.get(u);
    if (outgoing) {
      for (const edge of outgoing) {
        const v = edge.to;
        if (color.get(v) === GRAY) {
          const cycle: string[] = [v];
          let cur = u;
          while (cur !== v) {
            cycle.push(cur);
            cur = parentMap.get(cur) ?? v;
          }
          cycle.reverse();
          cycles.push(cycle);
        } else if (color.get(v) === WHITE) {
          parentMap.set(v, u);
          dfs(v);
        }
      }
    }

    color.set(u, BLACK);
  }

  for (const node of graph.nodes) {
    if (color.get(node) === WHITE) {
      parentMap.set(node, null);
      dfs(node);
    }
  }

  return cycles;
}

export function detectOrphans(graph: MigrationGraph): readonly MigrationChainEntry[] {
  if (graph.nodes.size === 0) return [];

  const reachable = new Set<string>();
  const startNodes: string[] = [];

  if (graph.forwardChain.has(EMPTY_CONTRACT_HASH)) {
    startNodes.push(EMPTY_CONTRACT_HASH);
  } else {
    const allTargets = new Set<string>();
    for (const edges of graph.forwardChain.values()) {
      for (const edge of edges) {
        allTargets.add(edge.to);
      }
    }
    for (const node of graph.nodes) {
      if (!allTargets.has(node)) {
        startNodes.push(node);
      }
    }
  }

  const queue = [...startNodes];
  for (const hash of queue) {
    reachable.add(hash);
  }

  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) break;
    const outgoing = graph.forwardChain.get(node);
    if (!outgoing) continue;

    for (const migration of outgoing) {
      if (!reachable.has(migration.to)) {
        reachable.add(migration.to);
        queue.push(migration.to);
      }
    }
  }

  const orphans: MigrationChainEntry[] = [];
  for (const [from, migrations] of graph.forwardChain) {
    if (!reachable.has(from)) {
      orphans.push(...migrations);
    }
  }

  return orphans;
}
