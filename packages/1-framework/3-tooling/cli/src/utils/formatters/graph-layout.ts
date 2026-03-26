import type {
  BranchTree,
  GraphEdge,
  GraphLayout,
  GraphNode,
  GraphRenderOptions,
  LayoutEdge,
  LayoutNode,
} from './graph-types';

// ---------------------------------------------------------------------------
// Pass 1: Layout — compute spine, depth, branches, columns
// ---------------------------------------------------------------------------

export function computeLayout(
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
  options: GraphRenderOptions,
): GraphLayout {
  const rootId = options.rootId ?? findRoot(nodes, edges);
  const adjacency = buildAdjacency(edges);

  // Step 1: Compute spine
  const spinePath = findSpinePath(adjacency, rootId, options.spineTarget);
  const spineNodeSet = new Set(
    spinePath
      .map((e) => e.from)
      .concat(spinePath.length > 0 ? [spinePath[spinePath.length - 1]!.to] : [rootId]),
  );
  const spineEdgeSet = new Set(spinePath.map((e) => edgeKey(e)));

  // Step 2: Compute depth
  const depth = computeDepth(nodes, adjacency, edges);

  // Step 3: Build branch trees and collect spine-to-spine backward edges
  const branches: BranchTree[] = [];
  const spineBackwardEdges: GraphEdge[] = [];
  const spineNodes = spinePath.map((e) => e.from);
  spineNodes.push(spinePath.length > 0 ? spinePath[spinePath.length - 1]!.to : rootId);

  for (const spineNode of spineNodes) {
    const outgoing = adjacency.get(spineNode) ?? [];
    for (const edge of outgoing) {
      if (spineEdgeSet.has(edgeKey(edge))) continue;

      // Spine-to-spine backward edge: both endpoints on spine, target is earlier in depth
      if (spineNodeSet.has(edge.to)) {
        const fromDepth = depth.get(edge.from) ?? 0;
        const toDepth = depth.get(edge.to) ?? 0;
        if (toDepth <= fromDepth) {
          spineBackwardEdges.push(edge);
          continue;
        }
      }

      const branch = buildBranchTree(edge, adjacency, spineNodeSet, depth, new Set(spineNodeSet));
      branches.push(branch);
    }
  }

  // Step 4: Assign columns
  const { spineColumn, totalColumns: branchColumns } = assignColumns(branches);

  // Assign columns for spine backward edges (right of spine, after branch backward edges).
  // Non-overlapping edges share a column; overlapping ones get separate columns.
  let nextRightCol = branchColumns;
  const spineBackwardColumnMap = new Map<string, number>();
  // Group backward edges into columns by depth-range overlap
  const backwardColumns: Array<{ col: number; ranges: Array<{ from: number; to: number }> }> = [];

  for (const e of spineBackwardEdges) {
    const fromDepth = depth.get(e.from) ?? 0;
    const toDepth = depth.get(e.to) ?? 0;
    const minD = Math.min(fromDepth, toDepth);
    const maxD = Math.max(fromDepth, toDepth);

    // Find existing column with no overlapping range
    let assigned = false;
    for (const bc of backwardColumns) {
      const overlaps = bc.ranges.some((r) => minD < r.to && maxD > r.from);
      if (!overlaps) {
        bc.ranges.push({ from: minD, to: maxD });
        spineBackwardColumnMap.set(edgeKey(e), bc.col);
        assigned = true;
        break;
      }
    }
    if (!assigned) {
      const col = nextRightCol++;
      backwardColumns.push({ col, ranges: [{ from: minD, to: maxD }] });
      spineBackwardColumnMap.set(edgeKey(e), col);
    }
  }
  const totalColumns = nextRightCol;

  const layoutNodes: LayoutNode[] = [];
  const layoutEdges: LayoutEdge[] = [];

  // Place spine nodes
  for (const nodeId of spineNodes) {
    layoutNodes.push({ id: nodeId, depth: depth.get(nodeId) ?? 0, column: spineColumn });
  }

  // Place spine edges
  for (const e of spinePath) {
    layoutEdges.push({
      from: e.from,
      to: e.to,
      column: spineColumn,
      direction: 'forward',
      edge: e,
    });
  }

  // Place branch nodes and edges
  placeBranches(branches, depth, layoutNodes, layoutEdges);

  // Place spine-to-spine backward edges
  for (const e of spineBackwardEdges) {
    const col = spineBackwardColumnMap.get(edgeKey(e))!;
    layoutEdges.push({ from: e.from, to: e.to, column: col, direction: 'backward', edge: e });
  }

  // Step 5: Column widths
  const maxDepth = Math.max(...[...depth.values()], 0);

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    columns: [],
    maxDepth,
    spineColumn,
    totalColumns,
  };
}

