import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { bold, createColors, green, yellow } from 'colorette';
import stringWidth from 'string-width';
import type { GlyphMode } from '../glyph-mode';
import {
  laneColorForColumn,
  NEUTRAL_LANE_COLUMN,
  type RowArcLaneColors,
  resolveConnectorLaneColors,
  resolveRowArcLaneColors,
  stylerForLaneColumn,
} from './migration-graph-lane-colors';

export { resolveConnectorLaneColors } from './migration-graph-lane-colors';

import type {
  MigrationGraphGridModel,
  MigrationGraphGridRow,
  StructuralCell,
} from './migration-graph-layout';
import type { ClassifiedEdge } from './migration-graph-rows';
import {
  MIGRATION_LIST_HASH_WIDTH,
  migrationListEmptySource,
  migrationListForwardArrow,
  padFromHashColumn,
} from './migration-list-data-column';
import type { MigrationEdgeKind } from './migration-list-graph-topology';
import type { MigrationListStyler } from './migration-list-render';
import {
  CONTRACT_MARKER_NAME,
  createAnsiMigrationListStyler,
  formatContractNodeOverlays,
} from './migration-list-styler';

const LABEL_GAP = 2;

/**
 * The live-database overlay marker. Just another ref as far as styling goes —
 * the only emphasized markers are the active ref and the `contract`
 * desired-state marker (see {@link CONTRACT_MARKER_NAME}).
 */
const DB_MARKER_NAME = 'db';

export interface MigrationEdgeAnnotation {
  readonly status?: 'applied' | 'pending';
  readonly operationCount?: number;
  readonly invariants?: readonly string[];
  /**
   * Path-highlight annotation for `migrate --show` preview.
   * - `'on-path'`: migration is on the chosen path; rendered in bright green (nodes, hashes, names, lane lines).
   * - `'off-path'`: migration is off the chosen path; fully drawn but in uniform dim grey.
   */
  readonly pathHighlight?: 'on-path' | 'off-path';
}

export interface RenderMigrationGraphTreeOptions {
  readonly refsByHash?: ReadonlyMap<string, readonly string[]>;
  readonly edgeAnnotationsByHash?: ReadonlyMap<string, MigrationEdgeAnnotation>;
  readonly dbHash?: string;
  readonly contractHash?: string;
  /**
   * Whether this render is for the app space. When false, the `@contract`
   * marker is suppressed — `@contract` is an app-space concept and must not
   * appear in extension spaces (e.g. `pgvector:`). Defaults to `true` so
   * single-space callers that do not pass this option are unaffected.
   */
  readonly isAppSpace?: boolean;
  readonly activeRefName?: string;
  readonly hashLength?: number;
  readonly globalMaxEdgeTreePrefixWidth?: number;
  readonly globalMaxDirNameWidth?: number;
  readonly colorize: boolean;
  readonly glyphMode?: GlyphMode;
  readonly styler?: MigrationListStyler;
}

interface MigrationGraphTreeGlyphPalette {
  readonly node: string;
  readonly arcLand: string;
  readonly arcTee: string;
  readonly verticalPass: string;
  readonly branchTee: string;
  readonly mergeTee: string;
  readonly branchCorner: string;
  readonly mergeCorner: string;
  readonly arcBranchCorner: string;
  readonly arcBranchTee: string;
  readonly arcLandCorner: string;
  readonly arcLandTee: string;
  readonly arcCrossing: string;
  readonly arcLandBridge: string;
  readonly horizontalPass: string;
  readonly connectorBranchTee: string;
  readonly connectorBranchTeeCo: string;
  readonly connectorMergeTeeCo: string;
  readonly edgeArrow: Readonly<Record<MigrationEdgeKind, string>>;
  readonly forwardArrow: string;
  readonly emptySource: string;
}

const UNICODE_PALETTE: MigrationGraphTreeGlyphPalette = {
  node: '○ ',
  arcLand: '○◂',
  arcTee: '○─',
  verticalPass: '│ ',
  branchTee: '├─',
  mergeTee: '├─',
  branchCorner: '╮ ',
  mergeCorner: '╯ ',
  arcBranchCorner: '╮ ',
  arcBranchTee: '┬─',
  arcLandCorner: '╯ ',
  arcLandTee: '┴─',
  arcCrossing: '┼─',
  arcLandBridge: '──',
  horizontalPass: '──',
  connectorBranchTee: '├─',
  connectorBranchTeeCo: '┬─',
  connectorMergeTeeCo: '┴─',
  edgeArrow: { forward: '↑', rollback: '↓', self: '⟲' },
  forwardArrow: migrationListForwardArrow('unicode'),
  emptySource: migrationListEmptySource('unicode'),
};

const ASCII_PALETTE: MigrationGraphTreeGlyphPalette = {
  node: '* ',
  arcLand: '*<',
  arcTee: '*-',
  verticalPass: '| ',
  branchTee: '+-',
  mergeTee: '+-',
  branchCorner: '\\ ',
  mergeCorner: '/ ',
  arcBranchCorner: '\\ ',
  arcBranchTee: '+-',
  arcLandCorner: '/ ',
  arcLandTee: '+-',
  arcCrossing: '+-',
  arcLandBridge: '--',
  horizontalPass: '--',
  connectorBranchTee: '+-',
  connectorBranchTeeCo: '+-',
  connectorMergeTeeCo: '+-',
  edgeArrow: { forward: '^', rollback: 'v', self: '@' },
  forwardArrow: migrationListForwardArrow('ascii'),
  emptySource: migrationListEmptySource('ascii'),
};

function paletteFor(mode: GlyphMode): MigrationGraphTreeGlyphPalette {
  return mode === 'ascii' ? ASCII_PALETTE : UNICODE_PALETTE;
}

function overlayStatusGlyphs(mode: GlyphMode): {
  readonly applied: string;
  readonly pending: string;
} {
  return mode === 'ascii' ? { applied: '+', pending: '>' } : { applied: '✓', pending: '⧗' };
}

function arrowForEdgeKind(
  kind: MigrationEdgeKind,
  palette: MigrationGraphTreeGlyphPalette,
): string {
  return palette.edgeArrow[kind];
}

/**
 * Forced-color functions that always emit ANSI regardless of the ambient TTY
 * environment (NO_COLOR, piped output). Used for:
 *
 * - `forcedBold`: branch-coloured migration names pair their lane hue with bold;
 *   both must emit so the name is deterministically bold + hue.
 * - `forcedDim`: off-path path-highlight override (migrate --show).
 *   The renderer gates this behind `opts.colorize`; the forced variant ensures
 *   ANSI is emitted in controlled environments (e.g. tests with `NO_COLOR=1`)
 *   when the caller explicitly requests colour. Without forcing, `dim()` from
 *   the ambient module-level import no-ops under NO_COLOR, making the
 *   path-highlight unreachable in tests.
 */
