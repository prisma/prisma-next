import { computeMigrationListGraphLayout } from '@prisma-next/migration-tools/migration-list-graph-layout';
import { classifyMigrationListGraphTopology } from '@prisma-next/migration-tools/migration-list-graph-topology';
import type { MigrationListEntry } from '@prisma-next/migration-tools/migration-list-types';

let hashSeq = 0;

export function contractHash(seven: string): string {
  return `sha256:${seven}${'0'.repeat(57)}`;
}

export function migrationEntry(
  dirName: string,
  from: string | null,
  to: string,
  migrationHash?: string,
): MigrationListEntry {
  return {
    dirName,
    from,
    to,
    migrationHash: migrationHash ?? `sha256:graph-fixture-${hashSeq++}`,
    operationCount: 1,
    createdAt: '2026-02-25T14:00:00.000Z',
    refs: [],
    providedInvariants: [],
  };
}

export function layoutFor(entries: readonly MigrationListEntry[]) {
  return computeMigrationListGraphLayout(entries);
}

export function kindsFor(entries: readonly MigrationListEntry[]) {
  return classifyMigrationListGraphTopology(entries).kindByMigrationHash;
}

export const HASH = {
  abc1234: contractHash('abc1234'),
  def5678: contractHash('def5678'),
  ghi7890: contractHash('ghi7890'),
  jkl1234: contractHash('jkl1234'),
  f03da82: contractHash('f03da82'),
  seven1b: contractHash('7e1b9a0'),
  nine4f1: contractHash('9c4f1e7'),
  d41a8c3: contractHash('d41a8c3'),
  a1b2c3d: contractHash('a1b2c3d'),
  b1c2d3e: contractHash('b1c2d3e'),
  c1d2e3f: contractHash('c1d2e3f'),
  fourcb4: contractHash('4cb4256'),
  e1f2a3b: contractHash('e1f2a3b'),
  c4d5e6f: contractHash('c4d5e6f'),
  hashfeed: contractHash('feed000'),
  hashdead: contractHash('dead000'),
  rootA: contractHash('root00a'),
  rootB: contractHash('root00b'),
  mid: contractHash('mid0000'),
  tip: contractHash('tip0000'),
} as const;
