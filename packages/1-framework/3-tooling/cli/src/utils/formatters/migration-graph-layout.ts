import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { ClassifiedEdge, MigrationGraphRowModel } from './migration-graph-rows';
import type { MigrationEdgeKind } from './migration-list-graph-topology';

export type EdgeAdjacency = 'adjacent' | 'node-skipping-forward' | 'node-skipping-rollback';

export type StructuralCell =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'node';
      readonly contractHash: string;
      readonly arcTee?: boolean;
      readonly arcLand?: boolean;
    }
  | { readonly kind: 'vertical-pass' }
  | { readonly kind: 'horizontal-pass' }
  | { readonly kind: 'branch-tee' }
  | { readonly kind: 'branch-corner' }
  | { readonly kind: 'merge-tee' }
  | { readonly kind: 'merge-corner' }
  | { readonly kind: 'arc-branch-corner' }
  | { readonly kind: 'arc-branch-tee' }
  | { readonly kind: 'arc-land-corner' }
  | { readonly kind: 'arc-crossing' }
  | { readonly kind: 'arc-land-bridge' }
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
  readonly convergenceProducer?: boolean;
  readonly cells: readonly StructuralCell[];
}

export interface MigrationGraphGridModel {
  readonly rows: readonly MigrationGraphGridRow[];
  readonly nodeColumn: ReadonlyMap<string, number>;
  readonly edgeColumn: ReadonlyMap<string, number>;
}

// ---------------------------------------------------------------------------
// Edge bucketing helpers
// ---------------------------------------------------------------------------

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

/**
 * Distinct source contracts among a contract's forward producers. A contract is
 * a *convergence* when this count is >= 2. Multiple migrations sharing one
 * source (a multi-edge) count once — they stack in a single lane rather than
 * fanning into a convergence.
 */
function buildDistinctSourceCountByTo(edges: readonly ClassifiedEdge[]): Map<string, number> {
  const sources = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.kind !== 'forward' || edge.from === edge.to) continue;
    const set = sources.get(edge.to);
    if (set) set.add(edge.from);
    else sources.set(edge.to, new Set([edge.from]));
  }
  const counts = new Map<string, number>();
  for (const [to, set] of sources) counts.set(to, set.size);
  return counts;
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

// ---------------------------------------------------------------------------
// Adjacency refinement (operates on the emitted rows)
// ---------------------------------------------------------------------------

function classifyForwardShortConvergenceAdjacency(
  rows: readonly MigrationGraphGridRow[],
  edgeRowIndex: number,
  edge: ClassifiedEdge,
  laneIndex: number,
): EdgeAdjacency {
  for (let index = edgeRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) break;
    if (row.kind === 'component-separator' || row.kind === 'branch-connector') continue;
    if (row.kind === 'merge-connector') continue;
    if (row.kind === 'edge') {
      if (row.laneIndex === laneIndex) return 'node-skipping-forward';
      continue;
    }
    if (row.kind === 'node' && row.contractHash === edge.from) {
      return 'adjacent';
    }
  }
  return 'node-skipping-forward';
}

function convergenceProducerUsesShortAdjacency(
  edge: ClassifiedEdge,
  laneIndex: number,
  forwardProducersByTo: ReadonlyMap<string, readonly ClassifiedEdge[]>,
  producerLaneByHash: ReadonlyMap<string, number>,
): boolean {
  const producers = (forwardProducersByTo.get(edge.to) ?? []).filter(
    (candidate) => candidate.kind === 'forward',
  );
  if (producers.length < 2) return false;

  const fanLanes = [
    ...new Set(
      producers
        .map((producer) => producerLaneByHash.get(producer.migrationHash))
        .filter((candidate): candidate is number => candidate !== undefined),
    ),
  ].sort((a, b) => a - b);
  const fanStart = fanLanes[0];
  if (fanStart === undefined) return false;

  return laneIndex === fanStart;
}