const {
  bold: forcedBold,
  dim: forcedDim,
  greenBright: forcedGreen,
} = createColors({ useColor: true });

/**
 * The two styles used in `migrate --show` path-highlight mode.
 *
 * In path-highlight mode the normal by-branch rotating-colour logic
 * (`LANE_COLOR_CYCLE` / `laneStylerForColumn`) is suppressed entirely.
 * Every glyph, name, and hash is styled by its on-path / off-path role,
 * never by lane column index.
 *
 * - `onPath`: neutral single-path style — exactly how a linear (no-branch)
 *   section renders today. Lane glyphs are dim, names are bold, hashes use
 *   the default `sourceHash`/`destHash` colours. No rotation hue is applied.
 *   This is identical to how the pgvector single-path section renders.
 * - `offPath`: uniform dim grey on every cell (name, hashes, lane glyphs,
 *   direction arrows).
 *
 * To change the on-path or off-path colour in future, edit this object only.
 */
export const PATH_HIGHLIGHT_STYLES = {
  /**
   * Lane/glyph/arrow stylers for on-path cells.
   *
   * - lane: `forcedGreen` when colour is on — bright green so the on-path
   *   branch glyphs (`│ ├ ╯ ↑`) and node markers (`○`/`∅`) are visually
   *   distinct from off-path (dim grey). Uses forced ANSI so it survives
   *   NO_COLOR in tests. Identity when `colorize` is false.
   * - arrow: identity (plain, no colouring)
   * - dirName: `bold` (ambient bold — name stays white/bold, not green)
   * - hashOverride: undefined — `style.sourceHash`/`style.destHash` apply
   *   normally (cyan) so hashes keep their existing neutral colour.
   *
   * `style` is the same `MigrationListStyler` the tree renderer uses.
   * Rotation (`LANE_COLOR_CYCLE`) is never applied to on-path cells.
   */
  onPath: (_style: MigrationListStyler, colorize: boolean) => ({
    lane: colorize ? forcedGreen : (text: string) => text,
    arrow: (text: string) => text,
    dirName: (text: string) => bold(text),
    hashOverride: undefined as undefined,
  }),
  /**
   * Lane/glyph/arrow/hash stylers for off-path cells.
   * Uniform dim grey on everything — uses `forcedDim` so ANSI is emitted even
   * under NO_COLOR (test environments use `colorize:true` + NO_COLOR=1 to verify dim).
   * Returns identity functions when colour is off (`colorize: false`).
   */
  offPath: (colorize: boolean) => ({
    lane: colorize ? forcedDim : (text: string) => text,
    arrow: colorize ? forcedDim : (text: string) => text,
    dirName: colorize ? forcedDim : (text: string) => text,
    hashOverride: colorize ? forcedDim : undefined,
  }),
} as const;

function laneStylerForColumn(
  colorColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
): (text: string) => string {
  return stylerForLaneColumn(colorColumn, colorize, style.lane);
}

/**
 * Tint a branch-owned token (direction arrow, migration name) by its edge's
 * lane so the whole branch row reads in one colour. Column 0 has nothing to be
 * told apart from in the common linear chain, so it keeps the token's existing
 * default styling (`fallback`) rather than a palette hue; only lanes ≥ 1 take a
 * colour. With colour off, the fallback (also colourless) is used unchanged.
 */
function branchStylerOrDefault(
  column: number,
  colorize: boolean,
  fallback: (text: string) => string,
): (text: string) => string {
  if (!colorize || column <= NEUTRAL_LANE_COLUMN) {
    return fallback;
  }
  return laneColorForColumn(column);
}

/**
 * Render a crossing tee (`┼─`): the junction stays dim/neutral so neither arc
 * steals the cell; the trailing dash takes the served lane hue.
 */
function renderArcCrossing(
  pair: string,
  dashColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
): string {
  const junction = colorize ? style.lane : (text: string) => text;
  const dash = laneStylerForColumn(dashColumn, colorize, style);
  return junction(pair.slice(0, 1)) + dash(pair.slice(1));
}

/**
 * Render a connector tee (`├─` / `┬─` / `┴─`) with its junction glyph and its
 * trailing dash coloured independently: the junction anchors its own lane while
 * the dash leads into the branch on its right.
 */
function renderConnectorTee(
  pair: string,
  glyphColumn: number,
  dashColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
): string {
  const glyph = laneStylerForColumn(glyphColumn, colorize, style);
  if (glyphColumn === dashColumn) {
    return glyph(pair);
  }
  return glyph(pair.slice(0, 1)) + laneStylerForColumn(dashColumn, colorize, style)(pair.slice(1));
}

/**
 * A node-marker glyph pair (`○◂`, `○─`, `*<`, `*-`) is the contract node
 * marker (`○` / `*`) followed by an arc connector (`◂` / `─` / `<` / `-`). The
 * marker takes its own lane's hue (so each node visibly belongs to its branch);
 * the connector follows the arc it belongs to (its owning back-lane hue).
 * Direction arrows are handled elsewhere — they take their edge's lane hue too.
 *
 * When `laneOverride` is provided (for path-highlight rows), it replaces the
 * marker styler. `arcLaneOverride` (if provided) replaces the connector styler
 * independently — this matters when the node is on-path but the arc belongs to
 * an off-path rollback edge, which must render dim rather than green.
 */
function renderNodeMarkerPair(
  pair: string,
  nodeColumn: number,
  arcColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
  laneOverride?: (text: string) => string,
  arcLaneOverride?: (text: string) => string,
): string {
  const marker = laneOverride ?? laneStylerForColumn(nodeColumn, colorize, style);
  const connector =
    arcLaneOverride ?? laneOverride ?? laneStylerForColumn(arcColumn, colorize, style);
  return marker(pair.slice(0, 1)) + connector(pair.slice(1));
}

