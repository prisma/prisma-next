/**
 * Maps MigrationGraph + status info to the generic graph renderer types.
 */
import { EMPTY_CONTRACT_HASH } from '@prisma-next/core-control-plane/constants';
import { findPath } from '@prisma-next/migration-tools/dag';
import type { MigrationGraph } from '@prisma-next/migration-tools/types';
import { ifDefined } from '@prisma-next/utils/defined';

import type { StatusRef } from '../migration-types';
import {
  type GraphEdge,
  type GraphNode,
  type GraphRenderOptions,
  type NodeMarker,
  RenderGraph,
} from './graph-types';

export type EdgeStatusKind = 'applied' | 'pending' | 'unreachable';

const STATUS_ICON: Record<EdgeStatusKind, string> = {
  applied: ' ✓',
  pending: ' ⧗',
  unreachable: ' ✗',
};

/** Shorten a contract hash for display: strip sha256: prefix, take 7 chars. */
function shortHash(hash: string): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, 7);
}

function toShortId(hash: string): string {
  return hash === EMPTY_CONTRACT_HASH ? '∅' : shortHash(hash);
}

/** Minimal per-edge status from the CLI's status result. */
export interface EdgeStatus {
  readonly dirName: string;
  readonly status: EdgeStatusKind;
}

export interface MigrationGraphInput {
  readonly graph: MigrationGraph;
  readonly mode: 'online' | 'offline';
  readonly markerHash?: string | undefined;
  readonly contractHash: string;
  readonly refs?: readonly StatusRef[] | undefined;
  readonly activeRefHash?: string | undefined;
  readonly activeRefName?: string | undefined;
  /**
   * Per-edge applied/pending status from the ledger. When provided, status
   * icons (✓/⧗) are baked into edge labels. Undefined in offline mode.
   */
  readonly edgeStatuses?: readonly EdgeStatus[] | undefined;
}

export interface MigrationRenderInput {
  readonly graph: RenderGraph;
  readonly options: GraphRenderOptions;
  /** All relevant paths (root→contract, root→marker, root→ref). */
  readonly relevantPaths: readonly (readonly string[])[];
}

/**
 * Convert a MigrationGraph + status info into the generic graph renderer types.
 */
export function migrationGraphToRenderInput(input: MigrationGraphInput): MigrationRenderInput {
  const { graph, mode, markerHash, contractHash, refs, activeRefHash, edgeStatuses } = input;

  const statusByDirName = new Map(edgeStatuses?.map((e) => [e.dirName, e.status]));

  // Build nodes
  const nodeList: GraphNode[] = [];
  for (const nodeId of graph.nodes) {
    const markers: NodeMarker[] = [];

    // DB marker
    if (mode === 'online' && markerHash === nodeId) {
      markers.push({ kind: 'db' });
    }

    // Ref markers
    if (refs) {
      for (const ref of refs) {
        if (ref.hash === nodeId) {
          markers.push({ kind: 'ref', name: ref.name, active: ref.active });
        }
      }
    }

    // Contract marker
    if (contractHash === nodeId && contractHash !== EMPTY_CONTRACT_HASH) {
      markers.push({ kind: 'contract', planned: true });
    }

    nodeList.push({
      id: toShortId(nodeId),
      markers: markers.length > 0 ? markers : undefined,
    });
  }

  // Detached contract node (not in graph)
  if (contractHash !== EMPTY_CONTRACT_HASH && !graph.nodes.has(contractHash)) {
    const detachedMarkers: NodeMarker[] = [];
    if (mode === 'online' && markerHash === contractHash) {
      detachedMarkers.push({ kind: 'db' });
    }
    detachedMarkers.push({ kind: 'contract', planned: false });
    nodeList.push({
      id: shortHash(contractHash),
      markers: detachedMarkers,
      style: 'detached',
    });
  }

  // Build edges
  const edgeList: GraphEdge[] = [];
  for (const [, entries] of graph.forwardChain) {
    for (const entry of entries) {
      const status = statusByDirName.get(entry.dirName);
      const icon = status ? STATUS_ICON[status] : '';
      const label = `${entry.dirName}${icon}`;

      edgeList.push({
        from: toShortId(entry.from),
        to: toShortId(entry.to),
        label,
        ...ifDefined('colorHint', status),
      });
    }
  }

  // Compute paths to all interesting targets so the default view shows the
  // minimal subgraph that covers everything relevant: contract, DB marker, ref.
  const relevantPaths: string[][] = [];
  const rootId = EMPTY_CONTRACT_HASH;

  function addPathFromRoot(targetHash: string): void {
    if (!graph.nodes.has(targetHash)) return;
    const raw = findPath(graph, rootId, targetHash);
    if (raw && raw.length > 0) {
      relevantPaths.push([toShortId(rootId), ...raw.map((e) => toShortId(e.to))]);
    }
  }

  function addPathBetween(fromHash: string, toHash: string): void {
    if (!graph.nodes.has(fromHash) || !graph.nodes.has(toHash)) return;
    const raw = findPath(graph, fromHash, toHash);
    if (raw && raw.length > 0) {
      relevantPaths.push([toShortId(fromHash), ...raw.map((e) => toShortId(e.to))]);
    }
  }

  // 1. Path to the DB marker
  if (mode === 'online' && markerHash) {
    addPathFromRoot(markerHash);
  }

  // 2. Path to the ref
  if (activeRefHash && activeRefHash !== markerHash) {
    addPathFromRoot(activeRefHash);
  }

  // 3. Path(s) to the contract — prefer continuing from marker and/or ref
  //    rather than an independent root→contract (which BFS may route through
  //    an unrelated branch). When both marker and ref exist, try both paths
  //    so that the diamond (two branches converging at the contract) is visible.
  if (contractHash !== EMPTY_CONTRACT_HASH) {
    let contractReached = false;

    if (markerHash && markerHash !== contractHash) {
      const markerReaches = findPath(graph, markerHash, contractHash);
      if (markerReaches) {
        addPathBetween(markerHash, contractHash);
        contractReached = true;
      }
    }

    if (activeRefHash && activeRefHash !== markerHash && activeRefHash !== contractHash) {
      const refReaches = findPath(graph, activeRefHash, contractHash);
      if (refReaches) {
        addPathBetween(activeRefHash, contractHash);
        contractReached = true;
      }
    }

    if (!contractReached && contractHash !== (markerHash ?? activeRefHash)) {
      addPathFromRoot(contractHash);
    }
  }

  // Fall back: if no paths were found, try the tip of the forward chain.
  if (relevantPaths.length === 0) {
    const lastEdge = [...graph.forwardChain.values()].flat().pop();
    const fallbackHash = lastEdge?.to ?? EMPTY_CONTRACT_HASH;
    addPathFromRoot(fallbackHash);
  }

  // Spine target for rendering (edge coloring, detached node alignment).
  let spineTargetHash: string;

  if (activeRefHash && graph.nodes.has(activeRefHash)) {
    spineTargetHash = activeRefHash;
  } else if (contractHash !== EMPTY_CONTRACT_HASH && graph.nodes.has(contractHash)) {
    spineTargetHash = contractHash;
  } else {
    const lastEdge = [...graph.forwardChain.values()].flat().pop();
    spineTargetHash = lastEdge?.to ?? EMPTY_CONTRACT_HASH;
  }

  return {
    graph: new RenderGraph(nodeList, edgeList),
    options: {
      spineTarget: toShortId(spineTargetHash),
      rootId: '∅',
      colorize: true,
    },
    relevantPaths,
  };
}
