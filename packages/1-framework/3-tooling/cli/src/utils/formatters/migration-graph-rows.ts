import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import type { MigrationGraph } from '@prisma-next/migration-tools/graph';
import {
  classifyMigrationGraphTopology,
  type MigrationEdgeKind,
  type MigrationListGraphTopology,
} from './migration-list-graph-topology';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A migration edge with its forward/rollback/self classification resolved.
 * `from` and `to` are contract hashes (EMPTY_CONTRACT_HASH for the baseline).
 */
export interface ClassifiedEdge {
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
  readonly dirName: string;
  readonly kind: MigrationEdgeKind;
}

/**
 * The pure-data output of the row-model stage.
 *
 * `nodes` is the vertical ordering of contract nodes: index 0 is the topmost
 * row (the tip), the last non-null entry is the bottommost root. `null`
 * sentinels separate disjoint components (the blank row in the rendered
 * output). Ordering within each component is deterministic: DFS post-order
 * from forward roots, with dirName-descending neighbour order as the tie-
 * break — the same order the Tier-2 topology pass uses.
 *
 * `edges` carries every classified migration. `edgesByFrom` and `edgesByTo`
 * are pre-built lookup maps for the column allocator.
 */
export interface MigrationGraphRowModel {
  readonly nodes: readonly (string | null)[];
  readonly edges: readonly ClassifiedEdge[];
  readonly edgesByFrom: ReadonlyMap<string, readonly ClassifiedEdge[]>;
  readonly edgesByTo: ReadonlyMap<string, readonly ClassifiedEdge[]>;
}

export interface BuildMigrationGraphRowsOptions {
  readonly contractHash?: string;
}

// ---------------------------------------------------------------------------
// Weak connectivity — identify disjoint components
// ---------------------------------------------------------------------------

/**
 * Return the weakly-connected components of `graph` as an array of node sets,
 * ordered so the component containing EMPTY_CONTRACT_HASH comes first (if
 * present), with remaining components sorted by their lex-smallest node hash.
 */
function weaklyConnectedComponents(graph: MigrationGraph): readonly ReadonlySet<string>[] {
  const visited = new Set<string>();
  const adjacency = new Map<string, string[]>();

  function addAdjacent(a: string, b: string): void {
    const aList = adjacency.get(a);
    if (aList) aList.push(b);
    else adjacency.set(a, [b]);
    const bList = adjacency.get(b);
    if (bList) bList.push(a);
    else adjacency.set(b, [a]);
  }

  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      if (edge.from !== edge.to) {
        addAdjacent(edge.from, edge.to);
      }
    }
  }

  // Ensure all nodes (including isolated self-loops) are reachable
  for (const node of graph.nodes) {
    if (!adjacency.has(node)) {
      adjacency.set(node, []);
    }
  }

  const components: Set<string>[] = [];

  function bfsComponent(start: string): Set<string> {
    const component = new Set<string>();
    const queue = [start];
    while (queue.length > 0) {
      const node = queue.shift();
      if (node === undefined || visited.has(node)) continue;
      visited.add(node);
      component.add(node);
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!visited.has(neighbor)) {
          queue.push(neighbor);
        }
      }
    }
    return component;
  }

  // Deterministic: visit nodes in a fixed order (EMPTY first, then lex)
  const allNodes = [...graph.nodes].sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });

  for (const node of allNodes) {
    if (!visited.has(node)) {
      components.push(bfsComponent(node));
    }
  }

  // Order: EMPTY component first, others by lex-smallest node hash
  components.sort((a, b) => {
    const aHasEmpty = a.has(EMPTY_CONTRACT_HASH);
    const bHasEmpty = b.has(EMPTY_CONTRACT_HASH);
    if (aHasEmpty && !bHasEmpty) return -1;
    if (!aHasEmpty && bHasEmpty) return 1;
    const aMin = [...a].sort((x, y) => x.localeCompare(y))[0] ?? '';
    const bMin = [...b].sort((x, y) => x.localeCompare(y))[0] ?? '';
    return aMin.localeCompare(bMin);
  });

  return components;
}