// ---------------------------------------------------------------------------
// Adjacency helpers
// ---------------------------------------------------------------------------

function buildAdjacency(edges: readonly GraphEdge[]): Map<string, GraphEdge[]> {
  const adj = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    let list = adj.get(e.from);
    if (!list) {
      list = [];
      adj.set(e.from, list);
    }
    list.push(e);
  }
  return adj;
}

function edgeKey(e: GraphEdge): string {
  return `${e.from}→${e.to}`;
}

// ---------------------------------------------------------------------------
// Root detection
// ---------------------------------------------------------------------------

function findRoot(nodes: readonly GraphNode[], edges: readonly GraphEdge[]): string {
  const hasIncoming = new Set(edges.map((e) => e.to));
  for (const n of nodes) {
    if (!hasIncoming.has(n.id)) return n.id;
  }
  return nodes[0]?.id ?? '';
}

// ---------------------------------------------------------------------------
// Spine: BFS shortest path from root to target
// ---------------------------------------------------------------------------

function findSpinePath(
  adjacency: Map<string, GraphEdge[]>,
  rootId: string,
  targetId: string,
): GraphEdge[] {
  if (rootId === targetId) return [];

  const visited = new Set<string>([rootId]);
  const parent = new Map<string, { node: string; edge: GraphEdge }>();
  const queue: string[] = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      const path: GraphEdge[] = [];
      let node = targetId;
      let entry = parent.get(node);
      while (entry) {
        path.push(entry.edge);
        node = entry.node;
        entry = parent.get(node);
      }
      path.reverse();
      return path;
    }

    const outgoing = adjacency.get(current) ?? [];
    for (const edge of outgoing) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        parent.set(edge.to, { node: current, edge });
        queue.push(edge.to);
      }
    }
  }

  return []; // no path found
}

// ---------------------------------------------------------------------------
// Depth computation: max(predecessor depths) + 1
// ---------------------------------------------------------------------------

function computeDepth(
  nodes: readonly GraphNode[],
  adjacency: Map<string, GraphEdge[]>,
  edges: readonly GraphEdge[],
): Map<string, number> {
  const depth = new Map<string, number>();

  // Detect backward edges (edges where `to` has a depth <= `from` in a simple BFS).
  // We do a preliminary BFS to find topological order, then mark backward edges.
  const backwardEdges = detectBackwardEdges(nodes, adjacency);

  // Compute in-degree excluding backward edges
  const inDegree = new Map<string, number>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
  }
  for (const e of edges) {
    if (backwardEdges.has(edgeKey(e))) continue;
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
  }

  // Kahn's algorithm for topological depth
  const queue: string[] = [];
  for (const n of nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) {
      queue.push(n.id);
      depth.set(n.id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentDepth = depth.get(current) ?? 0;

    const outgoing = adjacency.get(current) ?? [];
    for (const edge of outgoing) {
      if (backwardEdges.has(edgeKey(edge))) continue;

      const prevDepth = depth.get(edge.to);
      const newDepth = currentDepth + 1;
      if (prevDepth === undefined || newDepth > prevDepth) {
        depth.set(edge.to, newDepth);
      }

      const remaining = (inDegree.get(edge.to) ?? 1) - 1;
      inDegree.set(edge.to, remaining);
      if (remaining === 0) {
        queue.push(edge.to);
      }
    }
  }

  return depth;
}

/** Detect backward edges using a DFS-based cycle detection. */
function detectBackwardEdges(
  nodes: readonly GraphNode[],
  adjacency: Map<string, GraphEdge[]>,
): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const backward = new Set<string>();

  for (const n of nodes) {
    color.set(n.id, WHITE);
  }

  function dfs(u: string): void {
    color.set(u, GRAY);
    const outgoing = adjacency.get(u) ?? [];
    for (const edge of outgoing) {
      const c = color.get(edge.to);
      if (c === GRAY) {
        backward.add(edgeKey(edge));
      } else if (c === WHITE) {
        dfs(edge.to);
      }
    }
    color.set(u, BLACK);
  }

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) {
      dfs(n.id);
    }
  }

  return backward;
}