function renderCellPair(
  cell: StructuralCell,
  column: number,
  colors: RowArcLaneColors,
  colorize: boolean,
  style: MigrationListStyler,
  palette: MigrationGraphTreeGlyphPalette,
  laneOverride?: (text: string) => string,
  arrowOverride?: (text: string) => string,
  arcLaneOverride?: (text: string) => string,
): string {
  const laneColumn = colors.lane[column] ?? column;
  // In path-highlight mode (`laneOverride` present), the rotating lane colour is
  // bypassed entirely — the override applies to every structural glyph. Without an
  // override (normal graph/status/list mode), the existing rotation logic applies.
  const lane = laneOverride ?? laneStylerForColumn(laneColumn, colorize, style);
  // `arrowOverride` is used only for the direction arrow on edge-lane cells.
  // When absent, the normal `branchStylerOrDefault` logic applies (rotation for lanes ≥ 1).
  // In path-highlight mode it is always set alongside `laneOverride`.
  const arrow =
    arrowOverride ?? ((text: string) => branchStylerOrDefault(column, colorize, style.kind)(text));
  switch (cell.kind) {
    case 'node': {
      const arcColumn = colors.connector[column] ?? NEUTRAL_LANE_COLUMN;
      if (cell.arcLand === true) {
        return renderNodeMarkerPair(
          palette.arcLand,
          column,
          arcColumn,
          colorize,
          style,
          laneOverride,
          arcLaneOverride,
        );
      }
      if (cell.arcTee === true) {
        return renderNodeMarkerPair(
          palette.arcTee,
          column,
          arcColumn,
          colorize,
          style,
          laneOverride,
          arcLaneOverride,
        );
      }
      return lane(palette.node);
    }
    case 'vertical-pass':
      return lane(palette.verticalPass);
    case 'edge-lane':
      return cell.ownsLabel
        ? lane(palette.verticalPass.trimEnd()) + arrow(arrowForEdgeKind(cell.edgeKind, palette))
        : lane(palette.verticalPass);
    case 'branch-tee':
      return lane(palette.branchTee);
    case 'merge-tee':
      return lane(palette.mergeTee);
    case 'branch-corner':
      return lane(palette.branchCorner);
    case 'merge-corner':
      return lane(palette.mergeCorner);
    case 'arc-branch-corner':
      return lane(palette.arcBranchCorner);
    case 'arc-branch-tee':
      return lane(palette.arcBranchTee);
    case 'arc-land-corner':
      return lane(palette.arcLandCorner);
    case 'arc-land-tee':
      // When a lane override is active, apply it uniformly to both glyph and dash parts
      // so neither part emits a rotation hue.
      return laneOverride !== undefined
        ? laneOverride(palette.arcLandTee)
        : renderConnectorTee(
            palette.arcLandTee,
            laneColumn,
            colors.dash[column] ?? laneColumn,
            colorize,
            style,
          );
    case 'arc-crossing':
      return lane(palette.arcLandBridge);
    case 'arc-land-bridge':
      return lane(palette.arcLandBridge);
    case 'horizontal-pass':
      return lane(palette.horizontalPass);
    case 'empty':
      return '  ';
  }
}

/**
 * Render a branch-connector or merge-connector row.
 *
 * `columnLaneOverride` is an optional per-column map populated when path-highlight
 * annotations are active (`migrate --show`). For each column in the connector's
 * lane range, the map supplies the override styler (dim for off-path) that should
 * replace the normal rotating-lane colour for that column. Columns absent from the
 * map (on-path or unannotated) use the standard `laneStylerForColumn` logic unchanged.
 * This ensures off-path branch connectors appear dim rather than in their rotation
 * colour (e.g. magenta).
 */
function renderConnectorRow(
  row: MigrationGraphGridRow,
  gridWidth: number,
  colorize: boolean,
  style: MigrationListStyler,
  palette: MigrationGraphTreeGlyphPalette,
  columnLaneOverride?: ReadonlyMap<number, (text: string) => string>,
): string {
  const resolvedLane = (column: number): ((text: string) => string) =>
    columnLaneOverride?.get(column) ?? laneStylerForColumn(column, colorize, style);

  const isMerge = row.kind === 'merge-connector';
  if (row.cells.length > 0) {
    const colors = resolveConnectorLaneColors(row.cells, row.startLane ?? 0);
    let seenTee = false;
    let out = '';
    for (let column = 0; column < row.cells.length; column++) {
      const cell = row.cells[column];
      if (cell === undefined) continue;
      const glyphColumn = colors.glyph[column] ?? column;
      const dashColumn = colors.dash[column] ?? glyphColumn;
      const override = columnLaneOverride?.get(glyphColumn);
      // In path-highlight mode, the dash column's override is used for the trailing dash
      // even when the glyph column has no override. This handles branch-tee cells whose
      // migrationHash is undefined (no previous edge occupied that lane) — the tee's dash
      // belongs to the connector run and should follow the corner's annotation.
      const dashOverrideForPathHighlight = columnLaneOverride?.get(dashColumn) ?? override;
      if (
        override !== undefined ||
        (columnLaneOverride !== undefined && dashOverrideForPathHighlight !== undefined)
      ) {
        // When an override is active for this column (or when a dash override is available
        // via the connected corner), apply the glyph column's override to the junction glyph
        // (├/┬/┴), and the dash column's override to the trailing dash.
        // This matters for merge/branch connectors: the on-path trunk's tee (├) is green
        // while the dash (─) and corner (╯) bridging to an OFF-path column are dim.
        // For non-tee cells (corner, pass, crossing), the single-column override is fine.
        const effectiveOverride = override ?? dashOverrideForPathHighlight;
        if (effectiveOverride === undefined) {
          out += '  ';
          continue;
        }
        switch (cell.kind) {
          case 'branch-tee':
          case 'merge-tee': {
            const pair = seenTee ? palette.connectorBranchTeeCo : palette.connectorBranchTee;
            const dashOverride = columnLaneOverride?.get(dashColumn) ?? effectiveOverride;
            out += effectiveOverride(pair.slice(0, 1)) + dashOverride(pair.slice(1));
            seenTee = true;
            break;
          }
          case 'branch-corner':
            out += effectiveOverride(palette.branchCorner);
            break;
          case 'merge-corner':
            out += effectiveOverride(palette.mergeCorner);
            break;
          case 'vertical-pass':
            out += effectiveOverride(palette.verticalPass);
            break;
          case 'horizontal-pass':
            out += effectiveOverride(palette.horizontalPass);
            break;
          case 'arc-crossing': {
            // The junction glyph (┼) belongs to the vertical lane (effectiveOverride).
            // The trailing dash (─) runs horizontally into the next column — it belongs
            // to that column's owner (dashColumn). Use the dash column's override so an
            // off-path horizontal continuation is dim even when the crossing is on-path.
            const arcCrossingDashOverride =
              columnLaneOverride?.get(dashColumn) ?? effectiveOverride;
            out +=
              effectiveOverride(palette.arcCrossing.slice(0, 1)) +
              arcCrossingDashOverride(palette.arcCrossing.slice(1));
            break;
          }
          default:
            out += '  ';
        }
        continue;
      }
      const lane = laneStylerForColumn(glyphColumn, colorize, style);
      switch (cell.kind) {
        case 'branch-tee':
          out += renderConnectorTee(
            seenTee ? palette.connectorBranchTeeCo : palette.connectorBranchTee,
            glyphColumn,
            dashColumn,
            colorize,
            style,
          );
          seenTee = true;
          break;
        case 'merge-tee':
          out += renderConnectorTee(
            seenTee ? palette.connectorMergeTeeCo : palette.connectorBranchTee,
            glyphColumn,
            dashColumn,
            colorize,
            style,
          );
          seenTee = true;
          break;
        case 'branch-corner':
          out += lane(palette.branchCorner);
          break;
        case 'merge-corner':
          out += lane(palette.mergeCorner);
          break;
        case 'vertical-pass':
          out += lane(palette.verticalPass);
          break;
        case 'horizontal-pass':
          out += lane(palette.horizontalPass);
          break;
        case 'arc-crossing':
          out += renderArcCrossing(palette.arcCrossing, dashColumn, colorize, style);
          break;
        default:
          out += '  ';
      }
    }
    // The cells array is sized to the grid width at emit time; a back-arc lane
    // allocated by a later row can push the grid wider afterwards, so pad any
    // trailing columns rather than dropping the lanes that pass through here.
    for (let column = row.cells.length; column < gridWidth; column++) {
      out += '  ';
    }
    return out;
  }

  const start = row.startLane ?? 0;
  const end = row.endLane ?? start;
  // The whole fork/merge run reads as one line in the served lane's hue (the
  // corner it reaches); pass-through columns outside the run keep their own.
  const runLane = resolvedLane(end);
  let out = '';
  for (let column = 0; column < gridWidth; column++) {
    if (column < start || column > end) out += '  ';
    else if (column === start) out += runLane(palette.connectorBranchTee);
    else if (column === end) out += runLane(isMerge ? palette.mergeCorner : palette.branchCorner);
    else out += runLane(isMerge ? palette.connectorMergeTeeCo : palette.connectorBranchTeeCo);
  }
  return out;
}