// ---------------------------------------------------------------------------
// Post-order DFS node ordering within a component
// ---------------------------------------------------------------------------

/**
 * DFS post-order traversal over FORWARD edges only, starting from the
 * forward-root nodes within `componentNodes`. Returns nodes tip-first
 * (index 0 = tip, last = root), matching the display orientation.
 *
 * Neighbour traversal order: outgoing forward edges sorted by dirName
 * descending — the same tie-break used by the topology classifier. This
 * ensures the node ordering is stable across runs and consistent with Tier-2.
 */
function postOrderNodes(
  componentNodes: ReadonlySet<string>,
  topology: MigrationListGraphTopology,
  graph: MigrationGraph,
): readonly string[] {
  // Build forward-only adjacency for this component
  const forwardOut = new Map<string, { to: string; dirName: string }[]>();

  for (const node of componentNodes) {
    forwardOut.set(node, []);
  }

  for (const edges of graph.forwardChain.values()) {
    for (const edge of edges) {
      if (!componentNodes.has(edge.from) || !componentNodes.has(edge.to)) continue;
      if (edge.from === edge.to) continue; // self-edges don't affect node order
      if (topology.kindByMigrationHash.get(edge.migrationHash) !== 'forward') continue;
      const bucket = forwardOut.get(edge.from);
      if (bucket) bucket.push({ to: edge.to, dirName: edge.dirName });
    }
  }

  // Sort outgoing edges: dirName descending (same as topology classifier)
  for (const bucket of forwardOut.values()) {
    bucket.sort((a, b) => b.dirName.localeCompare(a.dirName));
  }

  // Forward roots: nodes with forward in-degree 0 within this component
  const roots: string[] = [];
  for (const node of componentNodes) {
    const inDeg = topology.forwardInDegree.get(node) ?? 0;
    if (inDeg === 0) {
      roots.push(node);
    }
  }
  roots.sort((a, b) => {
    if (a === EMPTY_CONTRACT_HASH) return -1;
    if (b === EMPTY_CONTRACT_HASH) return 1;
    return a.localeCompare(b);
  });

  // Fallback for pure cycles: all nodes have forward in-degree > 0
  if (roots.length === 0) {
    roots.push(
      ...[...componentNodes].sort((a, b) => {
        if (a === EMPTY_CONTRACT_HASH) return -1;
        if (b === EMPTY_CONTRACT_HASH) return 1;
        return a.localeCompare(b);
      }),
    );
  }

  // Iterative DFS with post-order collection
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of componentNodes) {
    color.set(node, WHITE);
  }

  interface Frame {
    node: string;
    outgoing: readonly { to: string; dirName: string }[];
    index: number;
  }

  const stack: Frame[] = [];
  const postOrder: string[] = [];

  function pushFrame(node: string): void {
    color.set(node, GRAY);
    stack.push({ node, outgoing: forwardOut.get(node) ?? [], index: 0 });
  }

  function runDfsFrom(root: string): void {
    if (color.get(root) !== WHITE) return;
    pushFrame(root);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;

      if (frame.index >= frame.outgoing.length) {
        color.set(frame.node, BLACK);
        postOrder.push(frame.node);
        stack.pop();
        continue;
      }

      const { to } = frame.outgoing[frame.index] ?? { to: '' };
      frame.index += 1;
      if (!to) continue;

      const vColor = color.get(to);
      if (vColor === WHITE) {
        pushFrame(to);
      }
      // GRAY/BLACK nodes are already scheduled or done; skip to avoid revisiting
    }
  }

  for (const root of roots) {
    runDfsFrom(root);
  }

  // Any remaining WHITE nodes (unreachable via forward edges — e.g. nodes that
  // only appear as rollback sources) get appended in lex order
  const remainingWhite = [...componentNodes]
    .filter((n) => color.get(n) === WHITE)
    .sort((a, b) => a.localeCompare(b));
  for (const root of remainingWhite) {
    runDfsFrom(root);
  }

  // DFS post-order: nodes are pushed when their subtree is exhausted.
  // For a forward chain root → A → B, B is pushed first (tip), root last.
  // This is already tips-first, which is the display orientation we want.
  return postOrder;
}

