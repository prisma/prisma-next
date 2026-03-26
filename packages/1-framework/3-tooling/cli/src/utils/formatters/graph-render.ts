/**
 * Terminal graph renderer.
 *
 * Renders directed graphs as ASCII/box-drawing art for terminal output. Uses
 * dagre for automatic layout (rank assignment + coordinate placement), then
 * stamps the result onto a {@link CharGrid} — a sparse character canvas that
 * resolves box-drawing junctions, color priority, and label placement.
 *
 * ## Rendering pipeline
 *
 * 1. **Layout** — dagre assigns (x, y) coordinates to nodes and polyline
 *    control points to edges. We use `rankdir: 'TB'` (top-to-bottom).
 * 2. **Orthogonalization** — dagre's polylines may contain diagonal segments.
 *    {@link selectBestVariant} resolves each diagonal into an L-shaped bend,
 *    enumerating all 2^N combinations and picking the variant with fewest
 *    corners and shortest total length.
 * 3. **Edge stamping** — orthogonal segments are stamped onto the CharGrid as
 *    directional bitmasks. The grid resolves overlapping directions into the
 *    correct box-drawing character (│, ─, ┌, ┼, etc.).
 * 4. **Label placement** — edge labels are placed adjacent to their polyline
 *    segments, preferring horizontal (branch-specific) segments over shared
 *    vertical trunks to avoid ambiguity.
 * 5. **Arrowheads** — ▾ ▴ ◂ ▸ placed one cell before the terminal point.
 * 6. **Node stamping** — `○ nodeId` with inline marker tags (db, contract,
 *    ref names).
 * 7. **Elided indicator** — when truncation is active, `┊ (N earlier
 *    migrations)` is stamped above the visible root.
 * 8. **Detached nodes** — rendered below the graph with `◇` and a dotted
 *    connector.
 *
 * ## Graph filtering
 *
 * The caller controls what graph is rendered: the full graph, or a subgraph
 * extracted via {@link extractRelevantSubgraph} (union of relevant paths).
 * The renderer itself is agnostic — it renders whatever graph it receives.
 *
 * Truncation is supported via `options.limit`.
 *
 * ## Color accessibility
 *
 * Uses a CVD-safe palette — no red/green contrast. Shape and icon always
 * carry meaning; color only reinforces.
 */
import dagre from '@dagrejs/dagre';
import { bold, cyan, dim, magenta, yellow } from 'colorette';
import {
  type GraphEdge,
  type GraphNode,
  type GraphRenderOptions,
  type NodeMarker,
  RenderGraph,
} from './graph-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A 2D point on the character grid (integer coordinates). */
interface Point {
  x: number;
  y: number;
}

/** An orthogonal line segment between two points on the character grid. */
interface Segment {
  readonly from: Point;
  readonly to: Point;
}

function segment(from: Point, to: Point): Segment {
  return { from, to };
}

function isVertical(seg: Segment): boolean {
  return seg.from.x === seg.to.x;
}

function manhattanLength(seg: Segment): number {
  return Math.abs(seg.to.x - seg.from.x) + Math.abs(seg.to.y - seg.from.y);
}

/** A function that wraps a string with an ANSI color escape sequence. */
type ColorFn = (s: string) => string;

// ---------------------------------------------------------------------------
// CVD-safe color palette
//
// No red/green contrast. Shape/icon always carries meaning; color reinforces.
// ---------------------------------------------------------------------------

/** Color functions for each semantic role in the graph. */
interface GraphColors {
  spine: ColorFn;
  branch: ColorFn;
  backward: ColorFn;
  applied: ColorFn;
  pending: ColorFn;
  diverged: ColorFn;
  node: ColorFn;
  label: ColorFn;
  marker: ColorFn;
  /** Rotating color for ref markers — cycles through the palette by index. */
  ref: (index: number) => ColorFn;
}

/** Rotating palette for ref marker names, cycling through these for each ref. */
const REF_COLORS: ColorFn[] = [yellow, magenta, bold, cyan];

/** Build the color palette, respecting the `colorize` flag. When false, all color functions become identity. */
function buildColors(colorize: boolean): GraphColors {
  const c = (fn: ColorFn): ColorFn => (colorize ? fn : (s) => s);
  return {
    spine: c(cyan),
    branch: c(dim),
    backward: c(magenta),
    applied: c(cyan),
    pending: c(yellow),
    diverged: c(magenta),
    node: c(cyan),
    label: c(dim),
    marker: c(bold),
    ref: (index: number) => c(REF_COLORS[index % REF_COLORS.length]!),
  };
}

/** Map a `colorHint` value to its color function, or `undefined` for no hint. */
function resolveHintColor(hint: GraphEdge['colorHint'], colors: GraphColors): ColorFn | undefined {
  if (hint === 'applied') return colors.applied;
  if (hint === 'pending') return colors.pending;
  if (hint === 'diverged') return colors.diverged;
  return undefined;
}

/**
 * Edge drawing priorities — higher priority wins when edges overlap on the
 * same grid cell. Backward edges are drawn on top so rollback paths remain
 * visible over spine and branch edges.
 */
const PRIORITY = {
  branch: 1,
  spine: 2,
  backward: 3,
} as const;

// ---------------------------------------------------------------------------
// Direction bitmask → box-drawing character
//
// Each grid cell accumulates a bitmask of connected directions (UP, DOWN,
// LEFT, RIGHT). The bitmask is then mapped to the appropriate Unicode
// box-drawing character. For example, UP|RIGHT → └, all four → ┼.
// ---------------------------------------------------------------------------

const DIR = {
  up: 1,
  down: 2,
  left: 4,
  right: 8,
} as const;

/** Arrow characters for edge termination (one cell before the target node). */
const ARROW = { up: '▴', down: '▾', left: '◂', right: '▸' };