// ---------------------------------------------------------------------------
// Branch tree builder
// ---------------------------------------------------------------------------

function buildBranchTree(
  startEdge: GraphEdge,
  adjacency: Map<string, GraphEdge[]>,
  ancestorNodes: Set<string>,
  depth: Map<string, number>,
  visited: Set<string>,
): BranchTree {
  const edges: GraphEdge[] = [startEdge];
  const branchVisited = new Set(visited);
  branchVisited.add(startEdge.to);

  let current = startEdge.to;
  let backwardEdge: GraphEdge | undefined;
  let mergeEdge: GraphEdge | undefined;
  const subBranches: BranchTree[] = [];

  while (true) {
    const outgoing = (adjacency.get(current) ?? []).filter(
      (e) => !branchVisited.has(e.to) || ancestorNodes.has(e.to),
    );

    if (outgoing.length === 0) {
      // Leaf node
      break;
    }

    // Check for edges that reconnect to an ancestor/spine node
    const reconnectEdge = outgoing.find((e) => ancestorNodes.has(e.to));
    if (reconnectEdge) {
      const currentDepth = depth.get(current) ?? 0;
      const targetDepth = depth.get(reconnectEdge.to) ?? 0;

      if (targetDepth > currentDepth) {
        mergeEdge = reconnectEdge;
      } else {
        backwardEdge = reconnectEdge;
      }

      const remaining = outgoing.filter((e) => e !== reconnectEdge);
      if (remaining.length === 0) break;

      // If we have a merge AND forward continuations, the trunk stops here.
      // Forward continuations become sub-branches so the merge connector
      // can use this column on the merge target's row.
      if (mergeEdge) {
        const newAncestors = new Set(ancestorNodes);
        for (const e of edges) {
          newAncestors.add(e.from);
          newAncestors.add(e.to);
        }
        for (const fwd of remaining) {
          if (!ancestorNodes.has(fwd.to)) {
            const subBranch = buildBranchTree(
              fwd,
              adjacency,
              newAncestors,
              depth,
              new Set(branchVisited),
            );
            subBranches.push(subBranch);
          }
        }
        break;
      }
    }

    const forward = outgoing.filter((e) => !ancestorNodes.has(e.to));

    if (forward.length === 0) break;

    if (forward.length === 1) {
      edges.push(forward[0]!);
      branchVisited.add(forward[0]!.to);
      current = forward[0]!.to;
    } else {
      // Multiple outgoing — trunk follows deepest, rest are sub-branches
      const sorted = [...forward].sort((a, b) => {
        const da = maxReachableDepth(a.to, adjacency, depth, new Set(branchVisited));
        const db = maxReachableDepth(b.to, adjacency, depth, new Set(branchVisited));
        return db - da; // deepest first
      });

      // Trunk = deepest path
      const trunk = sorted[0]!;
      edges.push(trunk);
      branchVisited.add(trunk.to);
      current = trunk.to;

      // Sub-branches = the rest
      const newAncestors = new Set(ancestorNodes);
      for (const e of edges) {
        newAncestors.add(e.from);
        newAncestors.add(e.to);
      }

      for (let i = 1; i < sorted.length; i++) {
        const subBranch = buildBranchTree(
          sorted[i]!,
          adjacency,
          newAncestors,
          depth,
          new Set(branchVisited),
        );
        subBranches.push(subBranch);
      }
    }
  }

  const trunkLeafDepth = depth.get(current) ?? 0;
  const subMaxDepths = subBranches.map((b) => b.maxLeafDepth);
  const maxLeafDepth = Math.max(trunkLeafDepth, ...subMaxDepths);

  return {
    forkNode: startEdge.from,
    edges,
    backwardEdge,
    mergeEdge,
    subBranches,
    maxLeafDepth,
  };
}

function maxReachableDepth(
  nodeId: string,
  adjacency: Map<string, GraphEdge[]>,
  depth: Map<string, number>,
  visited: Set<string>,
): number {
  let max = depth.get(nodeId) ?? 0;
  const stack = [nodeId];
  const seen = new Set(visited);
  seen.add(nodeId);

  while (stack.length > 0) {
    const current = stack.pop()!;
    const d = depth.get(current) ?? 0;
    if (d > max) max = d;

    const outgoing = adjacency.get(current) ?? [];
    for (const e of outgoing) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }

  return max;
}

