import type { MigrationChainEntry, MigrationGraph } from '@prisma-next/migration-tools/graph';

export function entry(from: string, to: string, dirName: string): MigrationChainEntry {
  return { from, to, dirName, migrationHash: `mid_${dirName}`, createdAt: '', labels: [] };
}

export function buildGraph(entries: MigrationChainEntry[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationChainEntry[]>();
  const reverseChain = new Map<string, MigrationChainEntry[]>();
  const migrationByHash = new Map<string, MigrationChainEntry>();

  for (const e of entries) {
    nodes.add(e.from);
    nodes.add(e.to);
    if (!forwardChain.has(e.from)) forwardChain.set(e.from, []);
    forwardChain.get(e.from)!.push(e);
    if (!reverseChain.has(e.to)) reverseChain.set(e.to, []);
    reverseChain.get(e.to)!.push(e);
    migrationByHash.set(e.migrationHash, e);
  }

  return { nodes, forwardChain, reverseChain, migrationByHash };
}