function classifyForwardLayoutAdjacency(
  rows: readonly MigrationGraphGridRow[],
  edgeRowIndex: number,
  edge: ClassifiedEdge,
  laneIndex: number,
  passThroughLanes: readonly number[],
  nodeColumn: ReadonlyMap<string, number>,
  convergenceProducer: boolean,
  divergenceBranchEdge: boolean,
): EdgeAdjacency {
  let sawObstruction = false;
  const passThroughLaneSet = new Set(passThroughLanes);

  for (let index = edgeRowIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) break;
    if (row.kind === 'component-separator') continue;
    if (row.kind === 'merge-connector') {
      if (convergenceProducer) {
        if (row.contractHash === edge.from) sawObstruction = true;
      } else if (!divergenceBranchEdge && row.contractHash !== edge.from) {
        sawObstruction = true;
      }
      continue;
    }
    if (row.kind === 'branch-connector') continue;
    if (row.kind === 'edge') {
      if (row.laneIndex === laneIndex) return 'node-skipping-forward';
      if (!divergenceBranchEdge && row.edge !== undefined && row.edge.to !== edge.to) {
        sawObstruction = true;
      }
      continue;
    }
    if (row.kind === 'node' && row.contractHash !== undefined) {
      if (row.contractHash === edge.from) {
        return sawObstruction ? 'node-skipping-forward' : 'adjacent';
      }
      const nodeCol = nodeColumn.get(row.contractHash) ?? 0;
      // A divergence-branch lane runs unobstructed to its convergence point;
      // sibling-branch nodes sit in parallel lanes and never block it.
      if (!divergenceBranchEdge && !passThroughLaneSet.has(nodeCol)) {
        sawObstruction = true;
      }
    }
  }

  return 'node-skipping-forward';
}