/** Maps a direction bitmask to its box-drawing character. */
const BOX_CHAR: Record<number, string> = {
  0: ' ',
  [DIR.up]: '│',
  [DIR.down]: '│',
  [DIR.up | DIR.down]: '│',
  [DIR.left]: '─',
  [DIR.right]: '─',
  [DIR.left | DIR.right]: '─',
  [DIR.down | DIR.right]: '┌',
  [DIR.down | DIR.left]: '┐',
  [DIR.up | DIR.right]: '└',
  [DIR.up | DIR.left]: '┘',
  [DIR.up | DIR.down | DIR.right]: '├',
  [DIR.up | DIR.down | DIR.left]: '┤',
  [DIR.left | DIR.right | DIR.down]: '┬',
  [DIR.left | DIR.right | DIR.up]: '┴',
  [DIR.up | DIR.down | DIR.left | DIR.right]: '┼',
};

// ---------------------------------------------------------------------------
// Inline marker tags
//
// Markers (db, contract, ref, custom) are rendered inline after the node id:
//   ○ abc1234 ◆ db prod
// ---------------------------------------------------------------------------

/** A single rendered tag: the display text and the color function to apply. */
interface InlineTag {
  text: string;
  color: ColorFn;
}

/**
 * Convert a node's markers into renderable inline tags.
 *
 * - `db` → `◆ db`
 * - `contract` → `◆ contract` (applied) or `◇ contract` (planned)
 * - `ref` → the ref name, colored from the rotating {@link REF_COLORS} palette
 * - `custom` → the custom label
 */
function buildInlineTags(markers: readonly NodeMarker[], colors: GraphColors): InlineTag[] {
  const tags: InlineTag[] = [];
  const refNames = markers
    .filter((m): m is NodeMarker & { kind: 'ref' } => m.kind === 'ref')
    .map((m) => m.name);

  for (const m of markers) {
    if (m.kind === 'db') {
      tags.push({ text: '◆ db', color: colors.marker });
    } else if (m.kind === 'contract') {
      tags.push({ text: m.planned ? '◆ contract' : '◇ contract', color: colors.marker });
    } else if (m.kind === 'ref') {
      tags.push({ text: m.name, color: colors.ref(refNames.indexOf(m.name)) });
    } else if (m.kind === 'custom') {
      tags.push({ text: m.label, color: colors.marker });
    }
  }
  return tags;
}

/** Total character width of inline tags including leading spaces (0 if no tags). */
function inlineTagsWidth(tags: InlineTag[]): number {
  if (tags.length === 0) return 0;
  return tags.reduce((w, t) => w + 1 + t.text.length, 0);
}

// ---------------------------------------------------------------------------
// Character grid with color priority
//
// The grid is the central rendering canvas. It supports two layers:
//
// 1. **Connections** — direction bitmasks at (x, y) cells, resolved to
//    box-drawing characters at render time. When multiple edges cross the
//    same cell, their direction bits are OR'd together (e.g. UP|RIGHT → └).
//    Color follows a priority system so higher-priority edges (backward >
//    spine > branch) visually dominate at intersections.
//
// 2. **Text stamps** — literal characters placed at (x, y), such as node
//    ids, labels, arrowheads, and markers. Text stamps override connections
//    at the same position.
//
// The grid also tracks **reserved areas** (node label regions) so that
// label-placement heuristics can avoid overlapping node text.
// ---------------------------------------------------------------------------

/** Tracks the winning color for a grid cell based on edge priority. */
interface CellColor {
  color: ColorFn | undefined;
  priority: number;
}

/**
 * Sparse character canvas for terminal graph rendering.
 *
 * Coordinates are unbounded integers — the grid auto-expands as content is
 * added and trims to the bounding box on {@link render}.
 */
class CharGrid {
  private connections = new Map<string, number>();
  private cellColors = new Map<string, CellColor>();
  private chars = new Map<string, { ch: string; color: ColorFn | undefined }>();
  private reserved = new Set<string>();
  private minX = Number.POSITIVE_INFINITY;
  private maxX = Number.NEGATIVE_INFINITY;
  private minY = Number.POSITIVE_INFINITY;
  private maxY = Number.NEGATIVE_INFINITY;

  private key(x: number, y: number): string {
    return `${x},${y}`;
  }

  /** Expand the bounding box to include (x, y). */
  private touch(x: number, y: number): void {
    if (x < this.minX) this.minX = x;
    if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y;
    if (y > this.maxY) this.maxY = y;
  }

  /**
   * Add a directional connection at (x, y). Multiple calls at the same cell
   * are OR'd together — e.g. `addConnection(x, y, UP)` then
   * `addConnection(x, y, RIGHT)` produces a └ corner. Color follows
   * priority: higher-priority edges win at shared cells.
   */
  addConnection(
    x: number,
    y: number,
    dir: number,
    color?: ColorFn,
    priority: number = PRIORITY.branch,
  ): void {
    this.touch(x, y);
    const k = this.key(x, y);
    this.connections.set(k, (this.connections.get(k) ?? 0) | dir);
    const existing = this.cellColors.get(k);
    if (!existing || priority >= existing.priority) {
      this.cellColors.set(k, { color, priority });
    }
  }

  /** Stamp a horizontal edge segment from x1 to x2 at row y. */
  markHorizontal(y: number, x1: number, x2: number, color?: ColorFn, priority?: number): void {
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    if (lo === hi) return;
    this.addConnection(lo, y, DIR.right, color, priority);
    for (let x = lo + 1; x < hi; x++)
      this.addConnection(x, y, DIR.left | DIR.right, color, priority);
    this.addConnection(hi, y, DIR.left, color, priority);
  }

