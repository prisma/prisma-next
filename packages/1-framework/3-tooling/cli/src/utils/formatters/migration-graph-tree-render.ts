import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { bold, createColors, green, yellow } from 'colorette';
import stringWidth from 'string-width';
import type { GlyphMode } from '../glyph-mode';
import { laneColorForColumn } from './migration-graph-lane-colors';
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
} from './migration-list-data-column';
import type { MigrationEdgeKind } from './migration-list-graph-topology';
import type { MigrationListStyler } from './migration-list-render';
import { CONTRACT_MARKER_NAME, createAnsiMigrationListStyler } from './migration-list-styler';

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
}

export interface RenderMigrationGraphTreeOptions {
  readonly refsByHash?: ReadonlyMap<string, readonly string[]>;
  readonly dbHash?: string;
  readonly contractHash?: string;
  readonly activeRefName?: string;
  readonly edgeAnnotationsByHash?: ReadonlyMap<string, MigrationEdgeAnnotation>;
  readonly hashLength?: number;
  readonly colorize: boolean;
  readonly glyphMode?: GlyphMode;
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

function arrowForEdgeKind(
  kind: MigrationEdgeKind,
  palette: MigrationGraphTreeGlyphPalette,
): string {
  return palette.edgeArrow[kind];
}

/**
 * The leftmost lane (column 0) renders with the neutral dim lane style rather
 * than a palette hue — in the common single-lane case it has nothing to be told
 * apart from. Used as the "no owning arc" sentinel during colour resolution.
 */
const NEUTRAL_LANE = 0;

/**
 * Forced bold for branch-coloured names. A branched name pairs its lane hue
 * (also forced, via {@link laneColorForColumn}) with bold; both must emit even
 * when colorette's ambient TTY detection is off, so the colorized branch name
 * is deterministically bold + hue rather than hue-only.
 */
const { bold: forcedBold } = createColors({ useColor: true });

/**
 * The colour-source column for each cell of a row, resolved together because a
 * routed back-arc spans columns and must read as **one hue** rather than a
 * per-column "rainbow". An arc's horizontal bridges, corners, and node-pair
 * connector all take the arc's owning back-lane column (the corner that closes
 * the arc), not the column they pass through.
 */
interface RowLaneColors {
  /** Colour column for a cell's structural glyph (lane / spine / arc body). */
  readonly lane: readonly number[];
  /** Colour column for a node arc-pair's connector half (`◂` / `─`). */
  readonly connector: readonly number[];
}

/**
 * Resolve per-cell colour columns for a row. Scanning right-to-left lets each
 * arc bridge inherit the corner column that closes it (the arc's back-lane), so
 * the whole arc — vertical run (already its own column), horizontal bridges,
 * corners, crossings, and the `◂`/`─` connector — reads as a single continuous
 * hue. A crossing can only be one colour, so rather than leave it dim (wrong for
 * both crossing lines) it takes the arc owning the horizontal run at this row
 * (the nearest corner to its right); the crossed vertical lane is simply
 * occluded at that one cell and reappears on the next row.
 */
function resolveRowLaneColors(cells: readonly StructuralCell[]): RowLaneColors {
  const lane = new Array<number>(cells.length);
  const connector = new Array<number>(cells.length);
  let arcCorner = NEUTRAL_LANE;
  for (let column = cells.length - 1; column >= 0; column--) {
    const cell = cells[column];
    connector[column] = arcCorner;
    switch (cell?.kind) {
      case 'arc-branch-corner':
      case 'arc-land-corner':
        arcCorner = column;
        lane[column] = column;
        break;
      case 'arc-branch-tee':
        // An inner co-sourced arc's own back-lane junction: its vertical run
        // continues below in this column, so it keeps its own column hue.
        lane[column] = column;
        break;
      case 'arc-crossing':
      case 'arc-land-bridge':
        lane[column] = arcCorner;
        break;
      case 'horizontal-pass':
        lane[column] = arcCorner === NEUTRAL_LANE ? column : arcCorner;
        break;
      case 'node':
        lane[column] = column;
        arcCorner = NEUTRAL_LANE;
        break;
      default:
        lane[column] = column;
        arcCorner = NEUTRAL_LANE;
    }
  }
  return { lane, connector };
}

/**
 * Per-cell colour for a forward branch/merge connector row, split into the
 * cell's junction `glyph` and its trailing `dash`. A connector's horizontal run
 * is one logical line (a fork into new lanes, or a merge into a surviving lane)
 * and reads best as the colour of the lane each segment serves — not dim-gray
 * or a per-pass-through-column "rainbow".
 */
interface ConnectorLaneColors {
  /** Colour column for a cell's junction glyph (`├` / `┬` / `┴` / `╮` / `╯`). */
  readonly glyph: readonly number[];
  /** Colour column for a tee's trailing `─` — the branch it leads into. */
  readonly dash: readonly number[];
}

/**
 * Resolve per-cell connector colours. Scanning right-to-left, a corner or an
 * intermediate tee anchors its own lane (its junction glyph takes that column),
 * but a tee's **trailing dash leads into the branch on its right** (the next
 * branch point), so `┬─` reads as "this lane, then on toward the next" rather
 * than tinting the dash with the left lane. The leading tee at `startLane` (the
 * fork/merge origin) and pure horizontal segments inherit the nearest branch
 * point to their right whole-cell, so the run into a branch — or collapsing
 * into a merge corner — stays continuous. Pass-through verticals outside the
 * run keep their own column (column 0 stays neutral).
 */
function resolveConnectorLaneColors(
  cells: readonly StructuralCell[],
  startLane: number,
): ConnectorLaneColors {
  const glyph = new Array<number>(cells.length);
  const dash = new Array<number>(cells.length);
  let owner = NEUTRAL_LANE;
  for (let column = cells.length - 1; column >= 0; column--) {
    const cell = cells[column];
    switch (cell?.kind) {
      case 'branch-corner':
      case 'merge-corner':
        owner = column;
        glyph[column] = column;
        dash[column] = column;
        break;
      case 'branch-tee':
      case 'merge-tee':
        if (column === startLane) {
          const served = owner === NEUTRAL_LANE ? column : owner;
          glyph[column] = column;
          dash[column] = served;
        } else {
          dash[column] = owner === NEUTRAL_LANE ? column : owner;
          glyph[column] = column;
          owner = column;
        }
        break;
      case 'arc-crossing':
        glyph[column] = column;
        dash[column] = column;
        break;
      case 'horizontal-pass': {
        const served = owner === NEUTRAL_LANE ? column : owner;
        glyph[column] = served;
        dash[column] = served;
        break;
      }
      default:
        glyph[column] = column;
        dash[column] = column;
    }
  }
  return { glyph, dash };
}

/**
 * Style a structural glyph by its resolved colour column. Column 0 and the
 * neutral sentinel render dim (`style.lane`); columns ≥ 1 take a palette hue.
 */
function laneStylerForColumn(
  colorColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
): (text: string) => string {
  if (!colorize || colorColumn <= NEUTRAL_LANE) {
    return (text) => style.lane(text);
  }
  return laneColorForColumn(colorColumn);
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
  if (!colorize || column <= NEUTRAL_LANE) {
    return fallback;
  }
  return laneColorForColumn(column);
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
 */
function renderNodeMarkerPair(
  pair: string,
  nodeColumn: number,
  arcColumn: number,
  colorize: boolean,
  style: MigrationListStyler,
): string {
  const marker = laneStylerForColumn(nodeColumn, colorize, style);
  const connector = laneStylerForColumn(arcColumn, colorize, style);
  return marker(pair.slice(0, 1)) + connector(pair.slice(1));
}

function renderCellPair(
  cell: StructuralCell,
  column: number,
  colors: RowLaneColors,
  colorize: boolean,
  style: MigrationListStyler,
  palette: MigrationGraphTreeGlyphPalette,
): string {
  const laneColumn = colors.lane[column] ?? column;
  const lane = laneStylerForColumn(laneColumn, colorize, style);
  switch (cell.kind) {
    case 'node': {
      const arcColumn = colors.connector[column] ?? NEUTRAL_LANE;
      if (cell.arcLand === true) {
        return renderNodeMarkerPair(palette.arcLand, column, arcColumn, colorize, style);
      }
      if (cell.arcTee === true) {
        return renderNodeMarkerPair(palette.arcTee, column, arcColumn, colorize, style);
      }
      return lane(palette.node);
    }
    case 'vertical-pass':
      return lane(palette.verticalPass);
    case 'edge-lane':
      return cell.ownsLabel
        ? lane(palette.verticalPass.trimEnd()) +
            branchStylerOrDefault(
              column,
              colorize,
              style.kind,
            )(arrowForEdgeKind(cell.edgeKind, palette))
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

function renderConnectorRow(
  row: MigrationGraphGridRow,
  gridWidth: number,
  colorize: boolean,
  style: MigrationListStyler,
  palette: MigrationGraphTreeGlyphPalette,
): string {
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
          out += renderConnectorTee(palette.arcCrossing, glyphColumn, dashColumn, colorize, style);
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
  const runLane = laneStylerForColumn(end, colorize, style);
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

function overlayNamesForContract(
  contractHash: string,
  opts: RenderMigrationGraphTreeOptions,
): readonly string[] {
  const names: string[] = [];
  const userRefs = opts.refsByHash?.get(contractHash);
  if (userRefs) {
    names.push(...[...userRefs].sort((a, b) => a.localeCompare(b)));
  }
  if (opts.dbHash === contractHash) {
    names.push(DB_MARKER_NAME);
  }
  if (opts.contractHash === contractHash && contractHash !== EMPTY_CONTRACT_HASH) {
    names.push(CONTRACT_MARKER_NAME);
  }
  return names;
}

function createTreeStyler(opts: RenderMigrationGraphTreeOptions): MigrationListStyler {
  const base = createAnsiMigrationListStyler({ useColor: opts.colorize });
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

function formatEdgeStatusSuffix(
  migrationHash: string,
  opts: RenderMigrationGraphTreeOptions,
): string {
  const annotation = opts.edgeAnnotationsByHash?.get(migrationHash);
  const status = annotation?.status;
  if (status === undefined) {
    return '';
  }
  const glyph = status === 'applied' ? '✓' : '⧗';
  const label = status === 'applied' ? 'applied' : 'pending';
  if (!opts.colorize) {
    return `   ${glyph} ${label}`;
  }
  const styler = status === 'applied' ? green : yellow;
  return `   ${styler(`${glyph} ${label}`)}`;
}

function formatEdgeHashColumn(
  edge: ClassifiedEdge,
  style: MigrationListStyler,
  hashLength: number,
  palette: MigrationGraphTreeGlyphPalette,
): string {
  if (edge.kind === 'self') {
    const hash = abbreviateHash(edge.from, hashLength, palette.emptySource);
    return `${style.sourceHash(hash)} ${style.glyph(palette.forwardArrow)} ${style.destHash(hash)}`;
  }
  const source =
    edge.from === EMPTY_CONTRACT_HASH
      ? style.glyph(palette.emptySource) +
        ' '.repeat(Math.max(0, hashLength - palette.emptySource.length))
      : style.sourceHash(abbreviateHash(edge.from, hashLength, palette.emptySource));
  const arrow = style.glyph(palette.forwardArrow);
  const dest = style.destHash(abbreviateHash(edge.to, hashLength, palette.emptySource));
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

  const lines: string[] = [];

  for (let rowIndex = 0; rowIndex < model.rows.length; rowIndex++) {
    const row = model.rows[rowIndex];
    if (row === undefined) continue;

    if (row.kind === 'component-separator') {
      lines.push('');
      continue;
    }

    if (row.kind === 'branch-connector' || row.kind === 'merge-connector') {
      lines.push(
        trimTrailingWhitespace(renderConnectorRow(row, gridWidth, opts.colorize, style, palette)),
      );
      continue;
    }

    const cellColors = resolveRowLaneColors(row.cells);
    let gutter = row.cells
      .map((cell, column) =>
        renderCellPair(cell, column, cellColors, opts.colorize, style, palette),
      )
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
        ? edgeLabelColumn(row, wideLabelColumn)
        : wideLabelColumn !== undefined &&
            (nodeHasArcDecoration(row) || row.contractHash !== undefined)
          ? wideLabelColumn
          : laneSpan * 2 + LABEL_GAP;
    if (
      row.kind === 'edge' &&
      row.edge?.from === EMPTY_CONTRACT_HASH &&
      (row.laneIndex ?? 0) === 0
    ) {
      gutter = row.cells
        .slice(0, 1)
        .map((cell, column) =>
          renderCellPair(cell, column, cellColors, opts.colorize, style, palette),
        )
        .join('');
    } else if (row.kind === 'node' && laneSpan < row.cells.length && !nodeHasArcDecoration(row)) {
      gutter = row.cells
        .slice(0, laneSpan)
        .map((cell, column) =>
          renderCellPair(cell, column, cellColors, opts.colorize, style, palette),
        )
        .join('');
    } else if (gutter.length < laneSpan * 2) {
      gutter = gutter.padEnd(laneSpan * 2, ' ');
    }
    const dirNameWidth = rowDirNameWidth(labelColumn, maxDirNameLen, dirNameGap);
    const dataColumn = labelColumn + dirNameWidth;
    const gutterPad = padVisible(gutter, labelColumn);

    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      if (contractHash === EMPTY_CONTRACT_HASH) {
        const trailingLanes = row.cells
          .slice(1)
          .map((cell, offset) =>
            renderCellPair(cell, offset + 1, cellColors, opts.colorize, style, palette),
          )
          .join('');
        const emptyGutter = palette.emptySource.padEnd(2, ' ') + trailingLanes;
        const overlayNames = overlayNamesForContract(contractHash, opts);
        if (overlayNames.length === 0) {
          lines.push(trimTrailingWhitespace(emptyGutter));
          continue;
        }
        const overlay = style.refs(overlayNames);
        lines.push(trimTrailingWhitespace(`${padVisible(emptyGutter, dataColumn)}${overlay}`));
        continue;
      }
      const hashText = style.sourceHash(
        abbreviateHash(contractHash, hashLength, palette.emptySource),
      );
      const overlayNames = overlayNamesForContract(contractHash, opts);
      const overlayPad =
        overlayNames.length > 0
          ? ' '.repeat(Math.max(0, dataColumn - labelColumn - stringWidth(hashText)))
          : '';
      const overlay = overlayNames.length > 0 ? style.refs(overlayNames) : '';
      lines.push(trimTrailingWhitespace(`${gutterPad}${hashText}${overlayPad}${overlay}`));
      continue;
    }

    const edge = row.edge;
    if (edge === undefined) continue;

    const dirNamePadding = ' '.repeat(Math.max(0, dirNameWidth - edge.dirName.length));
    const laneIndex = row.laneIndex ?? 0;
    // A branched name keeps its bold (via `style.dirName`) and adds the lane
    // hue, so it reads as one with its lane/arrow; column-0 names stay bold-only.
    const dirNameStyler =
      opts.colorize && laneIndex > NEUTRAL_LANE
        ? (text: string) => forcedBold(laneColorForColumn(laneIndex)(text))
        : style.dirName;
    const dirName = `${dirNameStyler(edge.dirName)}${dirNamePadding}`;
    const hashColumn = formatEdgeHashColumn(edge, style, hashLength, palette);
    const statusSuffix = formatEdgeStatusSuffix(edge.migrationHash, opts);
    lines.push(trimTrailingWhitespace(`${gutterPad}${dirName}${hashColumn}${statusSuffix}`));
  }

  return lines.join('\n');
}

export interface RenderMigrationGraphLegendOptions {
  readonly colorize: boolean;
  readonly glyphMode?: GlyphMode;
}

/**
 * A compact key for the `--tree` visual language: the contract marker, the
 * in-lane direction arrows, the empty baseline, the `(refs)` overlay (including
 * the reserved `db` live-database and `contract` working-schema markers), and a
 * worked sample of the data-column `from → to` migration hash arrow.
 *
 * Honors the same glyph palette (unicode vs ASCII) and `colorize` gate as the
 * tree renderer, so the key matches whatever the graph itself drew and stays
 * pipe-safe (zero ANSI when color is off). The caller adds the trailing blank
 * line that separates this stderr key from the graph on stdout.
 */
export function renderMigrationGraphLegend(opts: RenderMigrationGraphLegendOptions): string {
  const palette = paletteFor(opts.glyphMode ?? 'unicode');
  const style = createAnsiMigrationListStyler({ useColor: opts.colorize });
  const node = palette.node.trimEnd();
  const sampleArrow = `${style.sourceHash('aaaaaa')} ${style.glyph(palette.forwardArrow)} ${style.destHash('bbbbbb')}`;
  return [
    'Legend:',
    `  ${style.kind(node)} contract   ${style.kind(palette.edgeArrow.forward)} forward   ${style.kind(palette.edgeArrow.rollback)} rollback`,
    `  ${style.kind(palette.edgeArrow.self)} migration without schema change`,
    `  ${green('✓')} applied   ${yellow('⧗')} pending`,
    `  ${style.glyph(palette.emptySource)} empty database (baseline)`,
    `  ${style.refs(['refs'])} ${DB_MARKER_NAME} / ${CONTRACT_MARKER_NAME} markers`,
    `  ${sampleArrow}   migration from contract aaaaaa to bbbbbb`,
  ].join('\n');
}