function abbreviateHash(hash: string, hashLength: number, emptySource: string): string {
  if (hash === EMPTY_CONTRACT_HASH) {
    return emptySource;
  }
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, hashLength);
}

const MIN_HASH_DATA_COLUMN = 25;

interface ContractOverlayNames {
  readonly markers: readonly string[];
  readonly refs: readonly string[];
}

function overlayNamesForContract(
  contractHash: string,
  opts: RenderMigrationGraphTreeOptions,
): ContractOverlayNames {
  const markers: string[] = [];
  const refs: string[] = [];
  const userRefs = opts.refsByHash?.get(contractHash);
  if (userRefs) {
    refs.push(...[...userRefs].sort((a, b) => a.localeCompare(b)));
  }
  if (
    opts.isAppSpace !== false &&
    opts.contractHash === contractHash &&
    contractHash !== EMPTY_CONTRACT_HASH
  ) {
    markers.push(CONTRACT_MARKER_NAME);
  }
  if (opts.dbHash === contractHash) {
    markers.push(DB_MARKER_NAME);
  }
  markers.sort((a, b) => {
    if (a === CONTRACT_MARKER_NAME) {
      return -1;
    }
    if (b === CONTRACT_MARKER_NAME) {
      return 1;
    }
    return a.localeCompare(b);
  });
  return { markers, refs };
}

function createTreeStyler(opts: RenderMigrationGraphTreeOptions): MigrationListStyler {
  const base = opts.styler ?? createAnsiMigrationListStyler({ useColor: opts.colorize });
  const activeRefName = opts.activeRefName;
  if (!opts.colorize || activeRefName === undefined) {
    return base;
  }
  return {
    ...base,
    refs: (names) => {
      const styledNames = names.map((name) => (name === activeRefName ? bold(name) : name));
      return base.refs(styledNames);
    },
  };
}

function formatEdgeAnnotationSuffix(
  migrationHash: string,
  opts: RenderMigrationGraphTreeOptions,
  style: MigrationListStyler,
): string {
  const annotation = opts.edgeAnnotationsByHash?.get(migrationHash);
  if (annotation === undefined) {
    return '';
  }
  const isOffPath = annotation.pathHighlight === 'off-path';
  const segments: string[] = [];
  if (annotation.operationCount !== undefined) {
    segments.push(`${annotation.operationCount} ops`);
  }
  if (annotation.invariants !== undefined && annotation.invariants.length > 0) {
    segments.push(style.invariants(annotation.invariants));
  }
  const status = annotation.status;
  if (status !== undefined) {
    const glyphs = overlayStatusGlyphs(opts.glyphMode ?? 'unicode');
    const glyph = status === 'applied' ? glyphs.applied : glyphs.pending;
    const label = status === 'applied' ? 'applied' : 'pending';
    if (!opts.colorize) {
      segments.push(`${glyph} ${label}`);
    } else {
      const styler = status === 'applied' ? green : yellow;
      segments.push(styler(`${glyph} ${label}`));
    }
  }
  if (annotation.pathHighlight === 'on-path') {
    const glyph = opts.glyphMode === 'ascii' ? '>' : '↑';
    segments.push(`${glyph} will run`);
  }
  if (segments.length === 0) {
    return '';
  }
  const suffix = `  ${segments.join('  ')}`;
  return opts.colorize && isOffPath ? forcedDim(suffix) : suffix;
}

/**
 * Format the `from → to` hash data column for an edge row.
 *
 * When `hashOverride` is provided (off-path → `dim`), it replaces ALL sub-stylers
 * (`sourceHash`, `destHash`, arrow `glyph`) so dim reaches every character without
 * inner ANSI codes (e.g. the dim+cyan of `sourceHash`) overriding it. On-path edges
 * carry no override. Without an override, the normal `style` sub-stylers apply.
 */
function formatEdgeHashColumn(
  edge: ClassifiedEdge,
  style: MigrationListStyler,
  hashLength: number,
  palette: MigrationGraphTreeGlyphPalette,
  hashOverride?: (text: string) => string,
): string {
  const src = hashOverride ?? style.sourceHash;
  const dst = hashOverride ?? style.destHash;
  const glyph = hashOverride ?? style.glyph;
  if (edge.kind === 'self') {
    const hash = abbreviateHash(edge.from, hashLength, palette.emptySource);
    const source = padFromHashColumn(src(hash), hashLength);
    return `${source} ${glyph(palette.forwardArrow)} ${dst(hash)}`;
  }
  const source =
    edge.from === EMPTY_CONTRACT_HASH
      ? padFromHashColumn(glyph(palette.emptySource), hashLength)
      : padFromHashColumn(
          src(abbreviateHash(edge.from, hashLength, palette.emptySource)),
          hashLength,
        );
  const arrow = glyph(palette.forwardArrow);
  const dest = dst(abbreviateHash(edge.to, hashLength, palette.emptySource));
  return `${source} ${arrow} ${dest}`;
}

function padVisible(text: string, targetWidth: number): string {
  const padding = Math.max(0, targetWidth - stringWidth(text));
  return text + ' '.repeat(padding);
}

const ANSI_ESCAPE = '\x1b';

function trimTrailingWhitespace(line: string): string {
  const trailingSpaceBeforeReset = new RegExp(`[\\t ]+((?:${ANSI_ESCAPE}\\[[0-9;]*m)+)$`);
  return line.replace(trailingSpaceBeforeReset, '$1').replace(/\s+$/, '');
}

function gridWidthForModel(rows: readonly MigrationGraphGridRow[]): number {
  return rows.reduce(
    (max, row) =>
      row.kind === 'node' || row.kind === 'edge' ? Math.max(max, row.cells.length) : max,
    1,
  );
}

