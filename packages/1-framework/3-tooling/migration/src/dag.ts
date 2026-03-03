import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import {
  errorAmbiguousLeaf,
  errorDuplicateMigrationId,
  errorNoLeaf,
  errorSelfLoop,
} from './errors';
import type { MigrationChainEntry, MigrationGraph, MigrationPackage } from './types';

export function reconstructGraph(packages: readonly MigrationPackage[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationById = new Map<string, MigrationChainEntry>();
  const childrenByParentId = new Map<string | null, MigrationChainEntry[]>();

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
      parentMigrationId: pkg.manifest.parentMigrationId,
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

    const parentId = migration.parentMigrationId;
    const siblings = childrenByParentId.get(parentId);
    if (siblings) {
      siblings.push(migration);
    } else {
      childrenByParentId.set(parentId, [migration]);
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

  return { nodes, forwardChain, reverseChain, migrationById, childrenByParentId };
}

/**
 * Walk the parent-migration chain to find the latest migration.
 * Returns the migration with no children, or null for an empty graph.
 * Throws AMBIGUOUS_LEAF if the chain branches.
 */
export function findLatestMigration(graph: MigrationGraph): MigrationChainEntry | null {
  if (graph.nodes.size === 0) {
    return null;
  }

  const roots = graph.childrenByParentId.get(null);
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

  for (let depth = 0; depth < graph.migrationById.size + 1 && current; depth++) {
    const children: readonly MigrationChainEntry[] | undefined =
      current.migrationId !== null ? graph.childrenByParentId.get(current.migrationId) : undefined;

    if (!children || children.length === 0) {
      return current;
    }

    if (children.length > 1) {
      throw errorAmbiguousLeaf(children.map((e) => e.to));
    }

    current = children[0];
  }

  throw errorNoLeaf([...graph.nodes].sort());
}

/**
 * Find the leaf contract hash of the migration chain.
 * Convenience wrapper around findLatestMigration.
 */
export function findLeaf(graph: MigrationGraph): string {
  const migration = findLatestMigration(graph);
  return migration ? migration.to : EMPTY_CONTRACT_HASH;
}

/**
 * Find the ordered chain of migrations from `fromHash` to `toHash` by walking the
 * parent-migration chain. Returns the sub-sequence of migrations whose cumulative path
 * goes from `fromHash` to `toHash`.
 *
 * This reconstructs the full chain from root to leaf via parent pointers, then
 * extracts the segment between the two hashes. This correctly handles revisited
 * contract hashes (e.g. A→B→A) because it operates on migrations, not nodes.
 */
export function findPath(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
): readonly MigrationChainEntry[] | null {
  if (fromHash === toHash) return [];

  const chain = buildChain(graph);
  if (!chain) return null;

  let startIdx = -1;
  if (chain.length > 0 && chain[0]?.from === fromHash) {
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
 * Build the full ordered chain of migrations from root to leaf by following
 * parent pointers. Returns null if the chain cannot be reconstructed
 * (e.g. missing root, branches).
 */
function buildChain(graph: MigrationGraph): readonly MigrationChainEntry[] | null {
  const roots = graph.childrenByParentId.get(null);
  if (!roots || roots.length !== 1) return null;

  const chain: MigrationChainEntry[] = [];
  let current: MigrationChainEntry | undefined = roots[0];

  for (let depth = 0; depth < graph.migrationById.size + 1 && current; depth++) {
    chain.push(current);
    const children =
      current.migrationId !== null ? graph.childrenByParentId.get(current.migrationId) : undefined;
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

    const outgoing = graph.forwardChain.get(u);
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

export function detectOrphans(graph: MigrationGraph): readonly MigrationChainEntry[] {
  if (graph.nodes.size === 0) return [];

  const reachable = new Set<string>();
  const rootMigrations = graph.childrenByParentId.get(null) ?? [];
  const emptyRootExists = rootMigrations.some(
    (migration) => migration.from === EMPTY_CONTRACT_HASH,
  );
  const rootHashes = emptyRootExists
    ? [EMPTY_CONTRACT_HASH]
    : [...new Set(rootMigrations.map((migration) => migration.from))];
  const queue: string[] = rootHashes.length > 0 ? rootHashes : [EMPTY_CONTRACT_HASH];

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
