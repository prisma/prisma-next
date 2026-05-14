import type { Contract } from '@prisma-next/contract/types';
import type {
  ContractSpaceMember,
  HydratedMigrationGraph,
} from '@prisma-next/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@prisma-next/migration-tools/graph';
import { describe, expect, it } from 'vitest';

import {
  executeFocusedExtensionStatus,
  type MigrationStatusSpaceEntry,
} from '../../src/commands/migration-status';

const HASH_A = `sha256:${'a'.repeat(64)}`;
const HASH_B = `sha256:${'b'.repeat(64)}`;
const HASH_C = `sha256:${'c'.repeat(64)}`;

function makeEmptyGraph(): MigrationGraph {
  return {
    nodes: new Set<string>(),
    forwardChain: new Map(),
    reverseChain: new Map(),
    migrationByHash: new Map(),
  };
}

function makeSingleEdgeGraph(from: string, to: string, dirName: string): MigrationGraph {
  const edge: MigrationEdge = {
    from,
    to,
    migrationHash: `sha256:${dirName.padEnd(64, 'x')}`,
    dirName,
    createdAt: '2026-01-01T00:00:00Z',
    labels: [],
    invariants: [],
  };
  return {
    nodes: new Set([from, to]),
    forwardChain: new Map([[from, [edge]]]),
    reverseChain: new Map([[to, [edge]]]),
    migrationByHash: new Map([[edge.migrationHash, edge]]),
  };
}

function makeMember(args: {
  spaceId: string;
  headHash: string;
  graph: MigrationGraph;
  packagesByMigrationHash?: HydratedMigrationGraph['packagesByMigrationHash'];
}): ContractSpaceMember {
  return {
    spaceId: args.spaceId,
    contract: { storage: { storageHash: args.headHash, tables: {} } } as unknown as Contract,
    headRef: { hash: args.headHash, invariants: [] },
    migrations: {
      graph: args.graph,
      packagesByMigrationHash: args.packagesByMigrationHash ?? new Map(),
    },
  };
}

const aggregateRow: MigrationStatusSpaceEntry = {
  spaceId: 'ext-a',
  kind: 'extension',
  headHash: HASH_A,
};

const aggregateSpaces: readonly MigrationStatusSpaceEntry[] = [
  aggregateRow,
  { spaceId: 'app', kind: 'app', headHash: HASH_C },
];

describe('executeFocusedExtensionStatus', () => {
  describe('empty graph (T6 — extension has no on-disk migrations yet)', () => {
    it('returns a single-line "no migrations" summary and zero entries', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: EMPTY_CONTRACT_HASH,
        graph: makeEmptyGraph(),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: null,
        mode: 'offline',
        aggregateSpaces,
        totalPendingAcrossSpaces: 0,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.migrations).toEqual([]);
      expect(result.value.summary).toBe('No migrations found for contract space "ext-a"');
      expect(result.value.targetHash).toBe(EMPTY_CONTRACT_HASH);
      expect(result.value.diagnostics).toEqual([]);
    });

    it('still preserves the full aggregate spaces[] and totalPendingAcrossSpaces', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: EMPTY_CONTRACT_HASH,
        graph: makeEmptyGraph(),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: null,
        mode: 'offline',
        aggregateSpaces,
        totalPendingAcrossSpaces: 5,
      });

      if (!result.ok) throw new Error('expected ok');
      expect(result.value.spaces).toBe(aggregateSpaces);
      expect(result.value.totalPendingAcrossSpaces).toBe(5);
    });
  });

  describe('online + non-empty graph', () => {
    it('surfaces MIGRATION.NO_MARKER when allMarkers has no row for the focused space', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph: makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1'),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: new Map(),
        mode: 'online',
        aggregateSpaces,
        totalPendingAcrossSpaces: 1,
      });

      if (!result.ok) throw new Error('expected ok');
      const noMarker = result.value.diagnostics.find((d) => d.code === 'MIGRATION.NO_MARKER');
      expect(noMarker).toBeDefined();
      expect(noMarker?.severity).toBe('warn');
      expect(noMarker?.message).toContain('"ext-a"');
    });

    it('emits MIGRATION.MARKER_NOT_IN_HISTORY when marker does not land in the focused graph', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph: makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1'),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: new Map([['ext-a', { storageHash: HASH_B, invariants: [] }]]),
        mode: 'online',
        aggregateSpaces,
        totalPendingAcrossSpaces: 1,
      });

      if (!result.ok) throw new Error('expected ok');
      const violation = result.value.diagnostics.find(
        (d) => d.code === 'MIGRATION.MARKER_NOT_IN_HISTORY',
      );
      expect(violation).toBeDefined();
      expect(violation?.message).toContain('"ext-a"');
      expect(result.value.markerHash).toBe(HASH_B);
    });

    it('emits MIGRATION.UP_TO_DATE when marker matches focused head', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph: makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1'),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: new Map([['ext-a', { storageHash: HASH_A, invariants: [] }]]),
        mode: 'online',
        aggregateSpaces,
        totalPendingAcrossSpaces: 0,
      });

      if (!result.ok) throw new Error('expected ok');
      expect(result.value.diagnostics.find((d) => d.code === 'MIGRATION.UP_TO_DATE')).toBeDefined();
      expect(result.value.summary).toContain('up to date');
      expect(result.value.summary).toContain('"ext-a"');
    });

    it('emits MIGRATION.DATABASE_BEHIND when marker is behind focused head', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph: makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1'),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: new Map([['ext-a', { storageHash: EMPTY_CONTRACT_HASH, invariants: [] }]]),
        mode: 'online',
        aggregateSpaces,
        totalPendingAcrossSpaces: 1,
      });

      if (!result.ok) throw new Error('expected ok');
      expect(
        result.value.diagnostics.find((d) => d.code === 'MIGRATION.DATABASE_BEHIND'),
      ).toBeDefined();
      expect(result.value.summary).toContain('pending');
      expect(result.value.summary).toContain('"ext-a"');
    });
  });

  describe('top-level fields reflect the focused space (not the app)', () => {
    it('targetHash, contractHash, graph, bundles match the extension member', async () => {
      const graph = makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1');
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph,
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: null,
        mode: 'offline',
        aggregateSpaces,
        totalPendingAcrossSpaces: undefined,
      });

      if (!result.ok) throw new Error('expected ok');
      expect(result.value.targetHash).toBe(HASH_A);
      expect(result.value.contractHash).toBe(HASH_A);
      expect(result.value.graph).toBe(graph);
      expect(result.value.bundles).toEqual([]);
    });

    it('app-space refs/invariants surface are absent (no --ref for extensions)', async () => {
      const member = makeMember({
        spaceId: 'ext-a',
        headHash: HASH_A,
        graph: makeSingleEdgeGraph(EMPTY_CONTRACT_HASH, HASH_A, 'mig-1'),
      });

      const result = await executeFocusedExtensionStatus({
        member,
        allMarkers: null,
        mode: 'offline',
        aggregateSpaces,
        totalPendingAcrossSpaces: undefined,
      });

      if (!result.ok) throw new Error('expected ok');
      expect(result.value.requiredInvariants).toEqual([]);
      expect(result.value.appliedInvariants).toBeUndefined();
      expect(result.value.missingInvariants).toBeUndefined();
      expect(result.value.activeRefHash).toBeUndefined();
      expect(result.value.activeRefName).toBeUndefined();
      expect(result.value.refs).toBeUndefined();
    });
  });
});
