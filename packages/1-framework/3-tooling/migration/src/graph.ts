import { ifDefined } from '@prisma-next/utils/defined';
import { EMPTY_CONTRACT_HASH } from './constants';
import {
  errorAmbiguousTarget,
  errorDuplicateMigrationId,
  errorNoInitialMigration,
  errorNoTarget,
  errorSameSourceAndTarget,
} from './errors';
import { bfs } from './graph-ops';
import type { MigrationBundle, MigrationChainEntry, MigrationGraph } from './types';

/** Forward-edge neighbours for BFS: edge `e` from `n` visits `e.to` next. */
function forwardNeighbours(graph: MigrationGraph, node: string) {
  return (graph.forwardChain.get(node) ?? []).map((edge) => ({ next: edge.to, edge }));
}

/** Reverse-edge neighbours for BFS: edge `e` from `n` visits `e.from` next. */
function reverseNeighbours(graph: MigrationGraph, node: string) {
  return (graph.reverseChain.get(node) ?? []).map((edge) => ({ next: edge.from, edge }));
}

function appendEdge(
  map: Map<string, MigrationChainEntry[]>,
  key: string,
  entry: MigrationChainEntry,
): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

export function reconstructGraph(packages: readonly MigrationBundle[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationById = new Map<string, MigrationChainEntry>();

  for (const pkg of packages) {
    const { from, to } = pkg.manifest;

    if (from === to) {
      throw errorSameSourceAndTarget(pkg.dirName, from);
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

    if (migrationById.has(migration.migrationId)) {
      throw errorDuplicateMigrationId(migration.migrationId);
    }
    migrationById.set(migration.migrationId, migration);

    appendEdge(forwardChain, from, migration);
    appendEdge(reverseChain, to, migration);
  }

  return { nodes, forwardChain, reverseChain, migrationById };
}

// ---------------------------------------------------------------------------
// Deterministic tie-breaking for BFS neighbour order.
// Used by `findPath` and `findPathWithDecision` only; not a general-purpose
// utility. Ordering: label priority → createdAt → to → migrationId.
// ---------------------------------------------------------------------------

const LABEL_PRIORITY: Record<string, number> = { main: 0, default: 1, feature: 2 };

function labelPriority(labels: readonly string[]): number {
  let best = 3;
  for (const l of labels) {
    const p = LABEL_PRIORITY[l];
    if (p !== undefined && p < best) best = p;
  }
  return best;
}

function compareTieBreak(a: MigrationChainEntry, b: MigrationChainEntry): number {
  const lp = labelPriority(a.labels) - labelPriority(b.labels);
  if (lp !== 0) return lp;
  const ca = a.createdAt.localeCompare(b.createdAt);
  if (ca !== 0) return ca;
  const tc = a.to.localeCompare(b.to);
  if (tc !== 0) return tc;
  return a.migrationId.localeCompare(b.migrationId);
}

function sortedNeighbors(edges: readonly MigrationChainEntry[]): readonly MigrationChainEntry[] {
  return [...edges].sort(compareTieBreak);
}

/** Ordering adapter for `bfs` — sorts `{next, edge}` pairs by tie-break. */
function bfsOrdering(
  items: readonly { next: string; edge: MigrationChainEntry }[],
): readonly { next: string; edge: MigrationChainEntry }[] {
  return items.slice().sort((a, b) => compareTieBreak(a.edge, b.edge));
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

  const parents = new Map<string, { parent: string; edge: MigrationChainEntry }>();
  for (const step of bfs([fromHash], (n) => forwardNeighbours(graph, n), bfsOrdering)) {
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(step.node, { parent: step.parent, edge: step.incomingEdge });
    }
    if (step.node === toHash) {
      const path: MigrationChainEntry[] = [];
      let cur = toHash;
      let p = parents.get(cur);
      while (p) {
        path.push(p.edge);
        cur = p.parent;
        p = parents.get(cur);
      }
      path.reverse();
      return path;
    }
  }

  return null;
}

/**
 * Reverse-BFS from `toHash` over `reverseChain` to collect every node from
 * which `toHash` is reachable (inclusive of `toHash` itself).
 */
function collectNodesReachingTarget(graph: MigrationGraph, toHash: string): Set<string> {
  const reached = new Set<string>();
  for (const step of bfs([toHash], (n) => reverseNeighbours(graph, n))) {
    reached.add(step.node);
  }
  return reached;
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

  // Single reverse BFS marks every node from which `toHash` is reachable.
  // Replaces a per-edge `findPath(e.to, toHash)` call inside the loop below,
  // which made the whole function O(|path| · (V + E)) instead of O(V + E).
  const reachesTarget = collectNodesReachingTarget(graph, toHash);

  const tieBreakReasons: string[] = [];
  let alternativeCount = 0;

  for (const edge of path) {
    const outgoing = graph.forwardChain.get(edge.from);
    if (outgoing && outgoing.length > 1) {
      const reachable = outgoing.filter((e) => reachesTarget.has(e.to));
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
 * Walk ancestors of each branch tip back to find the last node
 * that appears on all paths. Returns `fromHash` if no shared ancestor is found.
 */
function findDivergencePoint(
  graph: MigrationGraph,
  fromHash: string,
  leaves: readonly string[],
): string {
  const ancestorSets = leaves.map((leaf) => {
    const ancestors = new Set<string>();
    for (const step of bfs([leaf], (n) => reverseNeighbours(graph, n))) {
      ancestors.add(step.node);
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
 * Find all branch tips (nodes with no outgoing edges) reachable from
 * `fromHash` via forward edges.
 */
export function findReachableLeaves(graph: MigrationGraph, fromHash: string): readonly string[] {
  const leaves: string[] = [];
  for (const step of bfs([fromHash], (n) => forwardNeighbours(graph, n))) {
    if (!graph.forwardChain.get(step.node)?.length) {
      leaves.push(step.node);
    }
  }
  return leaves;
}

/**
 * Find the target contract hash of the migration graph reachable from
 * EMPTY_CONTRACT_HASH. Returns `null` for a graph that has no target
 * state (either empty, or containing only the root with no outgoing
 * edges). Throws NO_INITIAL_MIGRATION if the graph has nodes but none
 * originate from the empty hash, and AMBIGUOUS_TARGET if multiple
 * branch tips exist.
 */
export function findLeaf(graph: MigrationGraph): string | null {
  if (graph.nodes.size === 0) {
    return null;
  }

  if (!graph.nodes.has(EMPTY_CONTRACT_HASH)) {
    throw errorNoInitialMigration([...graph.nodes]);
  }

  const leaves = findReachableLeaves(graph, EMPTY_CONTRACT_HASH);

  if (leaves.length === 0) {
    const reachable = [...graph.nodes].filter((n) => n !== EMPTY_CONTRACT_HASH);
    if (reachable.length > 0) {
      throw errorNoTarget(reachable);
    }
    return null;
  }

  if (leaves.length > 1) {
    const divergencePoint = findDivergencePoint(graph, EMPTY_CONTRACT_HASH, leaves);
    const branches = leaves.map((tip) => {
      const path = findPath(graph, divergencePoint, tip);
      return {
        tip,
        edges: (path ?? []).map((e) => ({ dirName: e.dirName, from: e.from, to: e.to })),
      };
    });
    throw errorAmbiguousTarget(leaves, { divergencePoint, branches });
  }

  // biome-ignore lint/style/noNonNullAssertion: leaves.length is neither 0 nor >1 per the branches above, so exactly one leaf remains
  return leaves[0]!;
}

/**
 * Find the latest migration entry by traversing from EMPTY_CONTRACT_HASH
 * to the single target. Returns null for an empty graph.
 * Throws AMBIGUOUS_TARGET if the graph has multiple branch tips.
 */
export function findLatestMigration(graph: MigrationGraph): MigrationChainEntry | null {
  const leafHash = findLeaf(graph);
  if (leafHash === null) return null;

  const path = findPath(graph, EMPTY_CONTRACT_HASH, leafHash);
  return path?.at(-1) ?? null;
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

  // Iterative three-color DFS. A frame is (node, outgoing edges, next-index).
  interface Frame {
    node: string;
    outgoing: readonly MigrationChainEntry[];
    index: number;
  }
  const stack: Frame[] = [];

  function pushFrame(u: string): void {
    color.set(u, GRAY);
    stack.push({ node: u, outgoing: graph.forwardChain.get(u) ?? [], index: 0 });
  }

  for (const root of graph.nodes) {
    if (color.get(root) !== WHITE) continue;
    parentMap.set(root, null);
    pushFrame(root);

    while (stack.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: stack.length > 0 should guarantee that this cannot be undefined
      const frame = stack[stack.length - 1]!;
      if (frame.index >= frame.outgoing.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }
      // biome-ignore lint/style/noNonNullAssertion: the early-continue above guarantees frame.index < frame.outgoing.length here, so this is defined
      const edge = frame.outgoing[frame.index++]!;
      const v = edge.to;
      const vColor = color.get(v);
      if (vColor === GRAY) {
        const cycle: string[] = [v];
        let cur = frame.node;
        while (cur !== v) {
          cycle.push(cur);
          cur = parentMap.get(cur) ?? v;
        }
        cycle.reverse();
        cycles.push(cycle);
      } else if (vColor === WHITE) {
        parentMap.set(v, frame.node);
        pushFrame(v);
      }
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

  for (const step of bfs(startNodes, (n) => forwardNeighbours(graph, n))) {
    reachable.add(step.node);
  }

  const orphans: MigrationChainEntry[] = [];
  for (const [from, migrations] of graph.forwardChain) {
    if (!reachable.has(from)) {
      orphans.push(...migrations);
    }
  }

  return orphans;
}
