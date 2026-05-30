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
// Shared DFS classifier — operates on a normalized edge shape common to both
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

/**
 * Core DFS classifier. Accepts a normalized edge set and produces the full
 * topology: kind per migration hash, plus forward in/out degrees per node.
 *
 * Both Tier-2 (classifyMigrationListGraphTopology) and Tier-3
 * (classifyMigrationGraphTopology) delegate here after normalizing their
 * respective input types. The DFS algorithm — back-edge detection, dirName-
 * descending neighbour order, root-seeding, cycle fallback — lives in exactly
 * one place so both tiers agree on forward/rollback/self classification.
 */
function classifyNormalizedEdges(edges: readonly NormalizedEdge[]): MigrationListGraphTopology {
  const nodes = new Set<string>();
  const kindByMigrationHash = new Map<string, MigrationEdgeKind>();
  const outgoingByFrom = new Map<string, NormalizedEdge[]>();

  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);

    if (edge.from === edge.to) {
      kindByMigrationHash.set(edge.hash, 'self');
      continue;
    }

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
  for (const node of nodes) {
    color.set(node, WHITE);
  }

  interface Frame {
    node: string;
    outgoing: readonly NormalizedEdge[];
    index: number;
  }
  const stack: Frame[] = [];

  function pushFrame(node: string): void {
    color.set(node, GRAY);
    stack.push({ node, outgoing: outgoingByFrom.get(node) ?? [], index: 0 });
  }

  function runDfsFrom(root: string): void {
    if (color.get(root) !== WHITE) return;
    pushFrame(root);

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
      if (vColor === GRAY) {
        kindByMigrationHash.set(edge.hash, 'rollback');
      } else {
        kindByMigrationHash.set(edge.hash, 'forward');
        if (vColor === WHITE) {
          pushFrame(v);
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
 * unchanged — only its implementation now delegates to the shared DFS core.
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
 * Delegates to the same shared DFS core as `classifyMigrationListGraphTopology`
 * so both tiers agree on classification without duplicating the DFS algorithm.
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