function maxDirNameLength(edges: readonly ClassifiedEdge[]): number {
  if (edges.length === 0) return 0;
  return Math.max(...edges.map((edge) => edge.dirName.length));
}

function rowDirNameWidth(labelColumn: number, maxDirNameLen: number, dirNameGap: number): number {
  return Math.max(maxDirNameLen + dirNameGap, MIN_HASH_DATA_COLUMN - labelColumn);
}

function gridUsesSkipRollbackArcs(rows: readonly MigrationGraphGridRow[]): boolean {
  return rows.some((row) =>
    row.cells.some(
      (cell) => cell.kind === 'edge-lane' && cell.adjacency === 'node-skipping-rollback',
    ),
  );
}

function edgeLabelColumn(row: MigrationGraphGridRow, wideLabelColumn: number | undefined): number {
  if (wideLabelColumn !== undefined) {
    return wideLabelColumn;
  }
  const laneIndex = row.laneIndex ?? 0;
  if (row.edge?.from === EMPTY_CONTRACT_HASH && laneIndex === 0) {
    return (laneIndex + 1) * 2 + LABEL_GAP;
  }
  const usesFullRowGutter = row.cells.some(
    (cell, index) => index > laneIndex && cell.kind === 'vertical-pass',
  );
  return usesFullRowGutter ? row.cells.length * 2 + LABEL_GAP : (laneIndex + 1) * 2 + LABEL_GAP;
}

function maxEdgeTreePrefixWidth(
  rows: readonly MigrationGraphGridRow[],
  wideLabelColumn: number | undefined,
): number {
  let max = 0;
  for (const row of rows) {
    if (row.kind !== 'edge' || row.edge === undefined) continue;
    max = Math.max(max, edgeLabelColumn(row, wideLabelColumn));
  }
  return max;
}

export function computeMaxEdgeTreePrefixWidthForLayout(model: MigrationGraphGridModel): number {
  const wideLabelColumn = gridUsesSkipRollbackArcs(model.rows)
    ? gridWidthForModel(model.rows) * 2 + 4
    : undefined;
  return maxEdgeTreePrefixWidth(model.rows, wideLabelColumn);
}

export function computeMaxDirNameLengthForLayout(model: MigrationGraphGridModel): number {
  const allEdges = model.rows
    .filter(
      (row): row is MigrationGraphGridRow & { edge: ClassifiedEdge } =>
        row.kind === 'edge' && row.edge !== undefined,
    )
    .map((row) => row.edge);
  return maxDirNameLength(allEdges);
}

function nodeHasArcDecoration(row: MigrationGraphGridRow): boolean {
  return row.cells.some(
    (cell) => cell.kind === 'node' && (cell.arcTee === true || cell.arcLand === true),
  );
}

