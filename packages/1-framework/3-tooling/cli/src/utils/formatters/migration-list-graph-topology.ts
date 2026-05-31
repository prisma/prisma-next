import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import type { MigrationListEntry } from './migration-list-types';

export type MigrationEdgeKind = 'forward' | 'rollback' | 'self';

export interface MigrationListGraphTopology {
  readonly kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>;
  readonly forwardInDegree: ReadonlyMap<string, number>;
  readonly forwardOutDegree: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Shared classifier — operates on a normalized edge shape common to both
// MigrationListEntry (Tier-2) and MigrationEdge / MigrationGraph (Tier-3).
// ---------------------------------------------------------------------------

interface NormalizedEdge {
  readonly hash: string;
  readonly from: string;
  readonly to: string;
  readonly dirName: string;
}

function compareDirNameDesc(a: NormalizedEdge, b: NormalizedEdge): number {
  return b.dirName.localeCompare(a.dirName);
}

function bumpDegree(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function forwardRootsForDepth(
  nodes: ReadonlySet<string>,
  candidates: readonly NormalizedEdge[],
): readonly string[] {
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    inDegree.set(node, 0);
  }
  for (const edge of candidates) {
    bumpDegree(inDegree, edge.to);
  }

  const roots: string[] = [];
  for (const node of nodes) {
    if ((inDegree.get(node) ?? 0) === 0) {
      roots.push(node);
    }
  }
  roots.sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });
  if (roots.length > 0) return roots;

  return [...nodes].sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });
}

function longestPathDepths(
  nodes: ReadonlySet<string>,
  candidates: readonly NormalizedEdge[],
): Map<string, number> {
  const depth = new Map<string, number>();
  for (const root of forwardRootsForDepth(nodes, candidates)) {
    depth.set(root, 0);
  }

  const maxPasses = nodes.size;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const edge of candidates) {
      const base = depth.get(edge.from);
      if (base === undefined) continue;
      const next = base + 1;
      if (next > (depth.get(edge.to) ?? -1)) {
        depth.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }

  for (const node of nodes) {
    if (!depth.has(node)) {
      depth.set(node, 0);
    }
  }

  return depth;
}

