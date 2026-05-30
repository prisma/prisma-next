import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import {
  classifyMigrationListGraphTopology,
  type MigrationEdgeKind,
  type MigrationListGraphTopology,
} from '@prisma-next/migration-tools/migration-list-graph-topology';
import type { MigrationListEntry } from '@prisma-next/migration-tools/migration-list-types';

export type ConnectorKind = 'fanBelow' | 'joinAbove';

export interface MigrationLayoutRow {
  readonly kind: 'migration';
  readonly entry: MigrationListEntry;
  readonly edgeKind: MigrationEdgeKind;
  readonly laneIndex: number;
  readonly passThroughLanes: readonly number[];
  readonly woven: boolean;
}

export interface NodeLineLayoutRow {
  readonly kind: 'nodeLine';
  readonly contractHash: string;
  readonly laneIndex: number;
}

export interface ConnectorLayoutRow {
  readonly kind: 'connector';
  readonly connectorKind: ConnectorKind;
  readonly contractHash: string;
  readonly startLane: number;
  readonly endLane: number;
  readonly branchCount: number;
}

export type LayoutRow = MigrationLayoutRow | NodeLineLayoutRow | ConnectorLayoutRow;

export interface MigrationListGraphLayout {
  readonly rows: readonly LayoutRow[];
}

interface LaneState {
  want: string;
  active: boolean;
}

function canonicalFrom(from: string | null): string {
  return from ?? EMPTY_CONTRACT_HASH;
}

function forwardInDegree(topology: MigrationListGraphTopology, hash: string): number {
  return topology.forwardInDegree.get(hash) ?? 0;
}

function forwardOutDegree(topology: MigrationListGraphTopology, hash: string): number {
  return topology.forwardOutDegree.get(hash) ?? 0;
}

function buildForwardProducersByTo(
  entries: readonly MigrationListEntry[],
  kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>,
): Map<string, MigrationListEntry[]> {
  const byTo = new Map<string, MigrationListEntry[]>();
  for (const entry of entries) {
    if (kindByMigrationHash.get(entry.migrationHash) !== 'forward') continue;
    const bucket = byTo.get(entry.to);
    if (bucket) bucket.push(entry);
    else byTo.set(entry.to, [entry]);
  }
  return byTo;
}

function countForwardProducersTo(
  forwardProducersByTo: Map<string, MigrationListEntry[]>,
  contract: string,
): number {
  return forwardProducersByTo.get(contract)?.length ?? 0;
}

function hasLaterForwardDepartingFrom(
  entries: readonly MigrationListEntry[],
  startIndex: number,
  contract: string,
  kindByMigrationHash: ReadonlyMap<string, MigrationEdgeKind>,
): boolean {
  for (let index = startIndex + 1; index < entries.length; index++) {
    const later = entries[index];
    if (later === undefined) continue;
    if (kindByMigrationHash.get(later.migrationHash) !== 'forward') continue;
    if (canonicalFrom(later.from) === contract) return true;
  }
  return false;
}