export function renderMigrationGraphTree(
  model: MigrationGraphGridModel,
  opts: RenderMigrationGraphTreeOptions,
): string {
  const glyphMode = opts.glyphMode ?? 'unicode';
  const palette = paletteFor(glyphMode);
  const style = createTreeStyler(opts);
  const hashLength = opts.hashLength ?? MIGRATION_LIST_HASH_WIDTH;
  const gridWidth = gridWidthForModel(model.rows);
  const wideLabelColumn = gridUsesSkipRollbackArcs(model.rows) ? gridWidth * 2 + 4 : undefined;
  const dirNameGap = wideLabelColumn !== undefined ? 3 : LABEL_GAP;
  const allEdges = model.rows
    .filter(
      (row): row is MigrationGraphGridRow & { edge: ClassifiedEdge } =>
        row.kind === 'edge' && row.edge !== undefined,
    )
    .map((row) => row.edge);
  const maxDirNameLen = maxDirNameLength(allEdges);
  const effectiveMaxDirNameLen = opts.globalMaxDirNameWidth ?? maxDirNameLen;
  const maxEdgePrefixWidth =
    opts.globalMaxEdgeTreePrefixWidth ?? maxEdgeTreePrefixWidth(model.rows, wideLabelColumn);
  const edgeDirNameWidth = rowDirNameWidth(maxEdgePrefixWidth, effectiveMaxDirNameLen, dirNameGap);

  // Build a contract-hash → path-highlight map so node rows can be coloured correctly.
  // On-path wins: if a contract is both `from` of an on-path edge and `to` of an off-path
  // edge (or vice-versa), it is treated as on-path.
  // This map is only populated when edgeAnnotationsByHash is provided (migrate --show);
  // for every other command (graph/status/list) it is empty and the code below is a no-op.
  // NOTE: this is ONLY used for node-marker (○/∅) classification. Connector rows and
  // structural cells (tees, corners, arcs) use their per-cell migrationHash directly —
  // not this map and not any column-level aggregate.
  const contractHighlights = new Map<string, 'on-path' | 'off-path'>();
  if (opts.edgeAnnotationsByHash) {
    for (const row of model.rows) {
      if (row.kind !== 'edge' || row.edge === undefined) continue;
      const annotation = opts.edgeAnnotationsByHash.get(row.edge.migrationHash);
      if (annotation?.pathHighlight === undefined) continue;
      const highlight = annotation.pathHighlight;
      for (const hash of [row.edge.from, row.edge.to]) {
        if (hash === EMPTY_CONTRACT_HASH) continue;
        const existing = contractHighlights.get(hash);
        // On-path wins over off-path when a contract hash appears in both.
        if (existing !== 'on-path') {
          contractHighlights.set(hash, highlight);
        }
      }
    }
  }

  // In path-highlight mode (`opts.edgeAnnotationsByHash` present), the by-branch rotating
  // colour logic is suppressed entirely. Every glyph is styled by on-path / off-path role
  // via PATH_HIGHLIGHT_STYLES — never by lane column index. In normal mode (no annotations)
  // `pathHighlightActive` is false and the code below is a complete no-op; rotation applies.
  const pathHighlightActive = opts.edgeAnnotationsByHash !== undefined;

  /**
   * Resolve the lane and arrow overrides for a row in path-highlight mode.
   * - on-path → neutral single-path style (style.lane for glyphs, plain arrow, bold name).
   *   Rotation colour is suppressed; `style.sourceHash`/`style.destHash` apply for hashes.
   * - off-path → uniform dim grey (forcedDim) on every glyph, arrow, name, and hash.
   * - undefined → `undefined` (no override). Unannotated rows use normal rotation. This covers
   *   both non-path-highlight commands (graph/status/list) and any annotation without pathHighlight.
   * - When pathHighlightActive is false: always returns undefined, preserving normal rotation.
   */
  function pathStyleForHighlight(highlight: 'on-path' | 'off-path' | undefined):
    | {
        lane: ((text: string) => string) | undefined;
        arrow: ((text: string) => string) | undefined;
        dirName: ((text: string) => string) | undefined;
        hashOverride: ((text: string) => string) | undefined;
      }
    | undefined {
    if (!pathHighlightActive || highlight === undefined) return undefined;
    if (highlight === 'off-path') {
      const s = PATH_HIGHLIGHT_STYLES.offPath(opts.colorize);
      return { lane: s.lane, arrow: s.arrow, dirName: s.dirName, hashOverride: s.hashOverride };
    }
    // on-path → green lane glyphs, bold name, neutral hashes
    const s = PATH_HIGHLIGHT_STYLES.onPath(style, opts.colorize);
    return { lane: s.lane, arrow: s.arrow, dirName: s.dirName, hashOverride: s.hashOverride };
  }

  /**
   * Lane override for a given highlight in path-highlight mode.
   * Returns the `lane` part only — used for per-cell overrides.
   */
  function pathLaneFor(
    highlight: 'on-path' | 'off-path' | undefined,
  ): ((text: string) => string) | undefined {
    return pathStyleForHighlight(highlight)?.lane;
  }

  /**
   * Arrow override for a given highlight in path-highlight mode.
   * Returns the `arrow` part only — used for edge-lane cell arrow rendering.
   */
  function pathArrowFor(
    highlight: 'on-path' | 'off-path' | undefined,
  ): ((text: string) => string) | undefined {
    return pathStyleForHighlight(highlight)?.arrow;
  }

  const lines: string[] = [];

  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex++) {
    const row = model.rows[rowIndex];
    if (row === undefined) continue;

    if (row.kind === 'component-separator') {
      lines.push('');
      continue;
    }

    if (row.kind === 'branch-connector' || row.kind === 'merge-connector') {
      // In path-highlight mode, build a per-column lane override from each cell's own
      // migrationHash. Each structural cell (branch-tee, branch-corner, merge-tee,
      // merge-corner, vertical-pass, arc-crossing) carries the migrationHash of the
      // edge it visually belongs to (set by Stage 2). We look up that edge's annotation
      // directly — no column-level aggregate, no "on-path wins" across columns.
      let connectorColumnOverride: Map<number, (text: string) => string> | undefined;
      if (pathHighlightActive && opts.colorize) {
        connectorColumnOverride = new Map();
        for (let col = 0; col < row.cells.length; col++) {
          const cell = row.cells[col];
          if (cell === undefined || cell.kind === 'empty') continue;
          // arc-crossing: colour by the vertical lane's owner (migrationHash), not the arc.
          const hashForCell =
            'migrationHash' in cell && cell.migrationHash !== undefined
              ? cell.migrationHash
              : undefined;
          if (hashForCell === undefined) continue;
          const highlight = opts.edgeAnnotationsByHash?.get(hashForCell)?.pathHighlight;
          const override = pathLaneFor(highlight);
          if (override !== undefined) {
            connectorColumnOverride.set(col, override);
          }
        }
        if (connectorColumnOverride.size === 0) {
          connectorColumnOverride = undefined;
        }
      }
      lines.push(
        trimTrailingWhitespace(
          renderConnectorRow(
            row,
            gridWidth,
            opts.colorize,
            style,
            palette,
            connectorColumnOverride,
          ),
        ),
      );
      continue;
    }

    // Determine the per-row path-highlight style for path-highlight rendering.
    // For edge rows: derived from the edge's annotation.
    // For node rows: derived from the contract hash's membership in on/off-path edges.
    // When pathHighlightActive is false, pathStyleForHighlight returns undefined and
    // the normal rotating-colour lane styler applies everywhere (no-op for non-show commands).
    let rowPathHighlight: 'on-path' | 'off-path' | undefined;
    if (row.kind === 'edge' && row.edge !== undefined) {
      rowPathHighlight = opts.edgeAnnotationsByHash?.get(row.edge.migrationHash)?.pathHighlight;
    } else if (row.kind === 'node' && row.contractHash !== undefined) {
      rowPathHighlight = contractHighlights.get(row.contractHash);
    }
    const rowStyle = pathStyleForHighlight(rowPathHighlight);
    const rowLaneOverride = rowStyle?.lane;
    const rowArrowOverride = rowStyle?.arrow;

    // Classify every cell by its own edge's annotation (migrationHash → edgeAnnotationsByHash).
    // Each structural cell (vertical-pass, branch-tee, arc-land-corner, etc.) carries the
    // migrationHash of the edge it visually belongs to (set by the layout builder, Stage 2).
    // We read that hash directly — no column-level aggregate, no "on-path wins" across columns.
    //
    // - vertical-pass: classifies by cell.migrationHash (the edge passing through), NOT by column.
    // - edge-lane:     classifies by cell.migrationHash (the edge's own row).
    // - branch-tee/corner, merge-tee/corner, arc-*: classifies by cell.migrationHash.
    // - arc-crossing:  classifies by cell.migrationHash (the vertical lane's owner), so the
    //                  crossing reads as the lane passing THROUGH, not the arc skipping over.
    // - node (○/∅):   classifies by rowPathHighlight derived from contractHighlights (the
    //                  node's incident edges); falls through to rowLaneOverride.
    //
    // When pathHighlightActive is false (normal graph/status/list mode), all overrides are
    // undefined and the normal rotating-colour lane styler applies unchanged.
    const cellColors = resolveRowArcLaneColors(row.cells);
    let gutter = row.cells
      .map((cell, column) => {
        let laneOverride = rowLaneOverride;
        let arrowOverride = rowArrowOverride;
        let arcLaneOverride: ((text: string) => string) | undefined;
        if (pathHighlightActive) {
          if (cell.kind === 'edge-lane') {
            // Own cell: colour comes from this cell's own edge annotation.
            const cellHighlight = opts.edgeAnnotationsByHash?.get(
              cell.migrationHash,
            )?.pathHighlight;
            laneOverride = pathLaneFor(cellHighlight);
            arrowOverride = pathArrowFor(cellHighlight);
          } else if (cell.kind === 'node' && (cell.arcTee === true || cell.arcLand === true)) {
            // Node with arc decoration: the node marker takes the node's own row highlight
            // (rowLaneOverride), but the arc connector belongs to the back-arc edge which may
            // have a different annotation. Look up the arc cell's migrationHash to derive the
            // arc connector's colour independently.
            const arcColumn = cellColors.connector[column] ?? NEUTRAL_LANE_COLUMN;
            const arcCell = row.cells[arcColumn];
            const arcHash =
              arcCell !== undefined && 'migrationHash' in arcCell
                ? arcCell.migrationHash
                : undefined;
            if (arcHash !== undefined) {
              const arcHighlight = opts.edgeAnnotationsByHash?.get(arcHash)?.pathHighlight;
              arcLaneOverride = pathLaneFor(arcHighlight);
            }
            // laneOverride stays as rowLaneOverride (the node marker colour)
          } else if (cell.kind !== 'node' && cell.kind !== 'empty') {
            // Routing cells (vertical-pass, branch-tee, merge-corner, arc-*, horizontal-pass):
            // each carries a migrationHash for the edge it belongs to. Classify by that hash.
            // arc-crossing uses migrationHash (vertical lane owner), not arcMigrationHash.
            const hashForCell =
              'migrationHash' in cell && cell.migrationHash !== undefined
                ? cell.migrationHash
                : undefined;
            if (hashForCell !== undefined) {
              const cellHighlight = opts.edgeAnnotationsByHash?.get(hashForCell)?.pathHighlight;
              laneOverride = pathLaneFor(cellHighlight);
              arrowOverride = pathArrowFor(cellHighlight);
            }
          }
          // plain node cells (no arcTee/arcLand) fall through to rowLaneOverride
        }
        return renderCellPair(
          cell,
          column,
          cellColors,
          opts.colorize,
          style,
          palette,
          laneOverride,
          arrowOverride,
          arcLaneOverride,
        );
      })
      .join('');
    let laneSpan = row.cells.length;
    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      if (contractHash === EMPTY_CONTRACT_HASH) {
        laneSpan = 1;
      } else {
        let lastActiveColumn = -1;
        for (let column = row.cells.length - 1; column >= 0; column--) {
          if (row.cells[column]?.kind !== 'empty') {
            lastActiveColumn = column;
            break;
          }
        }
        laneSpan = lastActiveColumn >= 0 ? lastActiveColumn + 1 : 1;
      }
    }
    const labelColumn =
      row.kind === 'edge'
        ? maxEdgePrefixWidth
        : wideLabelColumn !== undefined &&
            (nodeHasArcDecoration(row) || row.contractHash !== undefined)
          ? wideLabelColumn
          : laneSpan * 2 + LABEL_GAP;
    if (
      row.kind === 'edge' &&
      row.edge?.from === EMPTY_CONTRACT_HASH &&
      (row.laneIndex ?? 0) === 0
    ) {
      // Init edge (∅ → first): only the first cell is rendered (the edge-lane cell).
      // rowLaneOverride is correct here — it comes from the edge's own annotation.
      gutter = row.cells
        .slice(0, 1)
        .map((cell, column) =>
          renderCellPair(
            cell,
            column,
            cellColors,
            opts.colorize,
            style,
            palette,
            rowLaneOverride,
            rowArrowOverride,
          ),
        )
        .join('');
    } else if (row.kind === 'node' && laneSpan < row.cells.length && !nodeHasArcDecoration(row)) {
      // Node gutter slice: may contain vertical-pass cells belonging to other edges.
      // Classify each cell by its own migrationHash so pass-through lanes carry the
      // correct colour, not the node's highlight.
      gutter = row.cells
        .slice(0, laneSpan)
        .map((cell, column) => {
          let cellLaneOverride = rowLaneOverride;
          let cellArrowOverride = rowArrowOverride;
          if (pathHighlightActive && cell.kind !== 'node' && cell.kind !== 'empty') {
            const hashForCell =
              'migrationHash' in cell && cell.migrationHash !== undefined
                ? cell.migrationHash
                : undefined;
            if (hashForCell !== undefined) {
              const cellHighlight = opts.edgeAnnotationsByHash?.get(hashForCell)?.pathHighlight;
              cellLaneOverride = pathLaneFor(cellHighlight);
              cellArrowOverride = pathArrowFor(cellHighlight);
            }
          }
          return renderCellPair(
            cell,
            column,
            cellColors,
            opts.colorize,
            style,
            palette,
            cellLaneOverride,
            cellArrowOverride,
          );
        })
        .join('');
    } else if (gutter.length < laneSpan * 2) {
      gutter = gutter.padEnd(laneSpan * 2, ' ');
    }
    const dirNameWidth =
      row.kind === 'edge'
        ? edgeDirNameWidth
        : rowDirNameWidth(labelColumn, maxDirNameLen, dirNameGap);
    const gutterPad = padVisible(gutter, labelColumn);

    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      if (contractHash === EMPTY_CONTRACT_HASH) {
        // The ∅ node row's trailing cells are vertical-pass lanes belonging to arc edges.
        // Classify each by its own migrationHash so they carry the correct path-highlight
        // colour rather than the rotation code that falls out of the ambient lane styler.
        const trailingLanes = row.cells
          .slice(1)
          .map((cell, offset) => {
            let cellLaneOverride = rowLaneOverride;
            let cellArrowOverride = rowArrowOverride;
            if (pathHighlightActive && cell.kind !== 'node' && cell.kind !== 'empty') {
              const hashForCell =
                'migrationHash' in cell && cell.migrationHash !== undefined
                  ? cell.migrationHash
                  : undefined;
              if (hashForCell !== undefined) {
                const cellHighlight = opts.edgeAnnotationsByHash?.get(hashForCell)?.pathHighlight;
                cellLaneOverride = pathLaneFor(cellHighlight);
                cellArrowOverride = pathArrowFor(cellHighlight);
              }
            }
            return renderCellPair(
              cell,
              offset + 1,
              cellColors,
              opts.colorize,
              style,
              palette,
              cellLaneOverride,
              cellArrowOverride,
            );
          })
          .join('');
        const emptyGutter = palette.emptySource.padEnd(2, ' ') + trailingLanes;
        const overlays = overlayNamesForContract(contractHash, opts);
        if (overlays.markers.length === 0 && overlays.refs.length === 0) {
          lines.push(trimTrailingWhitespace(emptyGutter));
          continue;
        }
        const overlay = formatContractNodeOverlays(style, overlays.markers, overlays.refs);
        lines.push(trimTrailingWhitespace(`${emptyGutter}${' '.repeat(LABEL_GAP)}${overlay}`));
        continue;
      }
      // In path-highlight mode, off-path nodes use `rowStyle.hashOverride` (uniform dim) so
      // inner ANSI codes (e.g. dim+cyan of `style.sourceHash`) cannot override the outer dim.
      // On-path nodes use `style.sourceHash` as normal (neutral purple-ish hash colour).
      const hashTextStyler = rowStyle?.hashOverride ?? style.sourceHash;
      const hashText = hashTextStyler(
        abbreviateHash(contractHash, hashLength, palette.emptySource),
      );
      const overlays = overlayNamesForContract(contractHash, opts);
      const hasOverlays = overlays.markers.length > 0 || overlays.refs.length > 0;
      const overlayPad = hasOverlays ? ' '.repeat(LABEL_GAP) : '';
      const overlay = hasOverlays
        ? formatContractNodeOverlays(style, overlays.markers, overlays.refs)
        : '';
      lines.push(trimTrailingWhitespace(`${gutterPad}${hashText}${overlayPad}${overlay}`));
      continue;
    }

    const edge = row.edge;
    if (edge === undefined) continue;

    const dirNamePadding = ' '.repeat(Math.max(0, dirNameWidth - edge.dirName.length));
    const laneIndex = row.laneIndex ?? 0;

    // The gutter is already coloured via the per-cell overrides threaded into renderCellPair.
    const edgeGutterPad = padVisible(gutter, labelColumn);

    let dirName: string;
    if (rowStyle !== undefined) {
      // Path-highlight mode (on-path or off-path annotation present):
      // `rowStyle.dirName` is set by PATH_HIGHLIGHT_STYLES — bold for on-path, forcedDim for off-path.
      // Rotation is suppressed entirely for both roles.
      // When rowStyle is undefined (unannotated row or non-show command), this branch is not entered.
      const dirNameStyler = rowStyle.dirName ?? style.dirName;
      dirName = `${dirNameStyler(edge.dirName)}${dirNamePadding}`;
    } else {
      // Normal mode: lane hue for branched lanes (column ≥ 1), bold-only for column 0.
      const dirNameStyler =
        opts.colorize && laneIndex > NEUTRAL_LANE_COLUMN
          ? (text: string) => forcedBold(laneColorForColumn(laneIndex)(text))
          : style.dirName;
      dirName = `${dirNameStyler(edge.dirName)}${dirNamePadding}`;
    }

    // Pass hashOverride from path-highlight styles so formatEdgeHashColumn applies it to ALL
    // sub-stylers (sourceHash, destHash, arrow glyph). Wrapping already-styled text in an outer
    // colour does not work — inner ANSI codes override the outer at the terminal level.
    const hashColumnOverride = rowStyle?.hashOverride;
    const hashColumn = formatEdgeHashColumn(edge, style, hashLength, palette, hashColumnOverride);
    const annotationSuffix = formatEdgeAnnotationSuffix(edge.migrationHash, opts, style);
    lines.push(
      trimTrailingWhitespace(`${edgeGutterPad}${dirName}${hashColumn}${annotationSuffix}`),
    );
  }

  return lines.join('\n');
}

