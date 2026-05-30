import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { ClassifiedEdge, MigrationGraphRowModel } from './migration-graph-rows';
import type { MigrationEdgeKind } from './migration-list-graph-topology';

export type EdgeAdjacency = 'adjacent' | 'node-skipping-forward' | 'node-skipping-rollback';

export type StructuralCell =
  | { readonly kind: 'empty' }
  | { readonly kind: 'node'; readonly contractHash: string }
  | { readonly kind: 'vertical-pass' }
  | { readonly kind: 'branch-tee' }
  | { readonly kind: 'branch-corner' }
  | { readonly kind: 'merge-tee' }
  | { readonly kind: 'merge-corner' }
  | {
      readonly kind: 'edge-lane';
      readonly migrationHash: string;
      readonly edgeKind: MigrationEdgeKind;
      readonly ownsLabel: boolean;
      readonly adjacency: EdgeAdjacency;
    };

export type GridRowKind =
  | 'node'
  | 'edge'
  | 'branch-connector'
  | 'merge-connector'
  | 'component-separator';

export interface MigrationGraphGridRow {
  readonly kind: GridRowKind;
  readonly contractHash?: string;
  readonly edge?: ClassifiedEdge;
  readonly laneIndex?: number;
  readonly passThroughLanes?: readonly number[];
  readonly startLane?: number;
  readonly endLane?: number;
  readonly branchCount?: number;
  readonly cells: readonly StructuralCell[];
}

export interface MigrationGraphGridModel {
  readonly rows: readonly MigrationGraphGridRow[];
  readonly nodeColumn: ReadonlyMap<string, number>;
  readonly edgeColumn: ReadonlyMap<string, number>;
}

interface LaneState {
  want: string;
  active: boolean;
}

function canonicalFrom(from: string): string {
  return from === EMPTY_CONTRACT_HASH ? EMPTY_CONTRACT_HASH : from;
}

function forwardEdges(edges: readonly ClassifiedEdge[]): ClassifiedEdge[] {
  return edges.filter((e) => e.kind === 'forward');
}

function buildForwardProducersByTo(
  edges: readonly ClassifiedEdge[],
): Map<string, ClassifiedEdge[]> {
  const byTo = new Map<string, ClassifiedEdge[]>();
  for (const edge of edges) {
    if (edge.kind !== 'forward') continue;
    const bucket = byTo.get(edge.to);
    if (bucket) bucket.push(edge);
    else byTo.set(edge.to, [edge]);
  }
  return byTo;
}

function buildForwardOutDegree(edges: readonly ClassifiedEdge[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const edge of edges) {
    if (edge.kind !== 'forward' || edge.from === edge.to) continue;
    out.set(edge.from, (out.get(edge.from) ?? 0) + 1);
  }
  return out;
}

function buildForwardInDegree(edges: readonly ClassifiedEdge[]): Map<string, number> {
  const indeg = new Map<string, number>();
  for (const edge of forwardEdges(edges)) {
    if (edge.from === edge.to) continue;
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }
  return indeg;
}

function splitComponents(nodes: readonly (string | null)[]): readonly (readonly string[])[] {
  const components: string[][] = [];
  let current: string[] = [];
  for (const node of nodes) {
    if (node === null) {
      if (current.length > 0) {
        components.push(current);
        current = [];
      }
      continue;
    }
    current.push(node);
  }
  if (current.length > 0) components.push(current);
  return components;
}

function laneHasVerticalPass(row: MigrationGraphGridRow, laneIndex: number): boolean {
  const cell = row.cells[laneIndex];
  return cell?.kind === 'vertical-pass';
}