export function computeMigrationListGraphLayout(
  entries: readonly MigrationListEntry[],
): MigrationListGraphLayout {
  const topology = classifyMigrationListGraphTopology(entries);
  const { kindByMigrationHash } = topology;
  const forwardProducersByTo = buildForwardProducersByTo(entries, kindByMigrationHash);
  const convergencesEmitted = new Set<string>();
  const producerLaneByHash = new Map<string, number>();
  const lanes: LaneState[] = [];
  const rows: LayoutRow[] = [];

  function emitNodeLine(contractHash: string): void {
    rows.push({ kind: 'nodeLine', contractHash, laneIndex: 0 });
  }

  function emitConnector(
    connectorKind: ConnectorKind,
    contractHash: string,
    startLane: number,
    endLane: number,
    branchCount: number,
  ): void {
    rows.push({
      kind: 'connector',
      connectorKind,
      contractHash,
      startLane,
      endLane,
      branchCount,
    });
  }

  function activeLaneIndices(): number[] {
    const indices: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index]?.active) indices.push(index);
    }
    return indices;
  }

  function lanesWanting(contract: string): number[] {
    const indices: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      const lane = lanes[index];
      if (lane?.active && lane.want === contract) indices.push(index);
    }
    return indices;
  }

  function ensureLane(index: number): void {
    while (lanes.length <= index) {
      lanes.push({ want: '', active: false });
    }
  }

  function openLaneAtRight(want: string): number {
    const index = lanes.length;
    lanes.push({ want, active: true });
    return index;
  }

  function closeLane(index: number): void {
    ensureLane(index);
    const lane = lanes[index];
    if (lane) lane.active = false;
  }

  function emitJoinAbove(contractHash: string, laneIndices: readonly number[]): void {
    if (laneIndices.length < 2) return;
    const startLane = Math.min(...laneIndices);
    const endLane = Math.max(...laneIndices);
    emitConnector('joinAbove', contractHash, startLane, endLane, laneIndices.length);
    for (const index of laneIndices) {
      if (index !== startLane) closeLane(index);
    }
  }

  function emitConvergencePreamble(contract: string): void {
    if (convergencesEmitted.has(contract)) return;
    if (forwardInDegree(topology, contract) < 2) return;

    const consumersWanting = lanesWanting(contract);
    if (forwardOutDegree(topology, contract) >= 2 && consumersWanting.length >= 2) {
      emitJoinAbove(contract, consumersWanting);
    }

    emitNodeLine(contract);
    const producers = forwardProducersByTo.get(contract) ?? [];
    if (producers.length >= 2) {
      emitConnector('fanBelow', contract, 0, producers.length - 1, producers.length);
    }

    for (const [producerIndex, producer] of producers.entries()) {
      ensureLane(producerIndex);
      lanes[producerIndex] = { want: canonicalFrom(producer.from), active: true };
      producerLaneByHash.set(producer.migrationHash, producerIndex);
    }

    convergencesEmitted.add(contract);
  }

  function placeWoven(
    entry: MigrationListEntry,
    edgeKind: MigrationEdgeKind,
    laneIndex: number,
  ): void {
    const passThroughLanes = activeLaneIndices().filter((index) => index !== laneIndex);
    rows.push({
      kind: 'migration',
      entry,
      edgeKind,
      laneIndex,
      passThroughLanes,
      woven: true,
    });
    ensureLane(laneIndex);
    lanes[laneIndex] = { want: canonicalFrom(entry.from), active: true };
  }

  function placeUnwoven(entry: MigrationListEntry, edgeKind: MigrationEdgeKind): void {
    const passThroughLanes = activeLaneIndices();
    const laneIndex = passThroughLanes.length === 0 ? 0 : Math.max(...passThroughLanes) + 1;
    rows.push({
      kind: 'migration',
      entry,
      edgeKind,
      laneIndex,
      passThroughLanes,
      woven: false,
    });
  }

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const entry = entries[entryIndex]!;
    const edgeKind = kindByMigrationHash.get(entry.migrationHash) ?? 'forward';
    const to = entry.to;

    if (edgeKind !== 'forward') {
      placeUnwoven(entry, edgeKind);
      continue;
    }

    if (forwardInDegree(topology, to) >= 2 && !convergencesEmitted.has(to)) {
      emitConvergencePreamble(to);
    }

    const presetLane = producerLaneByHash.get(entry.migrationHash);
    const wantingTo = lanesWanting(to);

    if (wantingTo.length >= 2 && countForwardProducersTo(forwardProducersByTo, to) === 1) {
      emitJoinAbove(to, wantingTo);
    }

    if (presetLane !== undefined) {
      placeWoven(entry, edgeKind, presetLane);
      continue;
    }

    const firstWanting = wantingTo[0];
    if (firstWanting !== undefined) {
      placeWoven(entry, edgeKind, firstWanting);
      continue;
    }

    if (hasLaterForwardDepartingFrom(entries, entryIndex, to, kindByMigrationHash)) {
      placeUnwoven(entry, edgeKind);
      continue;
    }

    const tipLaneIndex = openLaneAtRight(canonicalFrom(entry.from));
    placeWoven(entry, edgeKind, tipLaneIndex);
  }

  return { rows };
}