/**
 * Format a single on-path migration row for the `migrate --show` run-list.
 *
 * Uses the SAME styling as the tree renderer's on-path rows (PATH_HIGHLIGHT_STYLES.onPath)
 * so the run-list and graph tree are byte-for-byte identical in their name/hash columns.
 * The gutter is omitted — the list has no graph structure.
 *
 * This is the SINGLE code path for on-path row styling shared by both the graph tree
 * and the "Will run, in order:" list. To change the on-path colour, edit PATH_HIGHLIGHT_STYLES.
 */
export function formatOnPathMigrationRow(
  dirName: string,
  from: string,
  to: string,
  dirNameWidth: number,
  colorize: boolean,
  glyphMode: GlyphMode,
): string {
  const palette = paletteFor(glyphMode);
  const style = createAnsiMigrationListStyler({ useColor: colorize });
  // Use PATH_HIGHLIGHT_STYLES.onPath as the single seam for on-path colour.
  // Pass `style` and `colorize` so the lane/glyph stylers respect the colour gate.
  const s = PATH_HIGHLIGHT_STYLES.onPath(style, colorize);
  const styledDirName = `${s.dirName(dirName)}${' '.repeat(Math.max(0, dirNameWidth - dirName.length))}`;
  const hashLength = MIGRATION_LIST_HASH_WIDTH;
  const emptySource = palette.emptySource;
  const fromAbbr =
    from === EMPTY_CONTRACT_HASH
      ? padFromHashColumn(style.glyph(emptySource), hashLength)
      : padFromHashColumn(style.sourceHash(abbreviateHashShort(from, hashLength)), hashLength);
  const toAbbr =
    to === EMPTY_CONTRACT_HASH
      ? style.glyph(emptySource)
      : style.destHash(abbreviateHashShort(to, hashLength));
  const arrow = style.glyph(palette.forwardArrow);
  return `${styledDirName}  ${fromAbbr} ${arrow} ${toAbbr}`;
}