  /** Stamp a vertical edge segment from y1 to y2 at column x. */
  markVertical(x: number, y1: number, y2: number, color?: ColorFn, priority?: number): void {
    const lo = Math.min(y1, y2);
    const hi = Math.max(y1, y2);
    if (lo === hi) return;
    this.addConnection(x, lo, DIR.down, color, priority);
    for (let y = lo + 1; y < hi; y++) this.addConnection(x, y, DIR.up | DIR.down, color, priority);
    this.addConnection(x, hi, DIR.up, color, priority);
  }

  /** Place literal text at (x, y). Each character occupies one cell. Text stamps override connections. */
  stampText(x: number, y: number, text: string, color?: ColorFn): void {
    for (let i = 0; i < text.length; i++) {
      const cx = x + i;
      this.touch(cx, y);
      this.chars.set(this.key(cx, y), { ch: text[i]!, color });
    }
  }

  /** True if (x, y) has stamped text or is in a reserved area (node labels). */
  hasLabel(x: number, y: number): boolean {
    return this.chars.has(this.key(x, y)) || this.reserved.has(this.key(x, y));
  }

  /** True if (x, y) has any directional connection (an edge passes through). */
  hasConnection(x: number, y: number): boolean {
    return (this.connections.get(this.key(x, y)) ?? 0) !== 0;
  }

  /** True if (x, y) has stamped text (not just a reserved area). */
  hasText(x: number, y: number): boolean {
    return this.chars.has(this.key(x, y));
  }

  /** Reserve a horizontal span so label placement avoids it. Used for node id + marker regions. */
  reserveArea(x: number, y: number, width: number): void {
    for (let i = 0; i < width; i++) this.reserved.add(this.key(x + i, y));
  }

  /** The largest y coordinate with content — used for positioning detached nodes below the graph. */
  getMaxY(): number {
    return this.maxY;
  }

  /**
   * Render the grid to a multi-line string.
   *
   * Iterates row by row over the bounding box, resolving each cell to either
   * its stamped text character or the box-drawing character for its
   * connection bitmask. Consecutive characters with the same color are
   * batched into a single ANSI-wrapped run for efficiency.
   */
  render(): string {
    if (this.minX === Number.POSITIVE_INFINITY) return '(empty)';

    const rows: string[] = [];
    for (let y = this.minY; y <= this.maxY; y++) {
      let row = '';
      let runChars = '';
      let runColor: ColorFn | undefined;

      const flush = () => {
        if (runChars.length === 0) return;
        row += runColor ? runColor(runChars) : runChars;
        runChars = '';
      };

      for (let x = this.minX; x <= this.maxX; x++) {
        const k = this.key(x, y);
        let ch: string;
        let color: ColorFn | undefined;

        const label = this.chars.get(k);
        if (label) {
          ch = label.ch;
          color = label.color;
        } else {
          const conn = this.connections.get(k) ?? 0;
          ch = BOX_CHAR[conn] ?? ' ';
          color = conn === 0 ? undefined : this.cellColors.get(k)?.color;
        }

        if (color !== runColor) {
          flush();
          runColor = color;
        }
        runChars += ch;
      }
      flush();
      rows.push(row.trimEnd());
    }

    while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
    return rows.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Spine detection — BFS shortest path from root to target
//
// The renderer operates on generic GraphNode/GraphEdge, not MigrationGraph,
// so it cannot use domain-specific pathfinding. These two BFS functions
// re-derive the spine from the generic edge list.
// ---------------------------------------------------------------------------

/**
 * Find the set of edge keys (`"from→to"`) on the shortest path from
 * `rootId` to `targetId`. Used to color spine edges distinctly from
 * branch edges in the rendered output.
 *
 * Returns an empty set if no path exists.
 */
function findSpineEdges(graph: RenderGraph, rootId: string, targetId: string): Set<string> {
  const visited = new Set([rootId]);
  const parent = new Map<string, GraphEdge>();
  const queue = [rootId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      const spineEdges = new Set<string>();
      let node = targetId;
      while (parent.has(node)) {
        const edge = parent.get(node)!;
        spineEdges.add(`${edge.from}→${edge.to}`);
        node = edge.from;
      }
      return spineEdges;
    }
    for (const edge of graph.outgoing(current)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        parent.set(edge.to, edge);
        queue.push(edge.to);
      }
    }
  }
  return new Set();
}

// ---------------------------------------------------------------------------
// Orthogonal polyline builder — variant-based
//
// Dagre produces polyline control points that may contain diagonal segments
// (two consecutive points that differ in both x and y). Terminal rendering
// requires strictly orthogonal segments (horizontal or vertical only).
//
// To resolve diagonals, we insert an L-shaped bend at each one. Each diagonal
// has two possible resolutions (horizontal-first or vertical-first), so N
// diagonals produce 2^N candidate polylines. We enumerate all variants and
// pick the one with the fewest corners and shortest total length.
// ---------------------------------------------------------------------------

/**
 * Prepend `src` and append `tgt` to dagre's control points, round to
 * integers, and deduplicate consecutive identical points.
 */
function prepareRawPoints(src: Point, dagrePoints: Point[], tgt: Point): Point[] {
  const raw = [src, ...dagrePoints, tgt];
  const rounded = raw.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
  const deduped: Point[] = [rounded[0]!];
  for (let i = 1; i < rounded.length; i++) {
    const prev = deduped[deduped.length - 1]!;
    const curr = rounded[i]!;
    if (curr.x !== prev.x || curr.y !== prev.y) deduped.push(curr);
  }
  return deduped;
}

/** Return the indices of points that form a diagonal with their predecessor. */
function findDiagonalIndices(points: Point[]): number[] {
  const indices: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const curr = points[i]!;
    if (prev.x !== curr.x && prev.y !== curr.y) indices.push(i);
  }
  return indices;
}