// ---------------------------------------------------------------------------
// Column assignment
// ---------------------------------------------------------------------------

/**
 * Assigns columns to branches.
 *
 * Layout: [forward branches ... ] [spine] [backward edges ...]
 * Forward branches are left of spine (deepest closest to spine).
 * Backward edges are right of spine.
 * Columns are allocated from a pool and freed after the branch's last node.
 */
function assignColumns(branches: BranchTree[]): { spineColumn: number; totalColumns: number } {
  const leftPool = new ColumnPool();

  // Assign forward branch columns (left of spine, closest = deepest)
  // Sort shallowest first so they get low column numbers (far from spine).
  // Deepest branches are assigned last and get high column numbers (close to spine).
  function assignForwardColumns(branches: readonly BranchTree[]): void {
    const sorted = [...branches].sort((a, b) => a.maxLeafDepth - b.maxLeafDepth);

    for (const branch of sorted) {
      // Allocate sub-branches first (further from spine), then this branch (closer)
      if (branch.subBranches.length > 0) {
        assignForwardColumns(branch.subBranches);
      }

      const col = leftPool.acquire();
      (branch as { column?: number }).column = col;

      // Release column if the branch merges back (it won't need the column past the merge).
      if (branch.mergeEdge) {
        leftPool.release(col);
      }
    }
  }

  assignForwardColumns(branches);

  const forwardColumnCount = leftPool.maxUsed;
  const spineColumn = forwardColumnCount;

  // Assign backward edge columns (right of spine)
  let nextRightColumn = spineColumn + 1;
  function assignBackwardColumns(branches: readonly BranchTree[]): void {
    for (const branch of branches) {
      if (branch.backwardEdge) {
        (branch as { backwardColumn?: number }).backwardColumn = nextRightColumn;
        nextRightColumn++;
      }
      assignBackwardColumns(branch.subBranches);
    }
  }

  assignBackwardColumns(branches);

  const totalColumns = nextRightColumn;

  return { spineColumn, totalColumns };
}

/** Simple column pool that tracks which columns are in use. */
class ColumnPool {
  private inUse = new Set<number>();
  private _maxUsed = 0;

  get maxUsed(): number {
    return this._maxUsed;
  }

  acquire(): number {
    // Find the lowest-numbered free column
    for (let col = 0; col < this._maxUsed; col++) {
      if (!this.inUse.has(col)) {
        this.inUse.add(col);
        return col;
      }
    }
    // No free columns, allocate a new one
    const col = this._maxUsed;
    this._maxUsed++;
    this.inUse.add(col);
    return col;
  }

  release(col: number): void {
    this.inUse.delete(col);
  }
}

// ---------------------------------------------------------------------------
// Place branch nodes and edges into layout
// ---------------------------------------------------------------------------

function placeBranches(
  branches: readonly BranchTree[],
  depth: Map<string, number>,
  layoutNodes: LayoutNode[],
  layoutEdges: LayoutEdge[],
): void {
  for (const branch of branches) {
    const col = (branch as unknown as { column: number }).column;

    // Place trunk nodes (skip the fork node — it's already placed by the parent)
    for (const edge of branch.edges) {
      const existing = layoutNodes.find((n) => n.id === edge.to);
      if (!existing) {
        layoutNodes.push({ id: edge.to, depth: depth.get(edge.to) ?? 0, column: col });
      }

      layoutEdges.push({ from: edge.from, to: edge.to, column: col, direction: 'forward', edge });
    }

    // Place backward edge (rollback — right of spine)
    if (branch.backwardEdge) {
      const backCol = (branch as unknown as { backwardColumn: number }).backwardColumn;
      layoutEdges.push({
        from: branch.backwardEdge.from,
        to: branch.backwardEdge.to,
        column: backCol,
        direction: 'backward',
        edge: branch.backwardEdge,
      });
    }

    // Place merge edge (diamond — forward from branch column to target's column)
    if (branch.mergeEdge) {
      layoutEdges.push({
        from: branch.mergeEdge.from,
        to: branch.mergeEdge.to,
        column: col,
        direction: 'merge',
        edge: branch.mergeEdge,
      });
    }

    // Recurse into sub-branches
    placeBranches(branch.subBranches, depth, layoutNodes, layoutEdges);
  }
}
