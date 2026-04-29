import { ifDefined } from '@prisma-next/utils/defined';
import { EMPTY_CONTRACT_HASH } from './constants';
import {
  errorAmbiguousTarget,
  errorDuplicateMigrationHash,
  errorNoInitialMigration,
  errorNoTarget,
  errorSameSourceAndTarget,
} from './errors';
import type { MigrationEdge, MigrationGraph } from './graph';
import { bfs } from './graph-ops';
import type { MigrationPackage } from './package';

/** Forward-edge neighbours: edge `e` from `n` visits `e.to` next. */
function forwardNeighbours(graph: MigrationGraph, node: string) {
  return (graph.forwardChain.get(node) ?? []).map((edge) => ({ next: edge.to, edge }));
}

/**
 * Forward-edge neighbours, sorted by the deterministic tie-break.
 * Used by path-finding so the resulting shortest path is stable across runs.
 */
function sortedForwardNeighbours(graph: MigrationGraph, node: string) {
  const edges = graph.forwardChain.get(node) ?? [];
  return [...edges].sort(compareTieBreak).map((edge) => ({ next: edge.to, edge }));
}

/** Reverse-edge neighbours: edge `e` from `n` visits `e.from` next. */
function reverseNeighbours(graph: MigrationGraph, node: string) {
  return (graph.reverseChain.get(node) ?? []).map((edge) => ({ next: edge.from, edge }));
}

function appendEdge(map: Map<string, MigrationEdge[]>, key: string, entry: MigrationEdge): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}