function abbreviateHashShort(hash: string, length: number): string {
  const stripped = hash.startsWith('sha256:') ? hash.slice(7) : hash;
  return stripped.slice(0, length);
}

export interface RenderMigrationGraphLegendOptions {
  readonly colorize: boolean;
  readonly glyphMode?: GlyphMode;
}

function formatLegendExampleMarkers(colorize: boolean): string {
  if (!colorize) {
    return '@contract @db';
  }
  const sigil = green('@');
  return `${sigil + bold(green('contract'))} ${sigil}${green('db')}`;
}

/**
 * A compact key for the tree visual language: the contract node glyph, the
 * in-lane direction arrows, the empty baseline, the system-marker `<…>` and
 * user-ref `(…)` bracket conventions (two illustrative example lines), and a
 * worked sample of the data-column `from → to` migration hash arrow.
 *
 * Honors the same glyph palette (unicode vs ASCII) and `colorize` gate as the
 * tree renderer, so the key matches whatever the graph itself drew and stays
 * pipe-safe (zero ANSI when color is off). The caller adds the trailing blank
 * line that separates this stderr key from the tree on stdout.
 */
export function renderMigrationGraphLegend(opts: RenderMigrationGraphLegendOptions): string {
  const palette = paletteFor(opts.glyphMode ?? 'unicode');
  const style = createAnsiMigrationListStyler({ useColor: opts.colorize });
  const node = palette.node.trimEnd();
  const sampleArrow = `${style.sourceHash('aaaaaa')} ${style.glyph(palette.forwardArrow)} ${style.destHash('bbbbbb')}`;
  const statusGlyphs = overlayStatusGlyphs(opts.glyphMode ?? 'unicode');
  const appliedPending = opts.colorize
    ? `  ${green(statusGlyphs.applied)} ${style.summary('applied')}   ${yellow(statusGlyphs.pending)} ${style.summary('pending')}`
    : `  ${statusGlyphs.applied} ${style.summary('applied')}   ${statusGlyphs.pending} ${style.summary('pending')}`;
  const exampleMarkers = formatLegendExampleMarkers(opts.colorize);
  const exampleRefs = opts.colorize ? style.refs(['prod', 'staging']) : '(prod, staging)';
  const lines = [
    'Legend:',
    `  ${style.kind(node)} ${style.summary('contract')}   ${style.kind(palette.edgeArrow.forward)} ${style.summary('forward')}   ${style.kind(palette.edgeArrow.rollback)} ${style.summary('rollback')}`,
    `  ${style.kind(palette.edgeArrow.self)} ${style.summary('migration without schema change')}`,
    appliedPending,
    `  ${style.kind(palette.emptySource)} ${style.summary('empty database (baseline)')}`,
    `  ${exampleMarkers} ${style.summary('reserved markers — also typeable as --from/--to tokens')}`,
    `  ${exampleRefs} ${style.summary('user-defined refs')}`,
    `  ${sampleArrow}   ${style.summary('migration from contract aaaaaa to bbbbbb')}`,
  ];
  return lines.join('\n');
}