/**
 * Build one polyline variant by resolving each diagonal with the given choice.
 *
 * For each diagonal index `i`, `choices[i]` selects the resolution:
 * - `0` → horizontal-first: insert `(curr.x, prev.y)` before `curr`
 * - `1` → vertical-first: insert `(prev.x, curr.y)` before `curr`
 *
 * The result is deduplicated to remove any zero-length segments created
 * when an inserted bend coincides with an adjacent point.
 *
 * Choices are {@link BEND.hFirst} or {@link BEND.vFirst}, matching the
 * bit values (0 and 1) used by the enumeration in
 * {@link selectBestVariant}.
 */
const BEND = {
  hFirst: 0,
  vFirst: 1,
} as const;

function buildVariant(points: Point[], diagonalIndices: number[], choices: number[]): Point[] {
  if (points.length < 2) return points;

  const diagonalSet = new Set(diagonalIndices);
  let choiceIdx = 0;

  const result: Point[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1]!;
    const curr = points[i]!;

    if (prev.x === curr.x || prev.y === curr.y) {
      result.push(curr);
    } else if (diagonalSet.has(i)) {
      const choice = choices[choiceIdx++] ?? BEND.hFirst;
      if (choice === BEND.hFirst) {
        result.push({ x: curr.x, y: prev.y });
      } else {
        result.push({ x: prev.x, y: curr.y });
      }
      result.push(curr);
    } else {
      result.push(curr);
    }
  }

  const final: Point[] = [result[0]!];
  for (let i = 1; i < result.length; i++) {
    const prev = final[final.length - 1]!;
    const curr = result[i]!;
    if (curr.x !== prev.x || curr.y !== prev.y) final.push(curr);
  }
  return final;
}

/** Count the number of direction changes (corners) in an orthogonal polyline. */
function countCorners(poly: Point[]): number {
  let corners = 0;
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const c = poly[i + 1]!;
    const d1Vert = a.x === b.x;
    const d2Vert = b.x === c.x;
    if (d1Vert !== d2Vert) corners++;
  }
  return corners;
}

/** Manhattan length of a polyline (sum of absolute x and y deltas). */
function polyLength(poly: Point[]): number {
  let len = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    len += Math.abs(poly[i + 1]!.x - poly[i]!.x) + Math.abs(poly[i + 1]!.y - poly[i]!.y);
  }
  return len;
}

// ---------------------------------------------------------------------------
// Label placement
//
// Edge labels (migration names) are placed adjacent to polyline segments.
// The algorithm generates candidate positions along each segment, scores
// them, and picks the best. Key heuristics:
//
// - **Horizontal segment preference**: when a polyline has both vertical and
//   horizontal segments, horizontal segments are boosted because they
//   uniquely identify a branch, while vertical segments often share column
//   space with the trunk. This prevents labels from "jumping" when node
//   widths change.
// - **Source adjacency penalty**: positions within ±1 row of the source node
//   are penalized — labels there look like they belong to an incoming edge.
// - **Whitespace bonus**: positions with clear space above and below score
//   higher for readability.
// ---------------------------------------------------------------------------

/**
 * Find the best (x, y) position to place an edge label adjacent to its
 * polyline. Returns null if no collision-free position exists.
 *
 * @param poly - The orthogonalized polyline for the edge.
 * @param label - The label text to place.
 * @param grid - The character grid (used for collision checks).
 * @param srcY - Y coordinate of the source node (for adjacency penalty).
 */
function findLabelPlacement(
  poly: Point[],
  label: string,
  grid: CharGrid,
  srcY?: number,
): Point | undefined {
  const segments = polyToSegments(poly);

  let best: (Point & { score: number }) | undefined;

  for (const seg of segments) {
    const candidates = segmentLabelCandidates(seg, label.length);
    for (const pos of candidates) {
      if (labelCollides(grid, pos.x, pos.y, label)) continue;
      const score = scoreLabelCandidate(pos, seg, segments, label, grid, srcY);
      if (!best || score > best.score) best = { x: pos.x, y: pos.y, score };
    }
  }

  return best;
}

/** Convert a polyline into non-zero-length segments. */
function polyToSegments(poly: readonly Point[]): Segment[] {
  const segments: Segment[] = [];
  for (let i = 0; i < poly.length - 1; i++) {
    const seg = segment(poly[i]!, poly[i + 1]!);
    if (manhattanLength(seg) > 0) segments.push(seg);
  }
  return segments;
}

/**
 * Generate all candidate (x, y) positions for placing a label adjacent
 * to a single segment. Positions are perpendicular to the segment:
 *
 * - Vertical segments: left and right, at every y along the segment.
 * - Horizontal segments: above and below, at every x where the label fits.
 */
function segmentLabelCandidates(seg: Segment, labelLen: number): Point[] {
  const candidates: Point[] = [];

  if (isVertical(seg)) {
    const minY = Math.min(seg.from.y, seg.to.y);
    const maxY = Math.max(seg.from.y, seg.to.y);
    for (const x of [seg.from.x + 2, seg.from.x - labelLen - 1]) {
      for (let y = minY; y <= maxY; y++) {
        candidates.push({ x, y });
      }
    }
  } else {
    const minX = Math.min(seg.from.x, seg.to.x);
    const maxX = Math.max(seg.from.x, seg.to.x);
    for (const dy of [-1, 1]) {
      const y = seg.from.y + dy;
      for (let x = minX; x <= maxX - labelLen + 1; x++) {
        candidates.push({ x, y });
      }
    }
  }

  return candidates;
}