export function reconstructGraph(packages: readonly MigrationPackage[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();

  for (const pkg of packages) {
    const { from, to } = pkg.metadata;

    if (from === to) {
      throw errorSameSourceAndTarget(pkg.dirPath, from);
    }

    nodes.add(from);
    nodes.add(to);

    const migration: MigrationEdge = {
      from,
      to,
      migrationHash: pkg.metadata.migrationHash,
      dirName: pkg.dirName,
      createdAt: pkg.metadata.createdAt,
      labels: pkg.metadata.labels,
      invariants: pkg.metadata.providedInvariants,
    };

    if (migrationByHash.has(migration.migrationHash)) {
      throw errorDuplicateMigrationHash(migration.migrationHash);
    }
    migrationByHash.set(migration.migrationHash, migration);

    appendEdge(forwardChain, from, migration);
    appendEdge(reverseChain, to, migration);
  }

  return { nodes, forwardChain, reverseChain, migrationByHash };
}

// ---------------------------------------------------------------------------
// Deterministic tie-breaking for BFS neighbour order.
// Used by path-finders only; not a general-purpose utility.
// Ordering: label priority → createdAt → to → migrationHash.
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

function compareTieBreak(a: MigrationEdge, b: MigrationEdge): number {
  const lp = labelPriority(a.labels) - labelPriority(b.labels);
  if (lp !== 0) return lp;
  const ca = a.createdAt.localeCompare(b.createdAt);
  if (ca !== 0) return ca;
  const tc = a.to.localeCompare(b.to);
  if (tc !== 0) return tc;
  return a.migrationHash.localeCompare(b.migrationHash);
}

function sortedNeighbors(edges: readonly MigrationEdge[]): readonly MigrationEdge[] {
  return [...edges].sort(compareTieBreak);
}

/**
 * Find the shortest path from `fromHash` to `toHash` using BFS over the
 * contract-hash graph. Returns the ordered list of edges, or null if no path
 * exists. Returns an empty array when `fromHash === toHash` (no-op).
 *
 * Neighbor ordering is deterministic via the tie-break sort key:
 * label priority → createdAt → to → migrationHash.
 */
export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationEdge[] | null {
  if (fromHash === toHash) return [];

  const parents = new Map<string, { parent: string; edge: MigrationEdge }>();
  for (const step of bfs([fromHash], (n) => sortedForwardNeighbours(graph, n))) {
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(step.state, { parent: step.parent, edge: step.incomingEdge });
    }
    if (step.state === toHash) {
      const path: MigrationEdge[] = [];
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
 * Find the shortest path from `fromHash` to `toHash` whose edges collectively
 * cover every invariant in `required`. Returns `null` when no such path exists
 * (either `fromHash`→`toHash` is structurally unreachable, or every reachable
 * path leaves at least one required invariant uncovered). When `required` is
 * empty, delegates to `findPath` so the result is byte-identical for that case.
 *
 * Algorithm: BFS over `(node, coveredSubset)` states with state-level dedup.
 * The covered subset is encoded as a 30-bit unsigned mask over a sorted
 * enumeration of `required` — fast for the typical small-k case and capped
 * at entry to fail loudly past 30 rather than silently misbehave from JS's
 * signed 32-bit bitwise ops.
 *
 * Neighbour ordering when `required ≠ ∅`: edges covering ≥1 still-needed
 * invariant come first, with `labelPriority → createdAt → to → migrationHash`
 * as the secondary key. The heuristic steers BFS toward the satisfying path;
 * correctness (shortest, deterministic) does not depend on it.
 */
export function findPathWithInvariants(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
  required: ReadonlySet<string>,
): readonly MigrationEdge[] | null {
  if (required.size === 0) {
    return findPath(graph, fromHash, toHash);
  }
  if (fromHash === toHash) {
    // Empty path covers no invariants; required is non-empty ⇒ unsatisfiable.
    return null;
  }
  if (required.size > 30) {
    throw new Error(
      `Cannot route with more than 30 required invariants in a single call (got ${required.size}). Please file an issue if you need a higher cap.`,
    );
  }

  const requiredArr = [...required].sort();
  const requiredBit = new Map<string, number>();
  for (const [i, val] of requiredArr.entries()) {
    requiredBit.set(val, 1 << i);
  }
  const fullMask = (1 << requiredArr.length) - 1;

  const edgeMaskOf = (edge: MigrationEdge): number => {
    let m = 0;
    for (const inv of edge.invariants) {
      const bit = requiredBit.get(inv);
      if (bit !== undefined) m |= bit;
    }
    return m;
  };

  interface InvState {
    readonly node: string;
    readonly mask: number;
  }
  // State key: `${node}\0${mask}`. \0 cannot appear in any node identifier
  // we emit (sha256 hex or `h:`-prefixed test hashes), so distinct
  // (node, mask) tuples always produce distinct keys regardless of node
  // length.
  const stateKey = (s: InvState) => `${s.node}\0${s.mask}`;

  // Cache edgeMaskOf per edge — outgoing edges are visited many times during
  // BFS and the comparator calls edgeMaskOf each time, so naive recomputation
  // is O(k) per edge per visit.
  const edgeMaskCache = new Map<MigrationEdge, number>();
  const memoEdgeMask = (edge: MigrationEdge): number => {
    const cached = edgeMaskCache.get(edge);
    if (cached !== undefined) return cached;
    const m = edgeMaskOf(edge);
    edgeMaskCache.set(edge, m);
    return m;
  };

  const neighbours = (s: InvState): Iterable<{ next: InvState; edge: MigrationEdge }> => {
    const outgoing = graph.forwardChain.get(s.node) ?? [];
    if (outgoing.length === 0) return [];
    const remainingMask = fullMask & ~s.mask;
    // Annotate once, sort by precomputed keys. D11: invariant-covering edges
    // first, then the existing tie-break.
    const annotated = outgoing.map((edge) => {
      const provided = memoEdgeMask(edge);
      return {
        edge,
        provided,
        useful: (provided & remainingMask) !== 0 ? 1 : 0,
      };
    });
    annotated.sort((a, b) => {
      if (a.useful !== b.useful) return b.useful - a.useful;
      return compareTieBreak(a.edge, b.edge);
    });
    return annotated.map(({ edge, provided }) => ({
      next: { node: edge.to, mask: s.mask | provided },
      edge,
    }));
  };

  // Path reconstruction is consumer-side, keyed on stateKey, same shape as
  // findPath's parents map.
  const parents = new Map<string, { parentKey: string; edge: MigrationEdge }>();
  for (const step of bfs<InvState, MigrationEdge>(
    [{ node: fromHash, mask: 0 }],
    neighbours,
    stateKey,
  )) {
    const curKey = stateKey(step.state);
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(curKey, { parentKey: stateKey(step.parent), edge: step.incomingEdge });
    }
    if (step.state.node === toHash && step.state.mask === fullMask) {
      const path: MigrationEdge[] = [];
      let cur: string | undefined = curKey;
      while (cur !== undefined) {
        const p = parents.get(cur);
        if (!p) break;
        path.push(p.edge);
        cur = p.parentKey;
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
    reached.add(step.state);
  }
  return reached;
}

export interface PathDecision {
  readonly selectedPath: readonly MigrationEdge[];
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
        if (sorted[0] && sorted[0].migrationHash === edge.migrationHash) {
          if (reachable.some((e) => e.migrationHash !== edge.migrationHash)) {
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
      ancestors.add(step.state);
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
    if (!graph.forwardChain.get(step.state)?.length) {
      leaves.push(step.state);
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
export function findLatestMigration(graph: MigrationGraph): MigrationEdge | null {
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
    outgoing: readonly MigrationEdge[];
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

export function detectOrphans(graph: MigrationGraph): readonly MigrationEdge[] {
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
    reachable.add(step.state);
  }

  const orphans: MigrationEdge[] = [];
  for (const [from, migrations] of graph.forwardChain) {
    if (!reachable.has(from)) {
      orphans.push(...migrations);
    }
  }

  return orphans;
}
