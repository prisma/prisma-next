import { EMPTY_CONTRACT_HASH } from '@prisma-next/migration-tools/constants';
import { bold } from 'colorette';
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

export interface RenderMigrationGraphTreeOptions {
  readonly refsByHash?: ReadonlyMap<string, readonly string[]>;
  readonly dbHash?: string;
  readonly contractHash?: string;
  readonly activeRefName?: string;
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
 * A node-marker glyph pair (`○◂`, `○─`, `*<`, `*-`) is the contract node
 * marker (`○` / `*`) followed by an arc connector (`◂` / `─` / `<` / `-`).
 * The marker is the signal and stays bright (`style.kind`); the connector is
 * gutter and stays dim (`style.lane`) — consistent with the plain node marker,
 * which is never dimmed.
 */
function laneStyler(
  column: number,
  colorize: boolean,
  style: MigrationListStyler,
): (text: string) => string {
  if (!colorize) {
    return (text) => style.lane(text);
  }
  return laneColorForColumn(column);
}

function renderNodeMarkerPair(
  pair: string,
  column: number,
  colorize: boolean,
  style: MigrationListStyler,
): string {
  const lane = laneStyler(column, colorize, style);
  return style.kind(pair.slice(0, 1)) + lane(pair.slice(1));
}

function renderCellPair(
  cell: StructuralCell,
  column: number,
  colorize: boolean,
  style: MigrationListStyler,
  palette: MigrationGraphTreeGlyphPalette,
): string {
  const lane = laneStyler(column, colorize, style);
  switch (cell.kind) {
    case 'node':
      if (cell.arcLand === true) {
        return renderNodeMarkerPair(palette.arcLand, column, colorize, style);
      }
      if (cell.arcTee === true) {
        return renderNodeMarkerPair(palette.arcTee, column, colorize, style);
      }
      return style.kind(palette.node);
    case 'vertical-pass':
      return lane(palette.verticalPass);
    case 'edge-lane':
      return cell.ownsLabel
        ? lane(palette.verticalPass.trimEnd()) +
            style.kind(arrowForEdgeKind(cell.edgeKind, palette))
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
      return lane(palette.arcCrossing);
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
    let seenTee = false;
    let out = '';
    for (let column = 0; column < row.cells.length; column++) {
      const cell = row.cells[column];
      if (cell === undefined) continue;
      const lane = laneStyler(column, colorize, style);
      switch (cell.kind) {
        case 'branch-tee':
          out += lane(seenTee ? palette.connectorBranchTeeCo : palette.connectorBranchTee);
          seenTee = true;
          break;
        case 'merge-tee':
          out += lane(seenTee ? palette.connectorMergeTeeCo : palette.connectorBranchTee);
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
  let out = '';
  for (let column = 0; column < gridWidth; column++) {
    const lane = laneStyler(column, colorize, style);
    if (column < start || column > end) out += '  ';
    else if (column === start) out += lane(palette.connectorBranchTee);
    else if (column === end) out += lane(isMerge ? palette.mergeCorner : palette.branchCorner);
    else out += lane(isMerge ? palette.connectorMergeTeeCo : palette.connectorBranchTeeCo);
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

    let gutter = row.cells
      .map((cell, column) => renderCellPair(cell, column, opts.colorize, style, palette))
      .join('');
    const prevRow = model.rows[rowIndex - 1];
    let laneSpan = row.cells.length;
    if (row.kind === 'node') {
      const contractHash = row.contractHash ?? EMPTY_CONTRACT_HASH;
      if (prevRow?.kind === 'merge-connector' || contractHash === EMPTY_CONTRACT_HASH) {
        laneSpan = 1;
      } else {
        laneSpan = row.cells.length;
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
        .map((cell, column) => renderCellPair(cell, column, opts.colorize, style, palette))
        .join('');
    } else if (row.kind === 'node' && laneSpan < row.cells.length && !nodeHasArcDecoration(row)) {
      gutter = row.cells
        .slice(0, laneSpan)
        .map((cell, column) => renderCellPair(cell, column, opts.colorize, style, palette))
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
          .map((cell, offset) => renderCellPair(cell, offset + 1, opts.colorize, style, palette))
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
    const dirName = `${style.dirName(edge.dirName)}${dirNamePadding}`;
    const hashColumn = formatEdgeHashColumn(edge, style, hashLength, palette);
    lines.push(trimTrailingWhitespace(`${gutterPad}${dirName}${hashColumn}`));
  }

  return lines.join('\n');
}
