import { EMPTY_CONTRACT_HASH } from './constants';
import { classifyMigrationListGraphTopology, type EdgeKind } from './migration-list-graph-topology';
import type { MigrationListEntry } from './migration-list-types';

export type ConnectorKind = 'fanBelow' | 'joinBelow';

export interface MigrationLayoutRow {
  readonly kind: 'migration';
  readonly entry: MigrationListEntry;
  readonly edgeKind: EdgeKind;
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

function canonicalTo(entry: MigrationListEntry): string {
  return entry.to;
}

function forwardInDegree(
  topology: ReturnType<typeof classifyMigrationListGraphTopology>,
  hash: string,
): number {
  return topology.forwardInDegree.get(hash) ?? 0;
}

function forwardOutDegree(
  topology: ReturnType<typeof classifyMigrationListGraphTopology>,
  hash: string,
): number {
  return topology.forwardOutDegree.get(hash) ?? 0;
}

function buildForwardProducersByTo(
  entries: readonly MigrationListEntry[],
  kindByMigrationHash: ReadonlyMap<string, EdgeKind>,
): Map<string, MigrationListEntry[]> {
  const byTo = new Map<string, MigrationListEntry[]>();
  for (const entry of entries) {
    if (kindByMigrationHash.get(entry.migrationHash) !== 'forward') continue;
    const to = canonicalTo(entry);
    const bucket = byTo.get(to);
    if (bucket) bucket.push(entry);
    else byTo.set(to, [entry]);
  }
  return byTo;
}

function countForwardProducersTo(
  forwardProducersByTo: Map<string, MigrationListEntry[]>,
  contract: string,
): number {
  return forwardProducersByTo.get(contract)?.length ?? 0;
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

  function emitJoinBelow(contractHash: string, laneIndices: readonly number[]): void {
    if (laneIndices.length < 2) return;
    const startLane = Math.min(...laneIndices);
    const endLane = Math.max(...laneIndices);
    emitConnector('joinBelow', contractHash, startLane, endLane, laneIndices.length);
    for (const index of laneIndices) {
      if (index !== startLane) closeLane(index);
    }
  }

  function emitConvergencePreamble(contract: string): void {
    if (convergencesEmitted.has(contract)) return;
    if (forwardInDegree(topology, contract) < 2) return;

    const consumersWanting = lanesWanting(contract);
    if (forwardOutDegree(topology, contract) >= 2 && consumersWanting.length >= 2) {
      emitJoinBelow(contract, consumersWanting);
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

  function assignProducerLane(entry: MigrationListEntry): number | undefined {
    const preset = producerLaneByHash.get(entry.migrationHash);
    if (preset !== undefined) return preset;
    return undefined;
  }

  function placeWoven(entry: MigrationListEntry, edgeKind: EdgeKind, laneIndex: number): void {
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

  function placeUnwoven(entry: MigrationListEntry, edgeKind: EdgeKind): void {
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

  for (const entry of entries) {
    const edgeKind = kindByMigrationHash.get(entry.migrationHash) ?? 'forward';
    const to = canonicalTo(entry);

    if (edgeKind !== 'forward') {
      placeUnwoven(entry, edgeKind);
      continue;
    }

    if (forwardInDegree(topology, to) >= 2 && !convergencesEmitted.has(to)) {
      emitConvergencePreamble(to);
    }

    const presetLane = assignProducerLane(entry);
    const wantingTo = lanesWanting(to);

    if (wantingTo.length >= 2 && countForwardProducersTo(forwardProducersByTo, to) === 1) {
      emitJoinBelow(to, wantingTo);
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

    const tipLaneIndex = openLaneAtRight(canonicalFrom(entry.from));
    placeWoven(entry, edgeKind, tipLaneIndex);
  }

  return { rows };
}