/**
 * Score a candidate label position. Higher is better.
 *
 * Combines: segment length, surrounding whitespace, distance from
 * segment midpoint, source-node proximity penalty, and segment-position
 * bonus (horizontal/later segments preferred when the edge has bends).
 *
 * @param pos - Candidate position (top-left corner of the label text).
 * @param seg - The segment this candidate is adjacent to.
 * @param allSegments - All segments of the edge polyline (for segment-position bonus).
 * @param label - The label text (used for width and whitespace probing).
 * @param grid - The character grid (used for whitespace checks).
 * @param srcY - Y coordinate of the edge's source node (penalizes labels
 *   that would appear to belong to the node rather than the edge).
 */
function scoreLabelCandidate(
  pos: Point,
  seg: Segment,
  allSegments: readonly Segment[],
  label: string,
  grid: CharGrid,
  srcY?: number,
): number {
  const len = manhattanLength(seg);
  const midX = Math.round((seg.from.x + seg.to.x) / 2);
  const midY = Math.round((seg.from.y + seg.to.y) / 2);

  let score = len;

  // Whitespace above/below the label improves readability.
  for (let dy = 1; dy <= 2; dy++) {
    if (!rowHasContent(grid, pos.x, pos.y - dy, label.length)) score += 3;
    if (!rowHasContent(grid, pos.x, pos.y + dy, label.length)) score += 3;
  }

  // Prefer positions near the segment midpoint.
  const labelCenterX = pos.x + Math.floor(label.length / 2);
  score -= (Math.abs(labelCenterX - midX) + Math.abs(pos.y - midY)) * 2;

  const labelCenterY = pos.y + Math.floor(label.length / 2);
  score -= (Math.abs(labelCenterY - midY) + Math.abs(pos.x - midX)) * 2;

  // Prefer labels to the right of a vertical segment
  if (isVertical(seg) && pos.x > seg.from.x) {
    score += 10;
  }

  // Penalize positions adjacent to the source node — labels there
  // look like they belong to the incoming edge above.
  if (srcY !== undefined && Math.abs(pos.y - srcY) <= 1) score -= 20;

  // Horizontal segments uniquely identify a branch, while the initial
  // vertical drop from the source often shares column space with the trunk.
  // Boost horizontal and later segments so labels land on the branch.
  const hasHorizontalSeg = allSegments.some((s) => !isVertical(s));
  if (hasHorizontalSeg) {
    if (!isVertical(seg)) score += 15;
    const segIndex = allSegments.indexOf(seg);
    score += (segIndex / allSegments.length) * 5;
  }

  return score;
}

/** True if any cell in the horizontal span [x, x+width) at row y has content. */
function rowHasContent(grid: CharGrid, x: number, y: number, width: number): boolean {
  for (let i = 0; i < width; i++) {
    if (grid.hasLabel(x + i, y) || grid.hasConnection(x + i, y)) return true;
  }
  return false;
}

/**
 * Check if placing `text` at (x, y) would collide with existing content.
 * Checks one cell of padding on each side to keep labels visually separated.
 */
