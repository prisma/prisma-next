// ---------------------------------------------------------------------------
// Generic graph renderer types — domain-agnostic
// ---------------------------------------------------------------------------

/** A typed marker attached to a node. Different marker kinds get different visual treatment. */
export type NodeMarker =
  | { readonly kind: 'db' }
  | { readonly kind: 'ref'; readonly name: string; readonly active?: boolean }
  | { readonly kind: 'contract'; readonly planned: boolean }
  | { readonly kind: 'custom'; readonly label: string };

/** A node in the graph. Rendered as ○ with optional typed markers. */
export interface GraphNode {
  readonly id: string;
  /** Typed markers rendered inline on the node row */
  readonly markers?: readonly NodeMarker[] | undefined;
  /** Detached nodes use a dashed connector (e.g. unplanned contract) */
  readonly style?: 'normal' | 'detached' | undefined;
}

/** A directed edge between two nodes. Carries an optional label rendered on the edge line. */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
  /** Edge line text, e.g. "20260101_init  ✓  abc12.." */
  readonly label?: string;
  /**
   * Visual color hint for the edge. Overrides the default role-based
   * coloring (spine/branch/backward) when set.
   *
   * - `'applied'` — cyan (CVD-safe: completed/done)
   * - `'pending'` — yellow (CVD-safe: waiting/upcoming)
   * - `'unreachable'` — magenta (CVD-safe: DB on a different branch)
   */
  readonly colorHint?: 'applied' | 'pending' | 'unreachable';
}

/**
 * Immutable directed graph with adjacency-list indexing.
 *
 * Built once from flat arrays of nodes and edges, then passed around as
 * the primary graph representation for rendering, traversal, truncation,
 * and subgraph extraction.
 */
export class RenderGraph {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];

  /** Forward adjacency: node id → outgoing edges. */
  readonly forward: ReadonlyMap<string, readonly GraphEdge[]>;
  /** Set of node ids that have at least one incoming edge. */
  readonly incomingNodes: ReadonlySet<string>;
  /** Node lookup by id. */
  readonly nodeById: ReadonlyMap<string, GraphNode>;

  constructor(nodes: readonly GraphNode[], edges: readonly GraphEdge[]) {
    this.nodes = nodes;
    this.edges = edges;

    const fwd = new Map<string, GraphEdge[]>();
    const inc = new Set<string>();
    const byId = new Map<string, GraphNode>();

    for (const n of nodes) {
      byId.set(n.id, n);
    }
    for (const e of edges) {
      const list = fwd.get(e.from);
      if (list) list.push(e);
      else fwd.set(e.from, [e]);
      inc.add(e.to);
    }

    this.forward = fwd;
    this.incomingNodes = inc;
    this.nodeById = byId;
  }

  /** Outgoing edges from a node (empty array if none). */
  outgoing(nodeId: string): readonly GraphEdge[] {
    return this.forward.get(nodeId) ?? [];
  }
}

/** Options controlling graph rendering. */
export interface GraphRenderOptions {
  /** Node id for the spine endpoint */
  readonly spineTarget: string;
  /** Root node id. Defaults to the node with no incoming edges. */
  readonly rootId?: string;
  /** Enable ANSI colour output */
  readonly colorize?: boolean;
  /** Terminal width. Default 80. */
  readonly maxWidth?: number;
  /**
   * Truncate to show at most this many spine edges. `undefined` = no truncation.
   * The effective limit expands to include any DB or contract markers on the spine.
   */
  readonly limit?: number | undefined;
  /**
   * Override dagre layout parameters. Merged over defaults:
   * `{ ranksep: 4, nodesep: 6, marginx: 2, marginy: 1 }`.
   *
   * When `ranksep` is ≤ 1, labels are placed inline on the arrowhead row
   * instead of in a separate label-placement pass (there isn't enough
   * vertical space for a dedicated label row).
   */
  readonly dagreOptions?: {
    readonly ranksep?: number;
    readonly nodesep?: number;
    readonly marginx?: number;
    readonly marginy?: number;
  };
}