// ---------------------------------------------------------------------------
// Public builder
// ---------------------------------------------------------------------------

/**
 * Build the row model from a tolerant `MigrationGraph`.
 *
 * The row model is the first pure-data stage of the `migration graph` render
 * pipeline. It:
 * - classifies every edge as `forward`, `rollback`, or `self`;
 * - produces a deterministic vertical node ordering (tips at index 0, roots
 *   at the end) within each weakly-connected component;
 * - separates disjoint components with `null` sentinels;
 * - optionally prepends a detached current contract as its own single-node
 *   component when `contractHash` is not already in the graph.
 *
 * No columns, no lane allocation, no glyphs, no rendering.
 */
/**
 * Resolve the detached current contract, if any: a real contract (not the
 * empty baseline) that no migration on disk produces, so it is absent from
 * the graph. Such a contract renders as a floating node rather than
 * decorating an existing one. Returns the hash when detached, else undefined.
 */
function detachedContractHash(
  graph: MigrationGraph,
  contractHash: string | undefined,
): string | undefined {
  return contractHash !== undefined &&
    contractHash !== EMPTY_CONTRACT_HASH &&
    !graph.nodes.has(contractHash)
    ? contractHash
    : undefined;
}

export function buildMigrationGraphRows(
  graph: MigrationGraph,
  options: BuildMigrationGraphRowsOptions = {},
): MigrationGraphRowModel {
  const emptyModel: MigrationGraphRowModel = {
    nodes: [],
    edges: [],
    edgesByFrom: new Map(),
    edgesByTo: new Map(),
  };

  if (graph.nodes.size === 0) {
    const detached = detachedContractHash(graph, options.contractHash);
    return detached !== undefined ? { ...emptyModel, nodes: [detached] } : emptyModel;
  }

  // 1. Classify all edges (shared DFS, same algorithm as Tier-2)
  const topology = classifyMigrationGraphTopology(graph);

  // 2. Build classified edge list
  const edges: ClassifiedEdge[] = [];
  const edgesByFrom = new Map<string, ClassifiedEdge[]>();
  const edgesByTo = new Map<string, ClassifiedEdge[]>();

  for (const edgeList of graph.forwardChain.values()) {
    for (const edge of edgeList) {
      const kind = topology.kindByMigrationHash.get(edge.migrationHash) ?? 'forward';
      const classified: ClassifiedEdge = {
        migrationHash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
        dirName: edge.dirName,
        kind,
      };
      edges.push(classified);

      const fromBucket = edgesByFrom.get(edge.from);
      if (fromBucket) fromBucket.push(classified);
      else edgesByFrom.set(edge.from, [classified]);

      const toBucket = edgesByTo.get(edge.to);
      if (toBucket) toBucket.push(classified);
      else edgesByTo.set(edge.to, [classified]);
    }
  }

  // 3. Find weakly-connected components (ordered: EMPTY first, then lex)
  const components = weaklyConnectedComponents(graph);

  // 4. Compute post-order node sequence for each component, separate with null
  const nodes: (string | null)[] = [];
  for (let i = 0; i < components.length; i++) {
    if (i > 0) nodes.push(null);
    const component = components[i];
    if (component === undefined) continue;
    const ordered = postOrderNodes(component, topology, graph);
    for (const node of ordered) {
      nodes.push(node);
    }
  }

  const detached = detachedContractHash(graph, options.contractHash);
  if (detached !== undefined) {
    if (nodes.length > 0) {
      nodes.unshift(null);
    }
    nodes.unshift(detached);
  }

  return { nodes, edges, edgesByFrom, edgesByTo };
}