function classifyForwardLayoutAdjacency(
  rows: readonly MigrationGraphGridRow[],
  edgeRowIndex: number,
  edge: ClassifiedEdge,
  laneIndex: number,
  nodeColumn: ReadonlyMap<string, number>,
): EdgeAdjacency {
  let passedThroughNode = false;

  for (let index = edgeRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) break;
    if (
      row.kind === 'component-separator' ||
      row.kind === 'branch-connector' ||
      row.kind === 'merge-connector'
    ) {
      continue;
    }
    if (row.kind === 'edge') {
      if (row.laneIndex === laneIndex) return 'node-skipping-forward';
      continue;
    }
    if (row.kind === 'node' && row.contractHash !== undefined) {
      if (row.contractHash === edge.from) {
        const column = nodeColumn.get(row.contractHash) ?? 0;
        if (column === laneIndex) {
          return passedThroughNode ? 'node-skipping-forward' : 'adjacent';
        }
        if (passedThroughNode) return 'node-skipping-forward';
        return 'adjacent';
      }
      const column = nodeColumn.get(row.contractHash) ?? 0;
      if (column !== laneIndex) {
        if (laneHasVerticalPass(row, laneIndex)) passedThroughNode = true;
        continue;
      }
      return 'node-skipping-forward';
    }
  }

  return 'node-skipping-forward';
}

function isSecondaryConvergenceTip(
  contract: string,
  forwardInDegree: ReadonlyMap<string, number>,
  forwardOutDegree: ReadonlyMap<string, number>,
  componentNodes: readonly string[],
): boolean {
  const inDegree = forwardInDegree.get(contract) ?? 0;
  const outDegree = forwardOutDegree.get(contract) ?? 0;
  if (outDegree !== 0 || inDegree < 2) return false;
  return componentNodes.some(
    (node) =>
      node !== contract &&
      (forwardOutDegree.get(node) ?? 0) === 0 &&
      (forwardInDegree.get(node) ?? 0) < inDegree,
  );
}

function classifyLayoutAdjacency(
  rows: readonly MigrationGraphGridRow[],
  edgeRowIndex: number,
  edge: ClassifiedEdge,
  laneIndex: number,
  nodeColumn: ReadonlyMap<string, number>,
  position: ReadonlyMap<string, number>,
  forwardInDegree: ReadonlyMap<string, number>,
  forwardOutDegree: ReadonlyMap<string, number>,
  componentNodes: readonly string[],
): EdgeAdjacency {
  if (edge.kind === 'self') return 'adjacent';

  const fromPos = position.get(edge.from);
  const toPos = position.get(edge.to);

  if (edge.kind === 'forward') {
    const inDegree = forwardInDegree.get(edge.to) ?? 0;
    if (
      laneIndex > 0 &&
      inDegree >= 2 &&
      (nodeColumn.get(edge.from) ?? 0) === laneIndex &&
      isSecondaryConvergenceTip(edge.to, forwardInDegree, forwardOutDegree, componentNodes)
    ) {
      return 'adjacent';
    }
    if (
      laneIndex > 0 &&
      inDegree >= 2 &&
      (nodeColumn.get(edge.from) ?? 0) === 0 &&
      isSecondaryConvergenceTip(edge.to, forwardInDegree, forwardOutDegree, componentNodes)
    ) {
      return 'node-skipping-forward';
    }
    if (inDegree <= 1 && fromPos !== undefined && toPos !== undefined && fromPos === toPos + 1) {
      return 'adjacent';
    }
    return classifyForwardLayoutAdjacency(rows, edgeRowIndex, edge, laneIndex, nodeColumn);
  }

  if (fromPos !== undefined && toPos !== undefined && toPos === fromPos + 1) {
    return 'adjacent';
  }

  for (let index = edgeRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) break;
    if (
      row.kind === 'component-separator' ||
      row.kind === 'branch-connector' ||
      row.kind === 'merge-connector'
    ) {
      continue;
    }
    if (row.kind === 'edge') continue;
    if (row.kind === 'node') {
      return row.contractHash === edge.to ? 'adjacent' : 'node-skipping-rollback';
    }
  }
  return 'node-skipping-rollback';
}

