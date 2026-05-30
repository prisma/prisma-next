import { EMPTY_CONTRACT_HASH } from './constants';
import type { MigrationListEntry } from './migration-list-types';

export type EdgeKind = 'forward' | 'rollback' | 'self';

export interface MigrationGraphTopology {
  readonly kindByMigrationHash: ReadonlyMap<string, EdgeKind>;
  readonly forwardInDegree: ReadonlyMap<string, number>;
  readonly forwardOutDegree: ReadonlyMap<string, number>;
}

interface NonSelfEdge {
  readonly entry: MigrationListEntry;
  readonly from: string;
  readonly to: string;
}

function canonicalFrom(from: string | null): string {
  return from ?? EMPTY_CONTRACT_HASH;
}

function compareDirNameDesc(a: MigrationListEntry, b: MigrationListEntry): number {
  return b.dirName.localeCompare(a.dirName);
}

function bumpDegree(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function classifyMigrationListGraphTopology(
  entries: readonly MigrationListEntry[],
): MigrationGraphTopology {
  const nodes = new Set<string>();
  const kindByMigrationHash = new Map<string, EdgeKind>();
  const outgoingByFrom = new Map<string, NonSelfEdge[]>();

  for (const entry of entries) {
    const from = canonicalFrom(entry.from);
    const to = entry.to;
    nodes.add(from);
    nodes.add(to);

    if (from === to) {
      kindByMigrationHash.set(entry.migrationHash, 'self');
      continue;
    }

    const bucket = outgoingByFrom.get(from);
    const edge: NonSelfEdge = { entry, from, to };
    if (bucket) bucket.push(edge);
    else outgoingByFrom.set(from, [edge]);
  }

  for (const bucket of outgoingByFrom.values()) {
    bucket.sort((a, b) => compareDirNameDesc(a.entry, b.entry));
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
    outgoing: readonly NonSelfEdge[];
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
        kindByMigrationHash.set(edge.entry.migrationHash, 'rollback');
      } else {
        kindByMigrationHash.set(edge.entry.migrationHash, 'forward');
        if (vColor === WHITE) {
          pushFrame(v);
        }
      }
    }
  }

  for (const root of dfsRoots) {
    runDfsFrom(root);
  }
  for (const root of nodes) {
    runDfsFrom(root);
  }

  const forwardInDegree = new Map<string, number>();
  const forwardOutDegree = new Map<string, number>();

  for (const entry of entries) {
    if (kindByMigrationHash.get(entry.migrationHash) !== 'forward') continue;
    const from = canonicalFrom(entry.from);
    const to = entry.to;
    bumpDegree(forwardOutDegree, from);
    bumpDegree(forwardInDegree, to);
  }

  return {
    kindByMigrationHash,
    forwardInDegree,
    forwardOutDegree,
  };
}