function labelCollides(grid: CharGrid, x: number, y: number, text: string): boolean {
  for (let i = -1; i <= text.length; i++) {
    const cx = x + i;
    if (grid.hasLabel(cx, y)) return true;
    if (i >= 0 && i < text.length && grid.hasConnection(cx, y)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Joint variant selection
//
// Combines diagonal resolution with label placement in a single pass. For
// each of the 2^N polyline variants, we compute a score based on corner
// count, total length, and whether the label can be placed. The variant
// with the lowest score wins.
// ---------------------------------------------------------------------------

/** A resolved polyline paired with its best label position (if any). */
interface PolyWithLabel {
  poly: Point[];
  labelPos: Point | undefined;
}

/**
 * Resolve dagre's polyline into the best orthogonal variant and find the
 * optimal label position in a single pass.
 *
 * Enumerates all 2^N diagonal resolutions, scores each by:
 * - `corners * 10` — fewer corners preferred
 * - `+ manhattan length` — shorter paths preferred
 * - `+ 100` penalty if the label couldn't be placed
 *
 * For edges with no diagonals, the polyline is used as-is.
 */
function selectBestVariant(
  src: Point,
  dagrePoints: Point[],
  tgt: Point,
  label: string | undefined,
  grid: CharGrid,
): PolyWithLabel {
  const rawPoints = prepareRawPoints(src, dagrePoints, tgt);
  const diags = findDiagonalIndices(rawPoints);

  if (diags.length === 0) {
    const poly = buildVariant(rawPoints, [], []);
    const labelPos = label ? findLabelPlacement(poly, label, grid, src.y) : undefined;
    return { poly, labelPos };
  }

  const numVariants = 1 << diags.length;
  let bestPoly: Point[] | null = null;
  let bestLabel: Point | undefined;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let bits = 0; bits < numVariants; bits++) {
    const choices = diags.map((_, k) => (bits >> k) & 1);
    const poly = buildVariant(rawPoints, diags, choices);

    const corners = countCorners(poly);
    const len = polyLength(poly);
    const labelPos = label ? findLabelPlacement(poly, label, grid, src.y) : undefined;

    const labelPenalty = label && !labelPos ? 100 : 0;
    const score = corners * 10 + len + labelPenalty;

    if (score < bestScore) {
      bestScore = score;
      bestPoly = poly;
      bestLabel = labelPos;
    }
  }

  return {
    poly:
      bestPoly ??
      buildVariant(
        rawPoints,
        diags,
        diags.map(() => 0),
      ),
    labelPos: bestLabel,
  };
}

// ---------------------------------------------------------------------------
// Subgraph extraction
// ---------------------------------------------------------------------------

/**
 * Extract the subgraph containing only the nodes and forward-moving edges
 * along the given path.
 *
 * Backward (rollback) edges are excluded even if both endpoints are on the
 * path — only edges where `from` precedes `to` in path order are kept.
 */
export function extractSubgraph(graph: RenderGraph, path: readonly string[]): RenderGraph {
  const pathIndex = new Map(path.map((id, i) => [id, i]));
  const filteredNodes = graph.nodes.filter((n) => pathIndex.has(n.id) || n.style === 'detached');
  const filteredEdges = graph.edges.filter((e) => {
    const fromIdx = pathIndex.get(e.from);
    const toIdx = pathIndex.get(e.to);
    return fromIdx !== undefined && toIdx !== undefined && fromIdx < toIdx;
  });
  return new RenderGraph(filteredNodes, filteredEdges);
}

/**
 * Extract the subgraph covering the union of multiple paths.
 *
 * Each path is an ordered list of node ids (root → target). The result
 * contains every node on any path plus every forward edge between
 * consecutive nodes on any path. Detached nodes are always included.
 *
 * When all paths overlap (the common case), the result is identical to
 * a single-path extract. When paths diverge (e.g. DB marker on a
 * different branch than the contract), the result naturally includes the
 * fork and both branches — exactly the minimal information needed.
 */
export function extractRelevantSubgraph(
  graph: RenderGraph,
  paths: readonly (readonly string[])[],
): RenderGraph {
  const nodeSet = new Set<string>();
  const edgePairs = new Set<string>();

  for (const path of paths) {
    for (let i = 0; i < path.length; i++) {
      nodeSet.add(path[i]!);
      if (i > 0) {
        edgePairs.add(`${path[i - 1]!}\0${path[i]!}`);
      }
    }
  }

  const filteredNodes = graph.nodes.filter((n) => nodeSet.has(n.id) || n.style === 'detached');
  const filteredEdges = graph.edges.filter((e) => edgePairs.has(`${e.from}\0${e.to}`));
  return new RenderGraph(filteredNodes, filteredEdges);
}

// ---------------------------------------------------------------------------
// Truncation — keep last N spine edges, expand for markers
// ---------------------------------------------------------------------------

/** Result of {@link truncateGraph} — the visible subgraph plus truncation metadata. */
export interface TruncationResult {
  readonly graph: RenderGraph;
  /** Number of spine edges hidden by truncation (0 = nothing truncated). */
  readonly elidedCount: number;
  /** The visible portion of the spine (subset of the input spine). */
  readonly spine: readonly string[];
}

/**
 * Truncate a graph to the last `limit` spine edges from the spine target.
 * The window expands to include any node carrying a db or contract marker
 * so those are never truncated away.
 *
 * For the full graph: keeps all branches that fork from the visible spine window.
 * For the spine view: caller should call extractSubgraph first, then truncate.
 */
export function truncateGraph(
  graph: RenderGraph,
  spine: readonly string[],
  limit: number,
): TruncationResult {
  if (spine.length <= 1 || limit >= spine.length - 1) {
    return { graph, elidedCount: 0, spine };
  }

  // Find the earliest spine node that has a db or contract marker
  let earliestMarkerIdx = spine.length;
  for (let i = 0; i < spine.length; i++) {
    const n = graph.nodeById.get(spine[i]!);
    if (n?.markers?.some((m) => m.kind === 'db' || m.kind === 'contract')) {
      earliestMarkerIdx = i;
      break;
    }
  }

  // Effective limit: expand to include markers
  // spine has N+1 nodes for N edges; we want the last `effectiveEdges` edges,
  // which means keeping the last `effectiveEdges + 1` nodes
  const markerDistance = spine.length - 1 - earliestMarkerIdx;
  const effectiveEdges = Math.max(limit, markerDistance);

  if (effectiveEdges >= spine.length - 1) {
    return { graph, elidedCount: 0, spine };
  }

  const keepFromIdx = spine.length - 1 - effectiveEdges;
  const truncatedSpine = spine.slice(keepFromIdx);
  const visibleSpineSet = new Set(truncatedSpine);

  // Include any node reachable from visible spine nodes
  // (branches that fork from visible portion)
  const reachable = new Set(visibleSpineSet);
  const queue = [...truncatedSpine];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.outgoing(current)) {
      if (!reachable.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }

  // Also include detached nodes (they're appended at the bottom, not in the graph)
  for (const n of graph.nodes) {
    if (n.style === 'detached') reachable.add(n.id);
  }

  const truncatedNodes = graph.nodes.filter((n) => reachable.has(n.id));
  const truncatedEdges = graph.edges.filter((e) => reachable.has(e.from) && reachable.has(e.to));
  const elidedCount = spine.length - 1 - effectiveEdges;

  return {
    graph: new RenderGraph(truncatedNodes, truncatedEdges),
    elidedCount,
    spine: truncatedSpine,
  };
}

/**
 * After truncation the original root may not be in the visible graph.
 * Find the first node with no incoming edges as a fallback root.
 */
function findVisibleRoot(graph: RenderGraph, layoutNodes: readonly GraphNode[]): string {
  return layoutNodes.find((n) => !graph.incomingNodes.has(n.id))?.id ?? layoutNodes[0]?.id ?? '∅';
}

// ---------------------------------------------------------------------------
// Core layout + render pipeline
// ---------------------------------------------------------------------------

/**
 * The main rendering pipeline: dagre layout → edge stamping → label
 * placement → arrowheads → nodes → elided indicator → detached nodes.
 *
 * Called by {@link render} after optional truncation. Receives nodes/edges
 * and produces the final multi-line string.
 *
 * @param graph - The graph to render (may include detached nodes, which are
 *   rendered below the main graph rather than laid out by dagre).
 * @param options - Render options (rootId, spineTarget, colorize).
 * @param elidedCount - If > 0, a `┊ (N earlier migrations)` indicator
 *   is stamped above the visible root node.
 */
function layoutAndRender(graph: RenderGraph, options: GraphRenderOptions, elidedCount = 0): string {
  const colorize = options.colorize ?? true;
  const colors = buildColors(colorize);

  const layoutNodes = graph.nodes.filter((n) => n.style !== 'detached');
  const layoutNodeIds = new Set(layoutNodes.map((n) => n.id));
  const requestedRoot = options.rootId ?? layoutNodes[0]?.id ?? '∅';
  const rootId = layoutNodeIds.has(requestedRoot)
    ? requestedRoot
    : findVisibleRoot(graph, layoutNodes);

  const spineEdgeKeys = findSpineEdges(graph, rootId, options.spineTarget);

  const g = new dagre.graphlib.Graph({ multigraph: true });
  g.setGraph({ rankdir: 'TB', ranksep: 4, nodesep: 6, marginx: 2, marginy: 1 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of layoutNodes) {
    const tags = buildInlineTags(node.markers ?? [], colors);
    const tagWidth = inlineTagsWidth(tags);
    g.setNode(node.id, { width: node.id.length + 6 + tagWidth, height: 1 });
  }

  const edgeNames: string[] = [];
  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!;
    const fromDetached = graph.nodeById.get(edge.from)?.style === 'detached';
    const toDetached = graph.nodeById.get(edge.to)?.style === 'detached';
    if (fromDetached || toDetached) {
      edgeNames.push('');
      continue;
    }
    const name = `e${i}`;
    edgeNames.push(name);
    g.setEdge(edge.from, edge.to, { label: edge.label ?? '' }, name);
  }

  dagre.layout(g);

  const nodePos = new Map<string, Point>();
  for (const id of g.nodes()) {
    const n = g.node(id);
    nodePos.set(id, { x: Math.round(n.x), y: Math.round(n.y) });
  }

  const grid = new CharGrid();

  // Reserve node label areas so edges and labels avoid them
  for (const node of layoutNodes) {
    const pos = nodePos.get(node.id);
    if (!pos) continue;
    const tags = buildInlineTags(node.markers ?? [], colors);
    const tagWidth = inlineTagsWidth(tags);
    grid.reserveArea(pos.x - 1, pos.y, node.id.length + 4 + tagWidth);
  }

  // --- Prepare edge metadata ---
  type EdgeEntry = {
    idx: number;
    edge: GraphEdge;
    dagrePoints: Point[];
    src: Point;
    tgt: Point;
    role: 'spine' | 'branch' | 'backward';
    edgeColor: ColorFn;
    priority: number;
  };
  const edgeEntries: EdgeEntry[] = [];

  for (let i = 0; i < graph.edges.length; i++) {
    const edge = graph.edges[i]!;
    const name = edgeNames[i]!;
    if (!name || !nodePos.has(edge.from) || !nodePos.has(edge.to)) continue;

    const src = nodePos.get(edge.from)!;
    const tgt = nodePos.get(edge.to)!;
    const dagreEdge = g.edge({ v: edge.from, w: edge.to, name });
    const dagrePoints: Point[] = dagreEdge?.points ?? [];

    const isBackward = tgt.y < src.y;
    const isSpine = spineEdgeKeys.has(`${edge.from}→${edge.to}`);
    const role: EdgeEntry['role'] = isBackward ? 'backward' : isSpine ? 'spine' : 'branch';
    const hintColor = resolveHintColor(edge.colorHint, colors);
    const edgeColor =
      hintColor ??
      (role === 'backward' ? colors.backward : role === 'spine' ? colors.spine : colors.branch);
    const priority =
      role === 'backward' ? PRIORITY.backward : role === 'spine' ? PRIORITY.spine : PRIORITY.branch;

    edgeEntries.push({ idx: i, edge, dagrePoints, src, tgt, role, edgeColor, priority });
  }

  // --- Pass 1: Draw all edges ---
  type DrawnEdge = { edge: GraphEdge; poly: Point[]; role: EdgeEntry['role']; srcY: number };
  const drawnEdges: DrawnEdge[] = [];

  for (const entry of edgeEntries) {
    const { edge, dagrePoints, src, tgt, edgeColor, priority } = entry;

    const { poly } = selectBestVariant(src, dagrePoints, tgt, edge.label, grid);

    for (let j = 0; j < poly.length - 1; j++) {
      const a = poly[j]!;
      const b = poly[j + 1]!;
      if (a.y === b.y) grid.markHorizontal(a.y, a.x, b.x, edgeColor, priority);
      else if (a.x === b.x) grid.markVertical(a.x, a.y, b.y, edgeColor, priority);
    }

    drawnEdges.push({ edge, poly, role: entry.role, srcY: src.y });
  }

  // --- Pass 2: Place labels (longest first) ---
  const labelOrder = [...drawnEdges]
    .map((de, i) => ({ ...de, i }))
    .filter((de) => de.edge.label)
    .sort((a, b) => (b.edge.label?.length ?? 0) - (a.edge.label?.length ?? 0));

  for (const { edge, poly, role, srcY } of labelOrder) {
    if (!edge.label) continue;
    const labelPos = findLabelPlacement(poly, edge.label, grid, srcY);
    if (labelPos) {
      const labelColor =
        resolveHintColor(edge.colorHint, colors) ??
        (role === 'backward' ? colors.backward : role === 'spine' ? colors.spine : colors.label);
      grid.stampText(labelPos.x, labelPos.y, edge.label, labelColor);
    }
  }

  // --- Pass 3: Arrowheads ---
  for (const { edge, poly, role } of drawnEdges) {
    if (poly.length < 2) continue;
    const last = poly[poly.length - 1]!;
    const prev = poly[poly.length - 2]!;

    const edgeColor =
      resolveHintColor(edge.colorHint, colors) ??
      (role === 'backward' ? colors.backward : role === 'spine' ? colors.spine : colors.branch);

    let ax: number | undefined;
    let ay: number | undefined;
    let arrow: string | undefined;

    if (prev.x === last.x) {
      if (last.y > prev.y) {
        ax = last.x;
        ay = last.y - 1;
        arrow = ARROW.down;
      } else {
        ax = last.x;
        ay = last.y + 1;
        arrow = ARROW.up;
      }
    } else {
      if (last.x > prev.x) {
        ax = last.x - 1;
        ay = last.y;
        arrow = ARROW.right;
      } else {
        ax = last.x + 1;
        ay = last.y;
        arrow = ARROW.left;
      }
    }

    if (ax !== undefined && ay !== undefined && arrow && !grid.hasText(ax, ay)) {
      grid.stampText(ax, ay, arrow, edgeColor);
    }
  }

  // --- Draw nodes ---
  const spineNodeIds = new Set<string>();
  for (const key of spineEdgeKeys) {
    const [from, to] = key.split('→');
    if (from) spineNodeIds.add(from);
    if (to) spineNodeIds.add(to);
  }

  for (const node of layoutNodes) {
    const pos = nodePos.get(node.id);
    if (!pos) continue;

    const isSpineNode = spineNodeIds.has(node.id);
    const nodeColor = isSpineNode ? colors.spine : colors.branch;

    grid.stampText(pos.x, pos.y, '○', nodeColor);
    grid.stampText(pos.x + 1, pos.y, ' ');
    const hasMarkers = node.markers && node.markers.length > 0;
    grid.stampText(pos.x + 2, pos.y, node.id, isSpineNode || hasMarkers ? bold : dim);

    const tags = buildInlineTags(node.markers ?? [], colors);
    if (tags.length > 0) {
      let bx = pos.x + 2 + node.id.length;
      for (const tag of tags) {
        grid.stampText(bx, pos.y, ' ');
        bx++;
        grid.stampText(bx, pos.y, tag.text, tag.color);
        bx += tag.text.length;
      }
    }
  }

  // --- Elided indicator above root ---
  if (elidedCount > 0) {
    const topNodeId =
      layoutNodes.find((n) => !graph.incomingNodes.has(n.id))?.id ?? layoutNodes[0]?.id;
    const rootPos = topNodeId ? nodePos.get(topNodeId) : undefined;
    if (rootPos) {
      const label = elidedCount === 1 ? '1 earlier migration' : `${elidedCount} earlier migrations`;
      const topY = rootPos.y - 3;
      grid.stampText(rootPos.x, topY, '┊', colors.label);
      grid.stampText(rootPos.x, topY + 1, '┊', colors.label);
      grid.stampText(rootPos.x + 2, topY + 1, `(${label})`, colors.label);
      grid.stampText(rootPos.x, topY + 2, '┊', colors.label);
    }
  }

  // --- Detached nodes ---
  const detachedNodes = graph.nodes.filter((n) => n.style === 'detached');
  if (detachedNodes.length > 0) {
    // Align detached nodes with the bottom-most node in the graph so the
    // dashed connector visually continues from the last rendered node.
    let bottomNodeX = nodePos.values().next().value?.x ?? 0;
    let bottomNodeY = -1;
    for (const [, pos] of nodePos) {
      if (pos.y > bottomNodeY) {
        bottomNodeY = pos.y;
        bottomNodeX = pos.x;
      }
    }
    const spineX = bottomNodeX;
    let bottomY = grid.getMaxY() + 1;

    for (const node of detachedNodes) {
      grid.stampText(spineX, bottomY, '┊', colors.branch);
      bottomY++;
      grid.stampText(spineX, bottomY, '◇', colors.branch);
      grid.stampText(spineX + 2, bottomY, node.id, dim);

      const tags = buildInlineTags(node.markers ?? [], colors);
      if (tags.length > 0) {
        let bx = spineX + 2 + node.id.length;
        for (const tag of tags) {
          grid.stampText(bx, bottomY, ' ');
          bx++;
          grid.stampText(bx, bottomY, tag.text, tag.color);
          bx += tag.text.length;
        }
      }
      bottomY++;
    }
  }

  return grid.render();
}

// ---------------------------------------------------------------------------
// GraphRenderer implementation
// ---------------------------------------------------------------------------

/**
 * BFS to find the ordered node path from `rootId` to `targetId`.
 * Used for truncation — the spine path determines which edges to keep.
 *
 * Returns `[rootId]` if no path exists.
 */
function findSpinePath(graph: RenderGraph, rootId: string, targetId: string): string[] {
  const visited = new Set([rootId]);
  const parent = new Map<string, string>();
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current === targetId) {
      const path: string[] = [];
      let node = targetId;
      while (node !== rootId) {
        path.unshift(node);
        node = parent.get(node)!;
      }
      path.unshift(rootId);
      return path;
    }
    for (const edge of graph.outgoing(current)) {
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        parent.set(edge.to, current);
        queue.push(edge.to);
      }
    }
  }
  return [rootId];
}

/**
 * Render a graph with optional truncation.
 *
 * The caller decides what to pass in: the full graph for `--graph`, or a
 * subgraph extracted via {@link extractRelevantSubgraph} for the default view.
 */
function render(graph: RenderGraph, options: GraphRenderOptions): string {
  if (options.limit !== undefined) {
    const spine = findSpinePath(
      graph,
      options.rootId ?? graph.nodes[0]?.id ?? '∅',
      options.spineTarget,
    );
    const { graph: truncated, elidedCount } = truncateGraph(graph, spine, options.limit);
    return layoutAndRender(truncated, options, elidedCount);
  }
  return layoutAndRender(graph, options);
}

export interface GraphRenderer {
  render(graph: RenderGraph, options: GraphRenderOptions): string;
}

export const graphRenderer: GraphRenderer = {
  render,
};