function refineAdjacency(
  rows: readonly MigrationGraphGridRow[],
  nodeColumn: ReadonlyMap<string, number>,
  position: ReadonlyMap<string, number>,
  forwardInDegree: ReadonlyMap<string, number>,
  forwardOutDegree: ReadonlyMap<string, number>,
  componentNodes: readonly string[],
): MigrationGraphGridRow[] {
  return rows.map((row, index) => {
    if (row.kind !== 'edge' || row.edge === undefined || row.laneIndex === undefined) {
      return row;
    }
    const adjacency = classifyLayoutAdjacency(
      rows,
      index,
      row.edge,
      row.laneIndex,
      nodeColumn,
      position,
      forwardInDegree,
      forwardOutDegree,
      componentNodes,
    );
    return {
      ...row,
      cells: buildEdgeCells(
        row.edge,
        row.laneIndex,
        row.passThroughLanes ?? [],
        adjacency,
        row.cells.length,
      ),
    };
  });
}

function classifyEdgeAdjacency(
  edge: ClassifiedEdge,
  position: ReadonlyMap<string, number>,
): EdgeAdjacency {
  if (edge.kind === 'self') return 'adjacent';

  const fromPos = position.get(edge.from);
  const toPos = position.get(edge.to);
  if (fromPos === undefined || toPos === undefined) return 'adjacent';

  if (edge.kind === 'forward') {
    if (toPos >= fromPos) return 'adjacent';
    return fromPos === toPos + 1 ? 'adjacent' : 'node-skipping-forward';
  }

  if (toPos <= fromPos) return 'adjacent';
  return toPos === fromPos + 1 ? 'adjacent' : 'node-skipping-rollback';
}

function connectorWidth(startLane: number, endLane: number): number {
  return endLane - startLane + 1;
}

function emptyCells(width: number): StructuralCell[] {
  return Array.from({ length: width }, () => ({ kind: 'empty' as const }));
}

function buildBranchConnectorCells(startLane: number, endLane: number): StructuralCell[] {
  const width = connectorWidth(startLane, endLane);
  const cells = emptyCells(width);
  if (width === 1) {
    cells[0] = { kind: 'branch-tee' };
    return cells;
  }
  cells[0] = { kind: 'branch-tee' };
  for (let index = 1; index < width - 1; index++) {
    cells[index] = { kind: 'branch-tee' };
  }
  cells[width - 1] = { kind: 'branch-corner' };
  return cells;
}

function buildMergeConnectorCells(startLane: number, endLane: number): StructuralCell[] {
  const width = connectorWidth(startLane, endLane);
  const cells = emptyCells(width);
  if (width === 1) {
    cells[0] = { kind: 'merge-tee' };
    return cells;
  }
  cells[0] = { kind: 'merge-tee' };
  for (let index = 1; index < width - 1; index++) {
    cells[index] = { kind: 'merge-tee' };
  }
  cells[width - 1] = { kind: 'merge-corner' };
  return cells;
}

function buildNodeCells(
  contractHash: string,
  nodeColumn: number,
  activeLanes: readonly number[],
  gridWidth: number,
): StructuralCell[] {
  const cells = emptyCells(gridWidth);
  for (const lane of activeLanes) {
    if (lane !== nodeColumn && lane < gridWidth) {
      cells[lane] = { kind: 'vertical-pass' };
    }
  }
  if (nodeColumn < gridWidth) {
    cells[nodeColumn] = { kind: 'node', contractHash };
  }
  return cells;
}

function buildEdgeCells(
  edge: ClassifiedEdge,
  laneIndex: number,
  passThroughLanes: readonly number[],
  adjacency: EdgeAdjacency,
  gridWidth: number,
): StructuralCell[] {
  const cells = emptyCells(gridWidth);
  for (const lane of passThroughLanes) {
    if (lane < gridWidth) cells[lane] = { kind: 'vertical-pass' };
  }
  if (laneIndex < gridWidth) {
    cells[laneIndex] = {
      kind: 'edge-lane',
      migrationHash: edge.migrationHash,
      edgeKind: edge.kind,
      ownsLabel: true,
      adjacency,
    };
  }
  return cells;
}