function classifyLayoutAdjacency(
  rows: readonly MigrationGraphGridRow[],
  edgeRowIndex: number,
  edge: ClassifiedEdge,
  laneIndex: number,
  passThroughLanes: readonly number[],
  nodeColumn: ReadonlyMap<string, number>,
  position: ReadonlyMap<string, number>,
  forwardInDegree: ReadonlyMap<string, number>,
  convergenceProducer: boolean,
  divergenceBranchEdge: boolean,
): EdgeAdjacency {
  if (edge.kind === 'self') return 'adjacent';

  const fromPos = position.get(edge.from);
  const toPos = position.get(edge.to);

  if (edge.kind === 'forward') {
    const inDegree = forwardInDegree.get(edge.to) ?? 0;
    if (inDegree <= 1 && fromPos !== undefined && toPos !== undefined && fromPos === toPos + 1) {
      return 'adjacent';
    }
    return classifyForwardLayoutAdjacency(
      rows,
      edgeRowIndex,
      edge,
      laneIndex,
      passThroughLanes,
      nodeColumn,
      convergenceProducer,
      divergenceBranchEdge,
    );
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
  edges: readonly ClassifiedEdge[],
  producerLaneByHash: ReadonlyMap<string, number>,
): MigrationGraphGridRow[] {
  const forwardProducersByTo = buildForwardProducersByTo(edges);
  function branchLaneForEdge(producer: ClassifiedEdge): number | undefined {
    const children = edges.filter(
      (edge) => edge.from === producer.from && edge.kind === 'forward' && edge.from !== edge.to,
    );
    if (children.length < 2) return undefined;
    const index = children.findIndex((child) => child.migrationHash === producer.migrationHash);
    return index >= 0 ? index : undefined;
  }

  return rows.map((row, rowIndex) => {
    if (row.kind !== 'edge' || row.edge === undefined || row.laneIndex === undefined) {
      return row;
    }
    const divergenceBranchEdge =
      row.edge.kind === 'forward' &&
      !(row.convergenceProducer ?? false) &&
      (forwardOutDegree.get(row.edge.from) ?? 0) >= 2 &&
      branchLaneForEdge(row.edge) !== undefined;
    const adjacency =
      row.convergenceProducer === true &&
      convergenceProducerUsesShortAdjacency(
        row.edge,
        row.laneIndex,
        forwardProducersByTo,
        producerLaneByHash,
      )
        ? classifyForwardShortConvergenceAdjacency(rows, rowIndex, row.edge, row.laneIndex)
        : classifyLayoutAdjacency(
            rows,
            rowIndex,
            row.edge,
            row.laneIndex,
            row.passThroughLanes ?? [],
            nodeColumn,
            position,
            forwardInDegree,
            row.convergenceProducer ?? false,
            divergenceBranchEdge,
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

// ---------------------------------------------------------------------------
// Cell builders
// ---------------------------------------------------------------------------

function emptyCells(width: number): StructuralCell[] {
  return Array.from({ length: width }, () => ({ kind: 'empty' as const }));
}

function buildBranchConnectorCells(
  startLane: number,
  endLane: number,
  activeLanes: ReadonlySet<number>,
  gridWidth: number,
): StructuralCell[] {
  const cells = emptyCells(gridWidth);
  for (let lane = 0; lane < gridWidth; lane++) {
    if (activeLanes.has(lane) && (lane < startLane || lane > endLane)) {
      cells[lane] = { kind: 'vertical-pass' };
      continue;
    }
    if (lane === startLane) {
      cells[lane] = { kind: 'branch-tee' };
    } else if (lane === endLane) {
      cells[lane] = { kind: 'branch-corner' };
    } else if (lane > startLane && lane < endLane) {
      cells[lane] = { kind: 'branch-tee' };
    }
  }
  return cells;
}

function buildMergeConnectorCells(
  startLane: number,
  endLane: number,
  activeLanes: ReadonlySet<number>,
  gridWidth: number,
): StructuralCell[] {
  const cells = emptyCells(gridWidth);
  for (let lane = 0; lane < gridWidth; lane++) {
    if (activeLanes.has(lane) && (lane < startLane || lane > endLane)) {
      cells[lane] = { kind: 'vertical-pass' };
      continue;
    }
    if (lane === startLane) {
      cells[lane] = { kind: 'merge-tee' };
    } else if (lane === endLane) {
      cells[lane] = { kind: 'merge-corner' };
    } else if (lane > startLane && lane < endLane) {
      cells[lane] = activeLanes.has(lane) ? { kind: 'merge-tee' } : { kind: 'horizontal-pass' };
    }
  }
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

// ---------------------------------------------------------------------------
// Vertical ordering: tips-first DFS post-order over forward edges
// ---------------------------------------------------------------------------

/**
 * Compute the vertical node order for a component: tips at the top (index 0),
 * roots at the bottom. This is a DFS post-order over forward edges starting
 * from forward roots, visiting children in their input (insertion) order. A
 * node is emitted only after all of its forward children, so convergence nodes
 * sit below every branch that feeds them and the longest contiguous chain reads
 * top-to-bottom without braiding.
 */
function computeVerticalOrder(
  componentNodes: readonly string[],
  forwardChildren: ReadonlyMap<string, readonly ClassifiedEdge[]>,
  forwardInDegree: ReadonlyMap<string, number>,
): string[] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of componentNodes) color.set(node, WHITE);

  const sortRoots = (roots: readonly string[]): string[] =>
    [...roots].sort((a, b) => {
      if (a === EMPTY_CONTRACT_HASH) return -1;
      if (b === EMPTY_CONTRACT_HASH) return 1;
      return a.localeCompare(b);
    });

  let roots = sortRoots(componentNodes.filter((n) => (forwardInDegree.get(n) ?? 0) === 0));
  if (roots.length === 0) roots = sortRoots(componentNodes);

  const result: string[] = [];

  interface Frame {
    node: string;
    children: readonly ClassifiedEdge[];
    index: number;
  }

  function runDfs(root: string): void {
    if (color.get(root) !== WHITE) return;
    const stack: Frame[] = [{ node: root, children: forwardChildren.get(root) ?? [], index: 0 }];
    color.set(root, GRAY);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      if (frame.index >= frame.children.length) {
        color.set(frame.node, BLACK);
        result.push(frame.node);
        stack.pop();
        continue;
      }
      const child = frame.children[frame.index];
      frame.index += 1;
      if (child === undefined) continue;
      if (color.get(child.to) === WHITE) {
        color.set(child.to, GRAY);
        stack.push({ node: child.to, children: forwardChildren.get(child.to) ?? [], index: 0 });
      }
    }
  }

  for (const root of roots) runDfs(root);
  // Nodes unreachable via forward edges (e.g. rollback-only sources) follow in
  // component order.
  for (const node of componentNodes) {
    if (color.get(node) === WHITE) runDfs(node);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Routed back-arcs for node-skipping rollbacks
// ---------------------------------------------------------------------------

interface SkipRollbackRoute {
  readonly edge: ClassifiedEdge;
  readonly backLane: number;
}

function rollbackSpan(
  edge: ClassifiedEdge,
  position: ReadonlyMap<string, number>,
): { readonly top: number; readonly bottom: number } {
  const top = position.get(edge.from) ?? 0;
  const bottom = position.get(edge.to) ?? top;
  return { top, bottom };
}

function spansOverlap(
  a: { readonly top: number; readonly bottom: number },
  b: { readonly top: number; readonly bottom: number },
): boolean {
  return a.top <= b.bottom && b.top <= a.bottom;
}

function forwardMaxLane(
  rows: readonly MigrationGraphGridRow[],
  skipMigrationHashes: ReadonlySet<string>,
): number {
  let max = 0;
  for (const row of rows) {
    if (
      row.kind === 'edge' &&
      row.edge !== undefined &&
      skipMigrationHashes.has(row.edge.migrationHash)
    ) {
      continue;
    }
    max = Math.max(max, row.laneIndex ?? 0);
    for (const lane of row.passThroughLanes ?? []) {
      max = Math.max(max, lane);
    }
    if (row.startLane !== undefined) {
      max = Math.max(max, row.startLane, row.endLane ?? row.startLane);
    }
  }
  return max;
}

function allocateSkipRollbackBackLanes(
  skipRollbacks: readonly ClassifiedEdge[],
  position: ReadonlyMap<string, number>,
  forwardMax: number,
): Map<string, number> {
  const sorted = [...skipRollbacks].sort((a, b) => {
    const aTop = position.get(a.from) ?? 0;
    const bTop = position.get(b.from) ?? 0;
    if (aTop !== bTop) return aTop - bTop;
    return b.dirName.localeCompare(a.dirName);
  });

  const occupied: { readonly top: number; readonly bottom: number; readonly lane: number }[] = [];
  const lanes = new Map<string, number>();
  let nextLane = forwardMax + 1;

  for (const edge of sorted) {
    const span = rollbackSpan(edge, position);
    let lane = nextLane;
    while (occupied.some((entry) => entry.lane === lane && spansOverlap(entry, span))) {
      lane += 1;
    }
    occupied.push({ ...span, lane });
    lanes.set(edge.migrationHash, lane);
    nextLane = Math.max(nextLane, lane + 1);
  }

  return lanes;
}

function findNodeRowIndex(rows: readonly MigrationGraphGridRow[], contractHash: string): number {
  return rows.findIndex((row) => row.kind === 'node' && row.contractHash === contractHash);
}

function findEdgeRowIndex(rows: readonly MigrationGraphGridRow[], migrationHash: string): number {
  return rows.findIndex((row) => row.kind === 'edge' && row.edge?.migrationHash === migrationHash);
}

// A grid row with a mutable `cells` array. The routing pass clones the
// immutable rows into this shape so it can paint arc cells in place without
// stripping `readonly` with a cast.
type MutableGridRow = Omit<MigrationGraphGridRow, 'cells'> & { cells: StructuralCell[] };

function ensureCellWidth(cells: StructuralCell[], width: number): void {
  while (cells.length < width) {
    cells.push({ kind: 'empty' });
  }
}

function cloneRow(row: MigrationGraphGridRow): MutableGridRow {
  return { ...row, cells: [...row.cells] };
}

function routeCrossesRow(
  route: SkipRollbackRoute,
  rowIndex: number,
  rows: readonly MigrationGraphGridRow[],
): boolean {
  const sourceRow = findNodeRowIndex(rows, route.edge.from);
  const targetRow = findNodeRowIndex(rows, route.edge.to);
  if (sourceRow < 0 || targetRow < 0) return false;
  return rowIndex > sourceRow && rowIndex <= targetRow;
}

function applySkipRollbackRouting(
  rows: readonly MigrationGraphGridRow[],
  skipRollbacks: readonly ClassifiedEdge[],
  position: ReadonlyMap<string, number>,
  nodeColumn: ReadonlyMap<string, number>,
  edgeColumn: Map<string, number>,
): MigrationGraphGridRow[] {
  if (skipRollbacks.length === 0) return [...rows];

  const skipHashes = new Set(skipRollbacks.map((edge) => edge.migrationHash));
  const forwardMax = forwardMaxLane(rows, skipHashes);
  const backLaneByHash = allocateSkipRollbackBackLanes(skipRollbacks, position, forwardMax);
  const routes: SkipRollbackRoute[] = skipRollbacks.map((edge) => ({
    edge,
    backLane: backLaneByHash.get(edge.migrationHash) ?? forwardMax + 1,
  }));

  const result = rows.map(cloneRow);

  for (const route of routes) {
    const { edge, backLane } = route;
    const nodeCol = nodeColumn.get(edge.from) ?? 0;
    const targetCol = nodeColumn.get(edge.to) ?? 0;
    const sourceRowIndex = findNodeRowIndex(result, edge.from);
    const targetRowIndex = findNodeRowIndex(result, edge.to);
    const edgeRowIndex = findEdgeRowIndex(result, edge.migrationHash);
    if (sourceRowIndex < 0 || targetRowIndex < 0 || edgeRowIndex < 0) continue;

    edgeColumn.set(edge.migrationHash, backLane);

    // Back-lanes of arcs that tee off this same source node. They share the
    // node's tee row, so each inner lane reads as a `┬` junction and only the
    // outermost gets the closing `╮`.
    const coSourcedLanes = routes
      .filter((other) => other.edge.from === edge.from)
      .map((other) => other.backLane);
    const maxCoSourcedLane = Math.max(...coSourcedLanes);

    const sourceRow = result[sourceRowIndex];
    if (sourceRow !== undefined) {
      const cells = sourceRow.cells;
      ensureCellWidth(cells, backLane + 1);
      const contractHash = sourceRow.contractHash ?? EMPTY_CONTRACT_HASH;
      cells[nodeCol] = { kind: 'node', contractHash, arcTee: true };
      for (let lane = nodeCol + 1; lane < backLane; lane += 1) {
        if (coSourcedLanes.includes(lane)) {
          cells[lane] = { kind: 'arc-branch-tee' };
          continue;
        }
        const existing = cells[lane];
        const occupied =
          existing !== undefined &&
          existing.kind !== 'empty' &&
          existing.kind !== 'horizontal-pass';
        const crossed =
          occupied ||
          routes.some(
            (other) =>
              other.edge.migrationHash !== edge.migrationHash &&
              other.backLane === lane &&
              routeCrossesRow(other, sourceRowIndex, result),
          );
        cells[lane] = crossed ? { kind: 'arc-crossing' } : { kind: 'horizontal-pass' };
      }
      cells[backLane] =
        backLane < maxCoSourcedLane ? { kind: 'arc-branch-tee' } : { kind: 'arc-branch-corner' };
    }

    const edgeRow = result[edgeRowIndex];
    if (edgeRow !== undefined) {
      // Mutate in place rather than rebuild from empty: a co-sourced arc's body
      // lane may already cross this row, and rebuilding would clobber it.
      const cells = edgeRow.cells;
      ensureCellWidth(cells, backLane + 1);
      cells[nodeCol] = { kind: 'vertical-pass' };
      cells[backLane] = {
        kind: 'edge-lane',
        migrationHash: edge.migrationHash,
        edgeKind: edge.kind,
        ownsLabel: true,
        adjacency: 'node-skipping-rollback',
      };
      result[edgeRowIndex] = { ...edgeRow, laneIndex: backLane, passThroughLanes: [nodeCol] };
    }

    // Fill the arc body vertically from just below the source tee down to the
    // row above the landing, skipping the rollback's own labelled edge row.
    // Starting below the source (rather than below the edge row) keeps a
    // co-sourced arc's lane connected across an earlier co-sourced edge row.
    for (let index = sourceRowIndex + 1; index < targetRowIndex; index += 1) {
      if (index === edgeRowIndex) continue;
      const row = result[index];
      if (row === undefined) continue;
      const cells = row.cells;
      ensureCellWidth(cells, backLane + 1);
      const existing = cells[backLane];
      if (
        existing?.kind !== 'arc-land-corner' &&
        existing?.kind !== 'arc-land-bridge' &&
        existing?.kind !== 'arc-branch-corner' &&
        existing?.kind !== 'arc-branch-tee' &&
        existing?.kind !== 'arc-crossing'
      ) {
        cells[backLane] = { kind: 'vertical-pass' };
      }
    }

    const targetRow = result[targetRowIndex];
    if (targetRow !== undefined) {
      const cells = targetRow.cells;
      ensureCellWidth(cells, backLane + 1);
      const contractHash = targetRow.contractHash ?? EMPTY_CONTRACT_HASH;
      cells[targetCol] = { kind: 'node', contractHash, arcLand: true };
      for (let lane = targetCol + 1; lane < backLane; lane += 1) {
        // A bridged lane that carries another arc OR a forward vertical still
        // active at this row must cross over it (`┼`) rather than overwrite it
        // with a bare bridge (`──`).
        const existing = cells[lane];
        const occupied =
          existing !== undefined &&
          existing.kind !== 'empty' &&
          existing.kind !== 'horizontal-pass' &&
          existing.kind !== 'arc-land-bridge';
        const crossed =
          occupied ||
          routes.some(
            (other) =>
              other.edge.migrationHash !== edge.migrationHash &&
              other.backLane === lane &&
              routeCrossesRow(other, targetRowIndex, result),
          );
        cells[lane] = crossed ? { kind: 'arc-crossing' } : { kind: 'arc-land-bridge' };
      }
      cells[backLane] = { kind: 'arc-land-corner' };
      for (const other of routes) {
        if (other.backLane <= backLane) continue;
        if (!routeCrossesRow(other, targetRowIndex, result)) continue;
        ensureCellWidth(cells, other.backLane + 1);
        const existing = cells[other.backLane];
        if (
          existing?.kind !== 'arc-land-corner' &&
          existing?.kind !== 'arc-land-bridge' &&
          existing?.kind !== 'node'
        ) {
          cells[other.backLane] = { kind: 'vertical-pass' };
        }
      }
    }
  }

  return result;
}

function collectNodeSkippingRollbacks(
  edges: readonly ClassifiedEdge[],
  position: ReadonlyMap<string, number>,
): ClassifiedEdge[] {
  return edges.filter(
    (edge) =>
      edge.kind === 'rollback' &&
      classifyEdgeAdjacency(edge, position) === 'node-skipping-rollback',
  );
}

// ---------------------------------------------------------------------------
// Lane allocation: one rule for all topologies
// ---------------------------------------------------------------------------

interface DownwardGroup {
  readonly target: string;
  readonly edges: ClassifiedEdge[];
}

function layoutComponent(
  componentNodes: readonly string[],
  allEdges: readonly ClassifiedEdge[],
): {
  rows: MigrationGraphGridRow[];
  nodeColumn: Map<string, number>;
  edgeColumn: Map<string, number>;
} {
  const componentSet = new Set(componentNodes);
  const edges = allEdges.filter((e) => componentSet.has(e.from) && componentSet.has(e.to));

  const forwardChildren = new Map<string, ClassifiedEdge[]>();
  const producersByTo = new Map<string, ClassifiedEdge[]>();
  const rollbacksByFrom = new Map<string, ClassifiedEdge[]>();
  const selfByFrom = new Map<string, ClassifiedEdge[]>();
  for (const edge of edges) {
    if (edge.kind === 'self' || edge.from === edge.to) {
      const bucket = selfByFrom.get(edge.from);
      if (bucket) bucket.push(edge);
      else selfByFrom.set(edge.from, [edge]);
      continue;
    }
    if (edge.kind === 'forward') {
      const children = forwardChildren.get(edge.from);
      if (children) children.push(edge);
      else forwardChildren.set(edge.from, [edge]);
      const producers = producersByTo.get(edge.to);
      if (producers) producers.push(edge);
      else producersByTo.set(edge.to, [edge]);
      continue;
    }
    // rollback
    const bucket = rollbacksByFrom.get(edge.from);
    if (bucket) bucket.push(edge);
    else rollbacksByFrom.set(edge.from, [edge]);
  }

  const forwardInDegree = buildForwardInDegree(edges);
  const forwardOutDegree = buildForwardOutDegree(edges);
  const distinctSourceCountByTo = buildDistinctSourceCountByTo(edges);

  const order = computeVerticalOrder(componentNodes, forwardChildren, forwardInDegree);
  const position = new Map<string, number>();
  for (let index = 0; index < order.length; index++) {
    const node = order[index];
    if (node !== undefined) position.set(node, index);
  }

  const lanes: (string | null)[] = [];
  const rows: MigrationGraphGridRow[] = [];
  const nodeColumn = new Map<string, number>();
  const edgeColumn = new Map<string, number>();
  const producerLaneByHash = new Map<string, number>();
  let gridWidth = 1;

  function ensureGridWidth(minWidth: number): void {
    if (minWidth > gridWidth) gridWidth = minWidth;
  }

  function setLane(index: number, want: string | null): void {
    while (lanes.length <= index) lanes.push(null);
    lanes[index] = want;
    if (want !== null) ensureGridWidth(index + 1);
  }

  function activeLaneIndices(): number[] {
    const indices: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index] !== null) indices.push(index);
    }
    return indices;
  }

  function passThroughExcept(lane: number): number[] {
    return activeLaneIndices().filter((index) => index !== lane);
  }

  function leftmostFreeLane(): number {
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index] === null) return index;
    }
    return lanes.length;
  }

  function lanesWanting(contract: string): number[] {
    const indices: number[] = [];
    for (let index = 0; index < lanes.length; index++) {
      if (lanes[index] === contract) indices.push(index);
    }
    return indices;
  }

  function emitMergeConnector(contractHash: string, laneIndices: readonly number[]): number {
    const startLane = Math.min(...laneIndices);
    const endLane = Math.max(...laneIndices);
    ensureGridWidth(endLane + 1);
    const activeLanes = new Set(activeLaneIndices());
    rows.push({
      kind: 'merge-connector',
      contractHash,
      startLane,
      endLane,
      branchCount: laneIndices.length,
      cells: buildMergeConnectorCells(startLane, endLane, activeLanes, gridWidth),
    });
    for (const index of laneIndices) {
      if (index !== startLane) setLane(index, null);
    }
    return startLane;
  }

  function emitBranchConnector(
    contractHash: string,
    startLane: number,
    endLane: number,
    branchCount: number,
  ): void {
    ensureGridWidth(endLane + 1);
    const activeLanes = new Set(activeLaneIndices());
    rows.push({
      kind: 'branch-connector',
      contractHash,
      startLane,
      endLane,
      branchCount,
      cells: buildBranchConnectorCells(startLane, endLane, activeLanes, gridWidth),
    });
  }

  function emitEdgeRow(edge: ClassifiedEdge, lane: number, convergenceProducer: boolean): void {
    const passThrough = passThroughExcept(lane);
    const adjacency = classifyEdgeAdjacency(edge, position);
    ensureGridWidth(Math.max(lane, ...passThrough, 0) + 1);
    const row: MigrationGraphGridRow = {
      kind: 'edge',
      edge,
      laneIndex: lane,
      passThroughLanes: passThrough,
      cells: buildEdgeCells(edge, lane, passThrough, adjacency, gridWidth),
    };
    rows.push(convergenceProducer ? { ...row, convergenceProducer: true } : row);
    edgeColumn.set(edge.migrationHash, lane);
    if (convergenceProducer) producerLaneByHash.set(edge.migrationHash, lane);
  }

  function emitNodeRow(contractHash: string, column: number): void {
    ensureGridWidth(column + 1);
    const passThrough = activeLaneIndices().filter((index) => index !== column);
    rows.push({
      kind: 'node',
      contractHash,
      cells: buildNodeCells(contractHash, column, passThrough, gridWidth),
    });
    nodeColumn.set(contractHash, column);
  }

  function producerGroups(node: string): DownwardGroup[] {
    const byTarget = new Map<string, DownwardGroup>();
    for (const producer of producersByTo.get(node) ?? []) {
      const group = byTarget.get(producer.from);
      if (group) group.edges.push(producer);
      else byTarget.set(producer.from, { target: producer.from, edges: [producer] });
    }
    const groups = [...byTarget.values()];
    // Lanes are ordered by where their target node lands vertically (soonest →
    // leftmost), which keeps lanes from crossing.
    groups.sort((a, b) => (position.get(a.target) ?? 0) - (position.get(b.target) ?? 0));
    for (const group of groups) {
      group.edges.sort((a, b) => b.dirName.localeCompare(a.dirName));
    }
    return groups;
  }

  function processNode(node: string): void {
    const wanting = lanesWanting(node);
    let column: number;
    if (wanting.length >= 2) {
      column = emitMergeConnector(node, wanting);
    } else if (wanting.length === 1) {
      column = wanting[0] ?? 0;
    } else {
      column = leftmostFreeLane();
    }

    // Self-edges sit immediately above their node, in its column.
    const selfEdges = [...(selfByFrom.get(node) ?? [])].sort((a, b) =>
      b.dirName.localeCompare(a.dirName),
    );
    for (const selfEdge of selfEdges) emitEdgeRow(selfEdge, column, false);

    emitNodeRow(node, column);

    const rollbacks = [...(rollbacksByFrom.get(node) ?? [])].sort((a, b) =>
      b.dirName.localeCompare(a.dirName),
    );
    const skipRollbacks: ClassifiedEdge[] = [];
    const adjacentRollbacks: ClassifiedEdge[] = [];
    for (const rollback of rollbacks) {
      if (classifyEdgeAdjacency(rollback, position) === 'node-skipping-rollback') {
        skipRollbacks.push(rollback);
      } else {
        adjacentRollbacks.push(rollback);
      }
    }
    for (const rollback of skipRollbacks) {
      emitEdgeRow(rollback, column, false);
    }

    const groups = producerGroups(node);
    const isConvergence = (distinctSourceCountByTo.get(node) ?? 0) >= 2;
    const laneForGroup: number[] = [];
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      if (group === undefined) continue;
      const lane = groupIndex === 0 ? column : leftmostFreeLane();
      laneForGroup[groupIndex] = lane;
      setLane(lane, group.target);
    }

    if (groups.length >= 2) {
      const endLane = Math.max(...laneForGroup);
      emitBranchConnector(node, column, endLane, groups.length);
    }

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
      const group = groups[groupIndex];
      const lane = laneForGroup[groupIndex];
      if (group === undefined || lane === undefined) continue;
      for (const edge of group.edges) {
        emitEdgeRow(edge, lane, isConvergence);
      }
    }

    for (const rollback of adjacentRollbacks) {
      emitEdgeRow(rollback, column, false);
    }

    if (groups.length === 0) {
      // A root / leaf: its column lane terminates here.
      setLane(column, null);
    }
  }

  for (const node of order) processNode(node);

  const refined = refineAdjacency(
    rows,
    nodeColumn,
    position,
    forwardInDegree,
    forwardOutDegree,
    edges,
    producerLaneByHash,
  );
  const skipRollbacks = collectNodeSkippingRollbacks(edges, position);
  const routed = applySkipRollbackRouting(refined, skipRollbacks, position, nodeColumn, edgeColumn);

  return {
    rows: routed,
    nodeColumn,
    edgeColumn,
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

    const result = layoutComponent(component, rowModel.edges);
    allRows.push(...result.rows);
    for (const [hash, column] of result.nodeColumn) nodeColumn.set(hash, column);
    for (const [hash, column] of result.edgeColumn) edgeColumn.set(hash, column);
  }

  return { rows: allRows, nodeColumn, edgeColumn };
}
