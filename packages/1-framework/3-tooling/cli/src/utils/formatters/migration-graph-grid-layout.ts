/**
 * Grid layout for the line/plane/occlusion migration-graph renderer.
 *
 * Produces a Grid (rows × cells) from a MigrationGraphRowModel. Each node
 * emits: fork connector, self-loop rows, node row, merge connector, and
 * inbound migration rows — in display order (tips first, then roots).
 */

import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type {
  Cell,
  CellLine,
  Direction,
  Grid,
  GridOptions,
  Highlight,
  LineRef,
  NodeRef,
  PathRole,
} from './migration-graph-model';
import type { ClassifiedEdge, MigrationGraphRowModel } from './migration-graph-rows';

// ---------------------------------------------------------------------------
// Internal: lane + rank assignment
// ---------------------------------------------------------------------------

interface LaneAssignment {
  nodeLane: Map<string, number>;
  nodeRank: Map<string, number>;
  /** Total number of lanes allocated. */
  numLanes: number;
}

function buildLaneAssignment(
  nodes: readonly (string | null)[],
  edges: readonly ClassifiedEdge[],
): LaneAssignment {
  const allNodes = new Set<string>();
  for (const n of nodes) {
    if (n !== null) allNodes.add(n);
  }

  // Separate forward (non-self) edges
  const fwdEdges = edges.filter((e) => e.kind === 'forward' && e.from !== e.to);

  // Build adjacency: outbound forward edges per node, sorted lex by migrationHash
  const outbound = new Map<string, ClassifiedEdge[]>();
  const inbound = new Map<string, ClassifiedEdge[]>();
  for (const edge of fwdEdges) {
    const ob = outbound.get(edge.from);
    if (ob) ob.push(edge);
    else outbound.set(edge.from, [edge]);

    const ib = inbound.get(edge.to);
    if (ib) ib.push(edge);
    else inbound.set(edge.to, [edge]);
  }
  for (const list of outbound.values()) list.sort((a, b) => a.dirName.localeCompare(b.dirName));
  for (const list of inbound.values()) list.sort((a, b) => a.dirName.localeCompare(b.dirName));

  // Compute longest-forward-path rank from roots (tips get highest rank)
  const nodeRank = new Map<string, number>();
  for (const n of allNodes) nodeRank.set(n, 0);
  for (let pass = 0; pass < allNodes.size; pass++) {
    let changed = false;
    for (const [from, edges] of outbound) {
      const base = nodeRank.get(from) ?? 0;
      for (const e of edges) {
        const next = base + 1;
        if (next > (nodeRank.get(e.to) ?? 0)) {
          nodeRank.set(e.to, next);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Lane assignment: BFS from roots, trunk keeps parent's lane
  const nodeLane = new Map<string, number>();
  let nextLane = 0;

  // Roots: nodes with no inbound forward edges
  const roots: string[] = [];
  for (const n of allNodes) {
    if ((inbound.get(n) ?? []).length === 0) roots.push(n);
  }
  roots.sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });

  const bfsQueue: Array<{ node: string; lane: number }> = [];
  for (const root of roots) {
    if (!nodeLane.has(root)) {
      nodeLane.set(root, nextLane++);
      bfsQueue.push({ node: root, lane: nodeLane.get(root)! });
    }
  }

  // BFS expansion
  let head = 0;
  while (head < bfsQueue.length) {
    const item = bfsQueue[head++]!;
    const { node, lane } = item;
    const children = outbound.get(node) ?? [];
    let first = true;
    for (const childEdge of children) {
      const child = childEdge.to;
      if (!nodeLane.has(child)) {
        const childLane = first ? lane : nextLane++;
        nodeLane.set(child, childLane);
        bfsQueue.push({ node: child, lane: childLane });
      }
      first = false;
    }
  }

  // Isolated nodes (no edges) get their own lane
  for (const n of allNodes) {
    if (!nodeLane.has(n)) nodeLane.set(n, nextLane++);
  }

  return { nodeLane, nodeRank, numLanes: nextLane };
}

// ---------------------------------------------------------------------------
// Internal: display order
// ---------------------------------------------------------------------------

interface NodeDisplay {
  hash: string;
  lane: number;
  rank: number;
}

function computeDisplayOrder(
  nodes: readonly (string | null)[],
  nodeLane: Map<string, number>,
  nodeRank: Map<string, number>,
): NodeDisplay[] {
  const seen = new Set<string>();
  const result: NodeDisplay[] = [];
  for (const n of nodes) {
    if (n === null || seen.has(n)) continue;
    seen.add(n);
    result.push({ hash: n, lane: nodeLane.get(n) ?? 0, rank: nodeRank.get(n) ?? 0 });
  }
  // Tips first (rank desc), within same rank lane asc
  result.sort((a, b) => b.rank - a.rank || a.lane - b.lane);
  return result;
}

// ---------------------------------------------------------------------------
// Internal: grid row builder
// ---------------------------------------------------------------------------

type CellsRow = Cell[];

/** Create an empty cell. */
function emptyCell(): Cell {
  return { lines: [] };
}

// ---------------------------------------------------------------------------
// buildGrid — main entry point
// ---------------------------------------------------------------------------

export function buildGrid(
  rowModel: MigrationGraphRowModel,
  opts: GridOptions = {},
  highlight: Highlight = { mode: 'flat', onPath: new Set() },
): Grid {
  const colsPerLane = opts.colsPerLane ?? 2;
  const isFocus = highlight.mode === 'focus';

  const { nodeLane, nodeRank, numLanes } = buildLaneAssignment(rowModel.nodes, rowModel.edges);

  const displayOrder = computeDisplayOrder(rowModel.nodes, nodeLane, nodeRank);

  // Display index per node (0 = topmost row).
  const displayIndex = new Map<string, number>();
  displayOrder.forEach((d, i) => {
    displayIndex.set(d.hash, i);
  });

  // ── Back-arc planning ────────────────────────────────────────────────────
  // Each rollback edge runs against the forward grain. An *adjacent* rollback
  // (target is the display-neighbour directly below the source) is a plain ↓ in
  // the source's own lane. A *node-skipping* rollback is routed on its own
  // back-lane to the right: it tees off the source node row (○─╮), runs a
  // vertical │ down its back-lane, and lands into the target node (◂╯).
  //
  // Two independent numbers per routed back-arc:
  //   geomLane   — the column its rail occupies. Outermost (largest) goes to the
  //                arc reaching the lowest target (ties: higher source first), so
  //                interleaving spans cross and nested spans nest cleanly.
  //   colourLane — the lane index used purely for colour. Assigned by
  //                migrationHash order, continuing after the forward lanes, so the
  //                first rollback is lane numLanes, the next numLanes+1, etc.
  // These differ whenever two arcs interleave (rollback-cross): the inner column
  // may carry the higher colour. Colour is read off LineRef.lane; the column is
  // where the cell is placed.
  interface RoutedBackArc {
    readonly edge: ClassifiedEdge;
    readonly sourceIndex: number;
    readonly targetIndex: number;
    readonly geomLane: number;
    readonly colourLane: number;
  }

  const rollbackEdges = rowModel.edges.filter((e) => e.kind === 'rollback' && e.from !== e.to);

  const adjacentRollbacks: ClassifiedEdge[] = [];
  const skippingRollbacks: ClassifiedEdge[] = [];
  for (const e of rollbackEdges) {
    const si = displayIndex.get(e.from);
    const ti = displayIndex.get(e.to);
    if (si === undefined || ti === undefined) continue;
    // Adjacent: target sits directly below the source in display order.
    if (ti === si + 1) adjacentRollbacks.push(e);
    else skippingRollbacks.push(e);
  }

  // colourLane by migration NAME (dirName) order — chronological, not hash.
  // Each arc keeps its own colour regardless of convergence.
  const colourLaneOf = new Map<string, number>();
  [...skippingRollbacks]
    .sort((a, b) => a.dirName.localeCompare(b.dirName))
    .forEach((e, i) => {
      colourLaneOf.set(e.migrationHash, numLanes + i);
    });

  // Convergence: group skipping rollbacks by their target node. Arcs sharing a
  // target share one geometric lane (rail column). Each distinct target gets its
  // own rail; arcs within the group compose via occlusion.
  //
  // geomLane ordering: outermost rail goes to the group whose target is lowest
  // in display order (largest target index — deepest in the chain). Within a
  // group, the group's representative target index drives the ordering.
  const targetGroups = new Map<string, ClassifiedEdge[]>();
  for (const e of skippingRollbacks) {
    const group = targetGroups.get(e.to);
    if (group) group.push(e);
    else targetGroups.set(e.to, [e]);
  }
  // Sort target-group keys: largest target index (lowest in display) → outermost lane.
  const sortedTargetKeys = [...targetGroups.keys()].sort((a, b) => {
    const ta = displayIndex.get(a) ?? 0;
    const tb = displayIndex.get(b) ?? 0;
    return tb - ta; // largest index first = outermost
  });
  const numTargetGroups = sortedTargetKeys.length;
  const geomLaneOf = new Map<string, number>();
  const outermostGroup = numLanes + numTargetGroups - 1;
  sortedTargetKeys.forEach((targetHash, i) => {
    const groupGeomLane = outermostGroup - i;
    for (const e of targetGroups.get(targetHash)!) {
      geomLaneOf.set(e.migrationHash, groupGeomLane);
    }
  });

  const routedBackArcs: RoutedBackArc[] = skippingRollbacks.map((e) => ({
    edge: e,
    sourceIndex: displayIndex.get(e.from) ?? 0,
    targetIndex: displayIndex.get(e.to) ?? 0,
    geomLane: geomLaneOf.get(e.migrationHash) ?? numLanes,
    colourLane: colourLaneOf.get(e.migrationHash) ?? numLanes,
  }));

  const backArcsBySource = new Map<string, RoutedBackArc[]>();
  const backArcsByTarget = new Map<string, RoutedBackArc[]>();
  for (const arc of routedBackArcs) {
    const sb = backArcsBySource.get(arc.edge.from);
    if (sb) sb.push(arc);
    else backArcsBySource.set(arc.edge.from, [arc]);
    const tb = backArcsByTarget.get(arc.edge.to);
    if (tb) tb.push(arc);
    else backArcsByTarget.set(arc.edge.to, [arc]);
  }

  const adjacentBySource = new Map<string, ClassifiedEdge[]>();
  const adjacentByTarget = new Map<string, ClassifiedEdge[]>();
  for (const e of adjacentRollbacks) {
    const b = adjacentBySource.get(e.from);
    if (b) b.push(e);
    else adjacentBySource.set(e.from, [e]);
    const t = adjacentByTarget.get(e.to);
    if (t) t.push(e);
    else adjacentByTarget.set(e.to, [e]);
  }
  for (const list of adjacentBySource.values())
    list.sort((a, b) => a.dirName.localeCompare(b.dirName));

  const numBackLanes = numTargetGroups;
  const totalCols = (numLanes + numBackLanes) * colsPerLane;

  // Build edge lookup maps (classified)
  const fwdEdges = rowModel.edges.filter((e) => e.kind === 'forward' && e.from !== e.to);
  const selfEdges = rowModel.edges.filter((e) => e.kind === 'self');

  // outbound sorted by migrationHash
  const outboundFwd = new Map<string, ClassifiedEdge[]>();
  const inboundFwd = new Map<string, ClassifiedEdge[]>();
  for (const e of fwdEdges) {
    const ob = outboundFwd.get(e.from);
    if (ob) ob.push(e);
    else outboundFwd.set(e.from, [e]);
    const ib = inboundFwd.get(e.to);
    if (ib) ib.push(e);
    else inboundFwd.set(e.to, [e]);
  }
  for (const list of outboundFwd.values()) list.sort((a, b) => a.dirName.localeCompare(b.dirName));
  for (const list of inboundFwd.values()) list.sort((a, b) => a.dirName.localeCompare(b.dirName));

  const selfEdgesByNode = new Map<string, ClassifiedEdge[]>();
  for (const e of selfEdges) {
    const bucket = selfEdgesByNode.get(e.from);
    if (bucket) bucket.push(e);
    else selfEdgesByNode.set(e.from, [e]);
  }
  for (const list of selfEdgesByNode.values())
    list.sort((a, b) => a.dirName.localeCompare(b.dirName));

  // ── Role + plane: mode/z-order seam ──────────────────────────────────────
  // role(migrationHash): focus → on-path/off-path from highlight.onPath; flat → undefined.
  function roleOf(migrationHash: string): PathRole | undefined {
    if (!isFocus) return undefined;
    return highlight.onPath.has(migrationHash) ? 'on-path' : 'off-path';
  }

  // On-path node set: a node is on-path iff an on-path edge touches it (from or
  // to) — forward, self, OR rollback (a back-arc's endpoints are on its route).
  const onPathNodes = new Set<string>();
  if (isFocus) {
    for (const e of [...fwdEdges, ...selfEdges, ...rollbackEdges]) {
      if (highlight.onPath.has(e.migrationHash)) {
        onPathNodes.add(e.from);
        onPathNodes.add(e.to);
      }
    }
  }
  function nodeRoleOf(hash: string): PathRole | undefined {
    if (!isFocus) return undefined;
    return onPathNodes.has(hash) ? 'on-path' : 'off-path';
  }

  // planeOf — z-order. Lower number = drawn on top.
  //   flat:  trunk on top → plane = lane (lane 0 topmost).
  //   focus: on-path on top → on-path = plane 0; off-path sits beneath it,
  //          ordered by lane so a deterministic owner survives among off-path lines.
  function planeOf(lane: number, role: PathRole | undefined): number {
    if (!isFocus) return lane;
    return role === 'on-path' ? 0 : lane + 1;
  }

  // ── LineRef + cell builders (role-aware) ─────────────────────────────────
  function lineRefFor(edge: ClassifiedEdge, lane: number): LineRef {
    return {
      migrationHash: edge.migrationHash,
      dirName: edge.dirName,
      lane,
      role: roleOf(edge.migrationHash),
    };
  }

  /** Synthetic LineRef for a lane carrying a representative edge's role (pass-through). */
  function passLineRef(lane: number, dirName: string, migHash: string): LineRef {
    return { migrationHash: migHash, dirName, lane, role: roleOf(migHash) };
  }

  function vertCell(line: LineRef): Cell {
    return {
      lines: [
        {
          line,
          directions: new Set<Direction>(['up', 'down']),
          plane: planeOf(line.lane, line.role),
        },
      ],
    };
  }

  function dirCell(line: LineRef, dirs: ReadonlySet<Direction>): Cell {
    return { lines: [{ line, directions: dirs, plane: planeOf(line.lane, line.role) }] };
  }

  function nodeCell(nodeRef: NodeRef): Cell {
    return { node: nodeRef, lines: [] };
  }

  // Pass-through colour follows the edge CURRENTLY occupying a lane at this row,
  // not a lane-wide average. A single lane carries different edges (with different
  // roles) over its vertical extent — e.g. lane 0 below a fork carries the trunk
  // branch (off-path) above the fork node and the trunk's parent edge (on-path)
  // below it. We track the active edge per lane as we descend top-to-bottom and
  // colour pass-through verticals from it. `laneCurrentEdge[L]` = the edge whose
  // vertical body currently runs through lane L at the row being emitted.
  const laneCurrentEdge = new Map<number, ClassifiedEdge>();

  function getRepLine(lane: number): LineRef {
    const e = laneCurrentEdge.get(lane);
    if (e) return lineRefFor(e, lane);
    return passLineRef(lane, `lane${lane}`, `lane${lane}`);
  }

  // Active lanes: set of lane indices currently visible (vertical passes through them)
  const activeLanes = new Set<number>();

  const grid: Cell[][] = [];

  function makeRow(): CellsRow {
    return Array.from({ length: totalCols }, () => emptyCell());
  }

  // Place vertical pass-throughs for all active lanes in a row, skipping specified lanes.
  function placeVerticals(row: CellsRow, skip: Set<number>): void {
    for (const lane of activeLanes) {
      if (skip.has(lane)) continue;
      const railCol = lane * colsPerLane;
      const cell = row[railCol];
      if (cell !== undefined && cell.lines.length === 0 && !cell.node) {
        row[railCol] = vertCell(getRepLine(lane));
      }
    }
  }

  // ── Back-arc helpers ──────────────────────────────────────────────────────
  // Active routed back-arcs whose vertical currently runs through their geomLane.
  const activeBackArcs = new Set<RoutedBackArc>();

  // A back-arc's LineRef carries its colourLane (not its geomLane) so colour is
  // read off the lane that drives the rotation, independent of column placement.
  function backArcLine(arc: RoutedBackArc): LineRef {
    return {
      migrationHash: arc.edge.migrationHash,
      dirName: arc.edge.dirName,
      lane: arc.colourLane,
      role: roleOf(arc.edge.migrationHash),
    };
  }

  function backArcPlane(arc: RoutedBackArc): number {
    const role = roleOf(arc.edge.migrationHash);
    if (!isFocus) return arc.colourLane;
    return role === 'on-path' ? 0 : arc.colourLane + 1;
  }

  // Compose a CellLine into a row cell (never overwrite — occlusion arbitrates).
  function composeLine(
    row: CellsRow,
    col: number,
    line: LineRef,
    dirs: ReadonlySet<Direction>,
    plane: number,
    extra?: { landingArrow?: boolean },
  ): void {
    const existing = row[col];
    const cellLine: CellLine = {
      line,
      directions: dirs,
      plane,
      ...(extra?.landingArrow ? { landingArrow: true } : {}),
    };
    if (existing && (existing.lines.length > 0 || existing.node)) {
      row[col] = { ...existing, lines: [...existing.lines, cellLine] };
    } else {
      row[col] = { lines: [cellLine] };
    }
  }

  // Place verticals for every active back-arc on this row (in its geomLane rail).
  function placeBackVerticals(row: CellsRow): void {
    for (const arc of activeBackArcs) {
      const railCol = arc.geomLane * colsPerLane;
      composeLine(
        row,
        railCol,
        backArcLine(arc),
        new Set<Direction>(['up', 'down']),
        backArcPlane(arc),
      );
    }
    placeAdjacentOverlays(row);
  }

  // Adjacent rollbacks share the source's own lane: their vertical body overlays
  // the forward trunk between source and target. In focus, an on-path adjacent
  // rollback lifts that segment of the trunk to the top plane (drawn green); in
  // flat it sits at the same plane/colour as the trunk, so it is a no-op there.
  interface ActiveAdjacent {
    readonly lane: number;
    readonly edge: ClassifiedEdge;
  }
  const activeAdjacent = new Set<ActiveAdjacent>();

  function placeAdjacentOverlays(row: CellsRow): void {
    for (const adj of activeAdjacent) {
      const railCol = adj.lane * colsPerLane;
      const cell = row[railCol];
      if (cell?.node) continue; // never overlay a node marker
      const line = lineRefFor(adj.edge, adj.lane);
      composeLine(
        row,
        railCol,
        line,
        new Set<Direction>(['up', 'down']),
        planeOf(adj.lane, line.role),
      );
    }
  }

  // Tee a routed back-arc off its source node row: a horizontal bridge from the
  // node's connector column across to the back-lane rail, ending in a ╮ corner
  // (down+left). Composed (not overwritten) so it occludes / is occluded by any
  // back-arc vertical it crosses.
  function emitBackArcTee(row: CellsRow, nodeLaneNum: number, arc: RoutedBackArc): void {
    const nodeRail = nodeLaneNum * colsPerLane;
    const geomRail = arc.geomLane * colsPerLane;
    const line = backArcLine(arc);
    const plane = backArcPlane(arc);
    for (let col = nodeRail + 1; col < geomRail; col++) {
      composeLine(row, col, line, new Set<Direction>(['left', 'right']), plane);
    }
    composeLine(row, geomRail, line, new Set<Direction>(['down', 'left']), plane);
  }

  // Land a routed back-arc into its target node row: a ◂ arrowhead in the node's
  // connector column, a horizontal bridge across to the back-lane rail, ending in
  // a ╯ corner (up+left). Composed so the on-top arc draws the anchor and the
  // others yield their corners beneath it (occlusion arbitrates).
  function emitBackArcLanding(row: CellsRow, nodeLaneNum: number, arc: RoutedBackArc): void {
    const nodeRail = nodeLaneNum * colsPerLane;
    const geomRail = arc.geomLane * colsPerLane;
    const line = backArcLine(arc);
    const plane = backArcPlane(arc);
    composeLine(row, nodeRail + 1, line, new Set<Direction>(['left', 'right']), plane, {
      landingArrow: true,
    });
    for (let col = nodeRail + 2; col < geomRail; col++) {
      composeLine(row, col, line, new Set<Direction>(['left', 'right']), plane);
    }
    composeLine(row, geomRail, line, new Set<Direction>(['up', 'left']), plane);
  }

  // Emit a connector row (fork or merge).
  //
  // The CONTINUOUS lane gets the unbroken vertical/sweep; every other
  // participating lane yields into its own corner. In flat mode the continuous
  // lane is the trunk (lane of the node); in focus mode it is the on-path lane
  // (the inbound/outbound edge whose migration is on-path), so the chosen route
  // is drawn as one continuous green line sweeping the merge/fork.
  //
  // Geometry is identical regardless of which lane is continuous; only the
  // NODE-ANCHOR glyph at the trunk rail changes:
  //   continuous == trunk    → │  (vertical, the trunk passes straight through)
  //   continuous == a branch → corner toward that branch
  //       merge: ╰ (up+right)   fork: ╭ (down+right)
  // The branch's own rail always carries its yield corner (merge ╮ / fork ╯), and
  // the cells between carry horizontals. The continuous (on-path) sweep is placed
  // on the top plane so it occludes the trunk's vertical at the node anchor.
  function emitConnectorRow(
    trunkLane: number,
    branchEntries: readonly { lane: number; edge: ClassifiedEdge }[],
    connectorType: 'fork' | 'merge',
    trunkEdge: ClassifiedEdge | undefined,
  ): CellsRow {
    const row = makeRow();
    const sorted = [...branchEntries].sort((a, b) => a.lane - b.lane);
    if (sorted.length === 0) return row;

    const branchByLane = new Map<number, ClassifiedEdge>();
    for (const b of sorted) branchByLane.set(b.lane, b.edge);

    // Continuous lane: the on-path participant in focus, else the trunk.
    let continuousLane = trunkLane;
    if (isFocus) {
      if (trunkEdge && highlight.onPath.has(trunkEdge.migrationHash)) {
        continuousLane = trunkLane;
      } else {
        const onPathBranch = sorted.find((b) => highlight.onPath.has(b.edge.migrationHash));
        if (onPathBranch) continuousLane = onPathBranch.lane;
      }
    }

    const trunkRailCol = trunkLane * colsPerLane;
    const continuousRailCol = continuousLane * colsPerLane;

    // Add a CellLine to a cell (compose, don't overwrite) so occlusion arbitrates.
    function addLine(col: number, line: LineRef, dirs: ReadonlySet<Direction>): void {
      const existing = row[col];
      const cellLine: CellLine = { line, directions: dirs, plane: planeOf(line.lane, line.role) };
      row[col] =
        existing && existing.lines.length > 0
          ? { ...existing, lines: [...existing.lines, cellLine] }
          : { lines: [cellLine] };
    }

    const cornerLeftDown: ReadonlySet<Direction> =
      connectorType === 'merge'
        ? new Set<Direction>(['left', 'down'])
        : new Set<Direction>(['left', 'up']);

    // ── Base plane: every yielding branch lays its own corner + the horizontal
    //    segment to its left (up to the previous branch's rail). These sit on the
    //    branch's lane plane; where the continuous sweep crosses them it occludes.
    for (let i = 0; i < sorted.length; i++) {
      const b = sorted[i]!;
      if (b.lane === continuousLane) continue; // continuous drawn separately, on top
      const branchLine = lineRefFor(b.edge, b.lane);
      const railCol = b.lane * colsPerLane;
      addLine(railCol, branchLine, cornerLeftDown);
      const leftBound = i === 0 ? trunkRailCol + 1 : sorted[i - 1]!.lane * colsPerLane + 1;
      for (let col = leftBound; col < railCol; col++) {
        addLine(col, branchLine, new Set<Direction>(['left', 'right']));
      }
    }

    // ── The continuous line ──────────────────────────────────────────────────
    const continuousLine: LineRef =
      continuousLane === trunkLane
        ? trunkEdge
          ? lineRefFor(trunkEdge, trunkLane)
          : getRepLine(trunkLane)
        : lineRefFor(branchByLane.get(continuousLane)!, continuousLane);

    if (continuousLane === trunkLane) {
      // Trunk passes straight through the node anchor (│), branches yield to it.
      addLine(trunkRailCol, continuousLine, new Set<Direction>(['up', 'down']));
    } else {
      // A branch is continuous: it sweeps from the node anchor across to its own
      // rail, on the TOP plane, occluding the trunk vertical and any intermediate
      // yielding branch corners it passes over.
      const anchorDirs: ReadonlySet<Direction> =
        connectorType === 'merge'
          ? new Set<Direction>(['up', 'right'])
          : new Set<Direction>(['down', 'right']);
      addLine(trunkRailCol, continuousLine, anchorDirs);
      for (let col = trunkRailCol + 1; col < continuousRailCol; col++) {
        addLine(col, continuousLine, new Set<Direction>(['left', 'right']));
      }
      addLine(continuousRailCol, continuousLine, cornerLeftDown);
    }

    // Other active lanes (not trunk, not branch): vertical pass-through.
    const skipSet = new Set<number>([trunkLane, ...sorted.map((b) => b.lane)]);
    placeVerticals(row, skipSet);
    placeBackVerticals(row);

    return row;
  }

  // Process each node in display order
  for (const nodeDisplay of displayOrder) {
    const { hash: nodeHash } = nodeDisplay;
    const nodeLaneNum = nodeLane.get(nodeHash) ?? 0;

    activeLanes.add(nodeLaneNum);

    // ── 1. Fork connector (BEFORE the node row) ──────────────────────────
    const outEdges = outboundFwd.get(nodeHash) ?? [];
    if (outEdges.length > 1) {
      const trunkChildLane = nodeLane.get(outEdges[0]!.to) ?? nodeLaneNum;
      const branchEntries = outEdges
        .slice(1)
        .map((e) => ({ lane: nodeLane.get(e.to) ?? 0, edge: e }))
        .filter((b) => b.lane !== trunkChildLane && activeLanes.has(b.lane));

      if (branchEntries.length > 0) {
        const trunkEdge = outEdges[0];
        const connRow = emitConnectorRow(nodeLaneNum, branchEntries, 'fork', trunkEdge);
        grid.push(connRow);
        assertSingleOwner(connRow, isFocus);

        for (const b of branchEntries) activeLanes.delete(b.lane);
      }
    }

    // ── 2. Self-loop rows (BEFORE the node row) ───────────────────────────
    const selfMigrations = selfEdgesByNode.get(nodeHash) ?? [];
    for (const selfEdge of selfMigrations) {
      const row = makeRow();
      const railCol = nodeLaneNum * colsPerLane;
      const connCol = nodeLaneNum * colsPerLane + 1;
      const line = lineRefFor(selfEdge, nodeLaneNum);
      row[railCol] = vertCell(line);
      row[connCol] = {
        lines: [
          {
            line,
            directions: new Set<Direction>(),
            plane: planeOf(nodeLaneNum, line.role),
            selfLoop: true,
          },
        ],
      };
      placeVerticals(row, new Set([nodeLaneNum]));
      placeBackVerticals(row);
      grid.push(row);
    }

    // ── 3. Node row ────────────────────────────────────────────────────────
    {
      const row = makeRow();
      const railCol = nodeLaneNum * colsPerLane;
      const nodeRef: NodeRef = {
        contractHash: nodeHash,
        isEmpty: nodeHash === EMPTY_CONTRACT_HASH,
        lane: nodeLaneNum,
        role: nodeRoleOf(nodeHash),
      };
      row[railCol] = nodeCell(nodeRef);
      placeVerticals(row, new Set([nodeLaneNum]));

      // A back-arc landing ends its vertical at this row, replacing it with a ╯
      // corner — so deactivate landing arcs BEFORE placing back verticals. An
      // adjacent rollback's overlay likewise ends at its target node.
      const landingArcs = backArcsByTarget.get(nodeHash) ?? [];
      for (const arc of landingArcs) activeBackArcs.delete(arc);
      for (const adj of [...activeAdjacent]) {
        if (adj.edge.to === nodeHash) activeAdjacent.delete(adj);
      }

      placeBackVerticals(row);

      // Back-arc landing: arcs targeting this node sweep from the node anchor
      // (◂ arrowhead) across to their own rail corner (╯). The on-top arc draws
      // the anchor; others yield their corners beneath (occlusion arbitrates).
      for (const arc of landingArcs) {
        emitBackArcLanding(row, nodeLaneNum, arc);
      }

      // Back-arc tee: arcs sourced at this node tee off the node row into their
      // back-lane (─ bridge + ╮ corner). The vertical begins on the next row.
      const teeArcs = backArcsBySource.get(nodeHash) ?? [];
      for (const arc of teeArcs) {
        emitBackArcTee(row, nodeLaneNum, arc);
      }

      grid.push(row);

      // Activate the back-arc verticals AFTER the node row so the rail runs from
      // the next row down to (but not including) the target landing row.
      for (const arc of teeArcs) activeBackArcs.add(arc);

      // Activate adjacent-rollback overlays sourced here (their trunk overlay
      // runs from the next row down to the target node).
      for (const adj of adjacentBySource.get(nodeHash) ?? []) {
        activeAdjacent.add({ lane: nodeLaneNum, edge: adj });
      }
    }

    // Inbound forward edges run down their lanes below this node. Record each as
    // its lane's current edge NOW (before emitting the back-arc arrow rows, merge
    // connector, and migration rows) so pass-through verticals colour from the
    // forward edge actually occupying the trunk below this node.
    const inEdges = inboundFwd.get(nodeHash) ?? [];
    inEdges.sort((a, b) => a.dirName.localeCompare(b.dirName));
    for (const edge of inEdges) {
      const edgeLane = Math.max(nodeLane.get(edge.from) ?? 0, nodeLane.get(edge.to) ?? 0);
      laneCurrentEdge.set(edgeLane, edge);
    }

    // ── 3b. Back-arc arrow rows ──────────────────────────────────────────────
    // For each routed arc sourced here, a │↓ arrow row in its back-lane sits
    // directly below the source node (before the source node's forward inbound
    // migration rows).
    {
      const teeArcs = backArcsBySource.get(nodeHash) ?? [];
      for (const arc of teeArcs) {
        const row = makeRow();
        const railCol = arc.geomLane * colsPerLane;
        const connCol = railCol + 1;
        const line = backArcLine(arc);
        const plane = backArcPlane(arc);
        composeLine(row, railCol, line, new Set<Direction>(['up', 'down']), plane);
        composeLine(row, connCol, line, new Set<Direction>(['down']), plane);
        placeVerticals(row, new Set<number>());
        placeBackVerticals(row);
        grid.push(row);
      }
    }

    // ── 4. Merge connector (AFTER the node row) ────────────────────────────
    if (inEdges.length > 1) {
      const branchEntries = inEdges
        .slice(1)
        .map((e) => ({ lane: nodeLane.get(e.from) ?? 0, edge: e }));

      const trunkEdge = inEdges[0];
      const connRow = emitConnectorRow(nodeLaneNum, branchEntries, 'merge', trunkEdge);
      grid.push(connRow);
      assertSingleOwner(connRow, isFocus);

      for (const b of branchEntries) activeLanes.add(b.lane);
    }

    // ── 5. Migration rows (one per inbound edge, ordered by migration hash) ─
    for (const edge of inEdges) {
      const fromLane = nodeLane.get(edge.from) ?? 0;
      const toLane = nodeLane.get(edge.to) ?? 0;
      const edgeLane = Math.max(fromLane, toLane);
      const row = makeRow();
      const railCol = edgeLane * colsPerLane;
      const connCol = edgeLane * colsPerLane + 1;
      const line = lineRefFor(edge, edgeLane);

      row[railCol] = vertCell(line);
      row[connCol] = dirCell(line, new Set<Direction>(['up']));

      placeVerticals(row, new Set([edgeLane]));
      placeBackVerticals(row);
      grid.push(row);
    }

    // ── 5b. Adjacent rollback ↓ rows ─────────────────────────────────────────
    // An adjacent rollback (target is the display-neighbour directly below) is a
    // plain ↓ in the source's own lane — mirror of the forward ↑ — emitted after
    // the source node's forward inbound rows, directly above the target node.
    {
      const adjacents = adjacentBySource.get(nodeHash) ?? [];
      for (const adj of adjacents) {
        const row = makeRow();
        const connCol = nodeLaneNum * colsPerLane + 1;
        const line = lineRefFor(adj, nodeLaneNum);
        const plane = planeOf(nodeLaneNum, line.role);
        // The rail │ belongs to the trunk passing through (drawn by placeVerticals
        // from the lane's current forward edge); only the ↓ arrow is the rollback.
        composeLine(row, connCol, line, new Set<Direction>(['down']), plane);
        placeVerticals(row, new Set<number>());
        placeBackVerticals(row);
        grid.push(row);
      }
    }

    // ── 6. Root lane deactivation ─────────────────────────────────────────
    if (inEdges.length === 0) {
      activeLanes.delete(nodeLaneNum);
    }
  }

  return grid;
}

// ---------------------------------------------------------------------------
// Single-owner invariant — after building a connector row, assert that every
// cell has at most one DRAWABLE owner once occlusion (topmost plane) is applied.
// In focus mode a tie at the same plane between an on-path and an off-path line
// would be a colour ambiguity, so we additionally assert that at the top plane
// of each cell exactly one role survives.
// ---------------------------------------------------------------------------
function assertSingleOwner(row: CellsRow, isFocus: boolean): void {
  for (const cell of row) {
    if (cell.lines.length <= 1) continue;
    let topPlane = Number.POSITIVE_INFINITY;
    for (const cl of cell.lines) if (cl.plane < topPlane) topPlane = cl.plane;
    const top = cell.lines.filter((cl: CellLine) => cl.plane === topPlane);
    if (top.length > 1) {
      if (isFocus) {
        const roles = new Set(top.map((cl) => cl.line.role));
        if (roles.size > 1) {
          throw new Error(
            'migration-graph layout: single-owner invariant violated — two differently-roled lines share the top plane in one cell',
          );
        }
      }
    }
  }
}