function layoutComponent(
  componentNodes: readonly string[],
  allEdges: readonly ClassifiedEdge[],
  edgesByFrom: ReadonlyMap<string, readonly ClassifiedEdge[]>,
): {
  rows: MigrationGraphGridRow[];
  nodeColumn: Map<string, number>;
  edgeColumn: Map<string, number>;
} {
  const position = new Map<string, number>();
  for (let index = 0; index < componentNodes.length; index++) {
    const node = componentNodes[index];
    if (node !== undefined) position.set(node, index);
  }

  const componentEdgeSet = new Set(componentNodes);
  const edges = allEdges.filter((e) => componentEdgeSet.has(e.from) && componentEdgeSet.has(e.to));

  const forwardProducersByTo = buildForwardProducersByTo(edges);
  const forwardInDegree = buildForwardInDegree(edges);
  const forwardOutDegree = buildForwardOutDegree(edges);

  const lanes: LaneState[] = [];
  const rows: MigrationGraphGridRow[] = [];
  const nodeColumnByHash = new Map<string, number>();
  const edgeColumnByHash = new Map<string, number>();
  const producerLaneByHash = new Map<string, number>();
  const convergencesEmitted = new Set<string>();
  let gridWidth = 1;

  function ensureGridWidth(minWidth: number): void {
    if (minWidth > gridWidth) gridWidth = minWidth;
  }

  function ensureLane(index: number): void {
    ensureGridWidth(index + 1);
    while (lanes.length <= index) {
      lanes.push({ want: '', active: false });
    }
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

  function closeLane(index: number): void {
    ensureLane(index);
    const lane = lanes[index];
    if (lane) lane.active = false;
  }

  function emitBranchConnector(contractHash: string, branchCount: number): void {
    const startLane = 0;
    const endLane = branchCount - 1;
    ensureGridWidth(endLane + 1);
    rows.push({
      kind: 'branch-connector',
      contractHash,
      startLane,
      endLane,
      branchCount,
      cells: buildBranchConnectorCells(startLane, endLane),
    });
  }

  function emitMergeConnector(contractHash: string, laneIndices: readonly number[]): void {
    if (laneIndices.length < 2) return;
    const startLane = Math.min(...laneIndices);
    const endLane = Math.max(...laneIndices);
    ensureGridWidth(endLane + 1);
    rows.push({
      kind: 'merge-connector',
      contractHash,
      startLane,
      endLane,
      branchCount: laneIndices.length,
      cells: buildMergeConnectorCells(startLane, endLane),
    });
    for (const index of laneIndices) {
      if (index !== startLane) closeLane(index);
    }
  }

  function emitNodeRow(contractHash: string): void {
    const column = nodeColumnByHash.get(contractHash) ?? 0;
    const passThrough = activeLaneIndices().filter((index) => index !== column);
    rows.push({
      kind: 'node',
      contractHash,
      cells: buildNodeCells(contractHash, column, passThrough, gridWidth),
    });
    nodeColumnByHash.set(contractHash, column);
  }

  function forwardChildrenFrom(from: string): ClassifiedEdge[] {
    return edges.filter((e) => e.from === from && e.kind === 'forward' && e.from !== e.to);
  }

  function ensureSiblingLanesAtDivergence(from: string, activeLane: number): void {
    const children = forwardChildrenFrom(from);
    if (children.length < 2) return;

    for (const [childIndex, child] of children.entries()) {
      ensureLane(childIndex);
      if (childIndex === activeLane) continue;
      const lane = lanes[childIndex];
      if (lane?.active && lane.want === from) continue;
      lanes[childIndex] = { want: child.to, active: true };
    }
  }

  function emitEdgeRow(
    edge: ClassifiedEdge,
    laneIndex: number,
    passThroughLanes: readonly number[],
  ): void {
    let effectivePassThrough = passThroughLanes;
    if (
      edge.kind === 'forward' &&
      (forwardOutDegree.get(edge.from) ?? 0) >= 2 &&
      (forwardOutDegree.get(edge.to) ?? 0) === 0
    ) {
      ensureSiblingLanesAtDivergence(edge.from, laneIndex);
      effectivePassThrough = activeLaneIndices().filter((index) => index !== laneIndex);
    }

    const adjacency = classifyEdgeAdjacency(edge, position);
    ensureGridWidth(Math.max(laneIndex, ...effectivePassThrough, 0) + 1);
    rows.push({
      kind: 'edge',
      edge,
      laneIndex,
      passThroughLanes: effectivePassThrough,
      cells: buildEdgeCells(edge, laneIndex, effectivePassThrough, adjacency, gridWidth),
    });
    edgeColumnByHash.set(edge.migrationHash, laneIndex);
    ensureLane(laneIndex);
    lanes[laneIndex] = { want: canonicalFrom(edge.from), active: true };
  }

  function isLocalSecondaryConvergenceTip(contract: string): boolean {
    return isSecondaryConvergenceTip(contract, forwardInDegree, forwardOutDegree, componentNodes);
  }

  function emitConvergenceAfterNode(contract: string): void {
    if (convergencesEmitted.has(contract)) return;
    if ((forwardInDegree.get(contract) ?? 0) < 2) return;

    const producers = forwardProducersByTo.get(contract) ?? [];
    if (producers.length >= 2) {
      emitBranchConnector(contract, producers.length);
      for (const [producerIndex, producer] of producers.entries()) {
        const lane = isLocalSecondaryConvergenceTip(contract)
          ? producers.length - 1
          : producerIndex;
        ensureLane(lane);
        lanes[lane] = { want: canonicalFrom(producer.from), active: true };
        producerLaneByHash.set(producer.migrationHash, lane);
        if ((forwardOutDegree.get(producer.from) ?? 0) < 2) {
          nodeColumnByHash.set(producer.from, lane);
        }
      }
    }

    convergencesEmitted.add(contract);
  }

  function branchLaneForProducerEdge(producer: ClassifiedEdge): number | undefined {
    const children = forwardChildrenFrom(producer.from);
    if (children.length < 2) return undefined;
    const index = children.findIndex((child) => child.migrationHash === producer.migrationHash);
    return index >= 0 ? index : undefined;
  }

  function emitForwardProducersTo(contract: string): void {
    const producers = (forwardProducersByTo.get(contract) ?? []).filter(
      (e) => e.kind === 'forward',
    );
    const sorted = [...producers].sort((a, b) => {
      const laneA = producerLaneByHash.get(a.migrationHash);
      const laneB = producerLaneByHash.get(b.migrationHash);
      if (laneA !== undefined && laneB !== undefined) return laneA - laneB;
      if (laneA !== undefined) return -1;
      if (laneB !== undefined) return 1;
      return a.from.localeCompare(b.from);
    });

    for (const producer of sorted) {
      const presetLane = producerLaneByHash.get(producer.migrationHash);
      if (presetLane !== undefined) {
        const passThrough = activeLaneIndices().filter((index) => index !== presetLane);
        emitEdgeRow(producer, presetLane, passThrough);
        continue;
      }

      const branchLane = branchLaneForProducerEdge(producer);
      if (branchLane !== undefined) {
        ensureSiblingLanesAtDivergence(producer.from, branchLane);
        const passThrough = activeLaneIndices().filter((index) => index !== branchLane);
        emitEdgeRow(producer, branchLane, passThrough);
        continue;
      }

      const wanting = lanesWanting(contract);
      if (wanting.length > 0) {
        const laneIndex = wanting[0] ?? 0;
        const passThrough = activeLaneIndices().filter((index) => index !== laneIndex);
        emitEdgeRow(producer, laneIndex, passThrough);
        continue;
      }

      const laneIndex = activeLaneIndices().length === 0 ? 0 : Math.max(...activeLaneIndices()) + 1;
      emitEdgeRow(producer, laneIndex, activeLaneIndices());
    }
  }

  function emitDepartingEdgesFrom(contract: string): void {
    const fromEdges = edgesByFrom.get(contract) ?? [];
    const rollbacksAndSelf = fromEdges.filter((e) => e.kind === 'rollback' || e.kind === 'self');
    rollbacksAndSelf.sort((a, b) => b.dirName.localeCompare(a.dirName));

    for (const edge of rollbacksAndSelf) {
      const nodePosAdjacency = classifyEdgeAdjacency(edge, position);
      if (nodePosAdjacency === 'adjacent' || edge.kind === 'self') {
        emitEdgeRow(edge, 0, []);
        continue;
      }

      emitEdgeRow(edge, 0, []);
    }
  }

  function visitBranchRoots(contract: string): void {
    if ((forwardInDegree.get(contract) ?? 0) < 2) return;

    const producers = (forwardProducersByTo.get(contract) ?? []).filter(
      (e) => e.kind === 'forward',
    );
    const sorted = [...producers].sort((a, b) => {
      const laneA = producerLaneByHash.get(a.migrationHash) ?? 0;
      const laneB = producerLaneByHash.get(b.migrationHash) ?? 0;
      return laneA - laneB;
    });
    for (const producer of sorted) {
      visitNode(producer.from);
    }
  }

  const emittedNodes = new Set<string>();

  function visitNode(contract: string): void {
    if (emittedNodes.has(contract)) return;

    const wanting = lanesWanting(contract);
    if (wanting.length >= 2) {
      emitMergeConnector(contract, wanting);
    }

    const producerCount = (forwardProducersByTo.get(contract) ?? []).length;
    if (isLocalSecondaryConvergenceTip(contract) && producerCount >= 2) {
      nodeColumnByHash.set(contract, producerCount - 1);
    }

    emitNodeRow(contract);
    emittedNodes.add(contract);

    emitConvergenceAfterNode(contract);
    emitForwardProducersTo(contract);
    visitBranchRoots(contract);
    emitDepartingEdgesFrom(contract);
  }

  const tipStarts = componentNodes
    .filter((node) => (forwardOutDegree.get(node) ?? 0) === 0)
    .sort((a, b) => {
      const inA = forwardInDegree.get(a) ?? 0;
      const inB = forwardInDegree.get(b) ?? 0;
      if (inA !== inB) return inA - inB;
      return componentNodes.indexOf(a) - componentNodes.indexOf(b);
    });

  for (const tip of tipStarts) {
    visitNode(tip);
  }

  for (const node of componentNodes) {
    if (!emittedNodes.has(node)) {
      visitNode(node);
    }
  }

  return {
    rows: refineAdjacency(
      rows,
      nodeColumnByHash,
      position,
      forwardInDegree,
      forwardOutDegree,
      componentNodes,
    ),
    nodeColumn: nodeColumnByHash,
    edgeColumn: edgeColumnByHash,
  };
}

export function buildMigrationGraphLayout(
  rowModel: MigrationGraphRowModel,
): MigrationGraphGridModel {
  if (rowModel.nodes.length === 0) {
    return { rows: [], nodeColumn: new Map(), edgeColumn: new Map() };
  }

  const components = splitComponents(rowModel.nodes);
  const allRows: MigrationGraphGridRow[] = [];
  const nodeColumn = new Map<string, number>();
  const edgeColumn = new Map<string, number>();

  for (let componentIndex = 0; componentIndex < components.length; componentIndex++) {
    if (componentIndex > 0) {
      allRows.push({ kind: 'component-separator', cells: [] });
    }

    const component = components[componentIndex];
    if (component === undefined || component.length === 0) continue;

    const result = layoutComponent(component, rowModel.edges, rowModel.edgesByFrom);
    allRows.push(...result.rows);
    for (const [hash, column] of result.nodeColumn) nodeColumn.set(hash, column);
    for (const [hash, column] of result.edgeColumn) edgeColumn.set(hash, column);
  }

  return { rows: allRows, nodeColumn, edgeColumn };
}