function canReachForward(
  start: string,
  goal: string,
  candidates: readonly NormalizedEdge[],
): boolean {
  if (start === goal) return true;

  const outgoing = new Map<string, string[]>();
  for (const edge of candidates) {
    const bucket = outgoing.get(edge.from);
    if (bucket) bucket.push(edge.to);
    else outgoing.set(edge.from, [edge.to]);
  }

  const visited = new Set<string>([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) continue;
    for (const next of outgoing.get(node) ?? []) {
      if (next === goal) return true;
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }

  return false;
}

function isMarginalForwardEdge(
  nodes: ReadonlySet<string>,
  candidates: readonly NormalizedEdge[],
  edge: NormalizedEdge,
): boolean {
  const without = candidates.filter((candidate) => candidate !== edge);
  const depthWithout = longestPathDepths(nodes, without);
  const depthWith = longestPathDepths(nodes, candidates);
  const fromDepth = depthWithout.get(edge.from) ?? 0;
  const toWith = depthWith.get(edge.to) ?? 0;
  return toWith > fromDepth;
}

function shouldPeelForwardEdge(
  nodes: ReadonlySet<string>,
  candidates: readonly NormalizedEdge[],
  edge: NormalizedEdge,
): boolean {
  const without = candidates.filter((candidate) => candidate !== edge);
  const depthWithout = longestPathDepths(nodes, without);
  const fromDepth = depthWithout.get(edge.from) ?? 0;
  const toWithout = depthWithout.get(edge.to) ?? 0;

  if (canReachForward(edge.to, edge.from, without) && fromDepth > toWithout + 1) {
    return true;
  }

  return !isMarginalForwardEdge(nodes, candidates, edge);
}

function peelNonMarginalForwardEdges(
  nodes: ReadonlySet<string>,
  kindByMigrationHash: Map<string, MigrationEdgeKind>,
  nonSelf: readonly NormalizedEdge[],
): void {
  let candidates = nonSelf.filter((edge) => kindByMigrationHash.get(edge.hash) === 'forward');

  while (candidates.length > 0) {
    const rollbackCandidates = candidates.filter((edge) =>
      shouldPeelForwardEdge(nodes, candidates, edge),
    );
    if (rollbackCandidates.length === 0) break;

    rollbackCandidates.sort(compareDirNameDesc);
    const rollback = rollbackCandidates[0];
    if (rollback === undefined) break;

    kindByMigrationHash.set(rollback.hash, 'rollback');
    candidates = candidates.filter((edge) => edge !== rollback);
  }
}

/**
 * DFS with dirName-descending traversal. A GRAY target is a rollback only when it
 * is the immediate DFS parent of the source — cross-links to other GRAY nodes
 * stay forward. A follow-up peel pass drops node-skipping rollbacks (target can
 * reach the source on the forward subgraph and sits more than one rank below).
 */
function classifyNormalizedEdges(edges: readonly NormalizedEdge[]): MigrationListGraphTopology {
  const nodes = new Set<string>();
  const kindByMigrationHash = new Map<string, MigrationEdgeKind>();
  const outgoingByFrom = new Map<string, NormalizedEdge[]>();
  const nonSelf: NormalizedEdge[] = [];

  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);

    if (edge.from === edge.to) {
      kindByMigrationHash.set(edge.hash, 'self');
      continue;
    }

    nonSelf.push(edge);
    const bucket = outgoingByFrom.get(edge.from);
    if (bucket) bucket.push(edge);
    else outgoingByFrom.set(edge.from, [edge]);
  }

  for (const bucket of outgoingByFrom.values()) {
    bucket.sort(compareDirNameDesc);
  }

  const nonSelfInDegree = new Map<string, number>();
  for (const node of nodes) {
    nonSelfInDegree.set(node, 0);
  }
  for (const bucket of outgoingByFrom.values()) {
    for (const edge of bucket) {
      bumpDegree(nonSelfInDegree, edge.to);
    }
  }

  const dfsRoots: string[] = [];
  for (const node of nodes) {
    if ((nonSelfInDegree.get(node) ?? 0) === 0) {
      dfsRoots.push(node);
    }
  }
  dfsRoots.sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });
  if (dfsRoots.length === 0) {
    dfsRoots.push(...[...nodes].sort((a, b) => a.localeCompare(b)));
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const dfsParent = new Map<string, string | undefined>();
  for (const node of nodes) {
    color.set(node, WHITE);
  }

  interface Frame {
    node: string;
    outgoing: readonly NormalizedEdge[];
    index: number;
  }
  const stack: Frame[] = [];

  function isImmediateDfsParent(ancestor: string, node: string): boolean {
    return dfsParent.get(node) === ancestor;
  }

  function pushFrame(node: string, parent: string | undefined): void {
    color.set(node, GRAY);
    dfsParent.set(node, parent);
    stack.push({ node, outgoing: outgoingByFrom.get(node) ?? [], index: 0 });
  }

  function runDfsFrom(root: string): void {
    if (color.get(root) !== WHITE) return;
    pushFrame(root, undefined);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      if (frame.index >= frame.outgoing.length) {
        color.set(frame.node, BLACK);
        stack.pop();
        continue;
      }

      const edge = frame.outgoing[frame.index];
      frame.index += 1;
      if (edge === undefined) continue;

      const v = edge.to;
      const vColor = color.get(v);
      if (vColor === GRAY && isImmediateDfsParent(v, frame.node)) {
        kindByMigrationHash.set(edge.hash, 'rollback');
      } else {
        kindByMigrationHash.set(edge.hash, 'forward');
        if (vColor === WHITE) {
          pushFrame(v, frame.node);
        }
      }
    }
  }

  for (const root of dfsRoots) {
    runDfsFrom(root);
  }
  const remainingWhite = [...nodes].filter((node) => color.get(node) === WHITE);
  remainingWhite.sort((a, b) => a.localeCompare(b));
  for (const root of remainingWhite) {
    runDfsFrom(root);
  }

  peelNonMarginalForwardEdges(nodes, kindByMigrationHash, nonSelf);

  const forwardInDegree = new Map<string, number>();
  const forwardOutDegree = new Map<string, number>();

  for (const edge of edges) {
    if (kindByMigrationHash.get(edge.hash) !== 'forward') continue;
    bumpDegree(forwardOutDegree, edge.from);
    bumpDegree(forwardInDegree, edge.to);
  }

  return {
    kindByMigrationHash,
    forwardInDegree,
    forwardOutDegree,
  };
}

function canonicalFrom(from: string | null): string {
  return from ?? EMPTY_CONTRACT_HASH;
}

/**
 * Classify forward/rollback/self for a Tier-2 `MigrationListEntry[]` edge set.
 * Returns the kind of each migration plus the forward in/out degree of each
 * contract node. This is the established Tier-2 surface; its behaviour is
 * unchanged — only its implementation now delegates to the shared classifier.
 */
export function classifyMigrationListGraphTopology(
  entries: readonly MigrationListEntry[],
): MigrationListGraphTopology {
  const normalized: NormalizedEdge[] = entries.map((entry) => ({
    hash: entry.migrationHash,
    from: canonicalFrom(entry.from),
    to: entry.to,
    dirName: entry.dirName,
  }));
  return classifyNormalizedEdges(normalized);
}

/**
 * Classify forward/rollback/self for a `MigrationGraph` edge set (Tier-3).
 * Delegates to the same shared classifier as `classifyMigrationListGraphTopology`
 * so both tiers agree on forward/rollback/self without duplicating logic.
 */
export function classifyMigrationGraphTopology(graph: MigrationGraph): MigrationListGraphTopology {
  const normalized: NormalizedEdge[] = [];
  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      normalized.push({
        hash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
        dirName: edge.dirName,
      });
    }
  }
  return classifyNormalizedEdges(normalized);
}
