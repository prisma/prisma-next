import type {
  ConnectorLayoutRow,
  LayoutRow,
  MigrationLayoutRow,
  MigrationListGraphLayout,
  NodeLineLayoutRow,
} from '@prisma-next/migration-tools/migration-list-graph-layout';
import { computeMigrationListGraphLayout } from '@prisma-next/migration-tools/migration-list-graph-layout';
import type { EdgeKind } from '@prisma-next/migration-tools/migration-list-graph-topology';
import type {
  MigrationListEntry,
  MigrationListResult,
} from '@prisma-next/migration-tools/migration-list-types';
import {
  abbreviateContractHash,
  computeMigrationDirNameWidth,
  formatMigrationDataColumn,
  formatNodeLineDataColumn,
  MIGRATION_LIST_EMPTY_SOURCE,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from './migration-list-data-column';
import type { MigrationListStyler } from './migration-list-render';

export type GlyphMode = 'unicode' | 'ascii';

export interface GlyphModeInput {
  readonly isTTY: boolean;
  readonly env: Readonly<Record<string, string | undefined>>;
}

interface GlyphPalette {
  readonly lane: string;
  readonly node: string;
  readonly forwardArrow: string;
  readonly emptySource: string;
  readonly kind: Record<EdgeKind, string>;
  readonly fanBelow: (branchCount: number) => string;
  readonly joinBelow: (branchCount: number) => string;
}

const UNICODE_PALETTE: GlyphPalette = {
  lane: '│',
  node: 'o',
  forwardArrow: MIGRATION_LIST_FORWARD_EDGE_GLYPH,
  emptySource: MIGRATION_LIST_EMPTY_SOURCE,
  kind: { forward: '*', rollback: '↩', self: '⟲' },
  fanBelow: (branchCount) => (branchCount === 2 ? '├─┐' : '├─┬─┐'),
  joinBelow: (branchCount) => (branchCount === 2 ? '├─┘' : '└─┴─┘'),
};

const ASCII_PALETTE: GlyphPalette = {
  lane: '|',
  node: 'o',
  forwardArrow: '->',
  emptySource: MIGRATION_LIST_EMPTY_SOURCE,
  kind: { forward: '*', rollback: '<', self: '~' },
  fanBelow: (branchCount) => (branchCount === 2 ? '+-\\' : '+-|-\\'),
  joinBelow: (branchCount) => (branchCount === 2 ? '+-/' : '/-+-/'),
};

function paletteFor(mode: GlyphMode): GlyphPalette {
  return mode === 'ascii' ? ASCII_PALETTE : UNICODE_PALETTE;
}

function localeString(env: Readonly<Record<string, string | undefined>>): string {
  return env['LC_ALL'] ?? env['LC_CTYPE'] ?? env['LANG'] ?? '';
}

function isUtf8Locale(env: Readonly<Record<string, string | undefined>>): boolean {
  const locale = localeString(env);
  if (locale.length === 0) return false;
  return /UTF-8|utf8/i.test(locale);
}

export function detectGlyphMode(input: GlyphModeInput): GlyphMode {
  if (!input.isTTY) return 'ascii';
  if (!isUtf8Locale(input.env)) return 'ascii';
  return 'unicode';
}

function migrationEntries(layout: MigrationListGraphLayout) {
  const entries = [];
  for (const row of layout.rows) {
    if (row.kind === 'migration') entries.push(row.entry);
  }
  return entries;
}

function layoutMaxLaneIndex(layout: MigrationListGraphLayout): number {
  let max = 0;
  for (const row of layout.rows) {
    if (row.kind === 'migration') {
      max = Math.max(max, row.laneIndex, ...row.passThroughLanes);
    } else if (row.kind === 'connector') {
      max = Math.max(max, row.endLane);
    } else {
      max = Math.max(max, row.laneIndex);
    }
  }
  return max;
}

function laneCell(glyph: string): string {
  return `${glyph} `;
}

function emptyLaneCell(): string {
  return '  ';
}

function renderMigrationGutter(
  row: MigrationLayoutRow,
  maxLane: number,
  palette: GlyphPalette,
): string {
  const cells: string[] = [];
  for (let lane = 0; lane <= maxLane; lane++) {
    if (lane === row.laneIndex) {
      cells.push(laneCell(palette.kind[row.edgeKind]));
    } else if (row.passThroughLanes.includes(lane)) {
      cells.push(laneCell(palette.lane));
    } else {
      cells.push(emptyLaneCell());
    }
  }
  return cells.join('');
}

function renderNodeLineGutter(
  row: NodeLineLayoutRow,
  openLanes: ReadonlySet<number>,
  maxLane: number,
  palette: GlyphPalette,
): string {
  const cells: string[] = [];
  for (let lane = 0; lane <= maxLane; lane++) {
    if (lane === row.laneIndex) {
      cells.push(laneCell(palette.node));
    } else if (openLanes.has(lane)) {
      cells.push(laneCell(palette.lane));
    } else {
      cells.push(emptyLaneCell());
    }
  }
  return cells.join('');
}

function renderConnectorGutter(
  row: ConnectorLayoutRow,
  openLanes: ReadonlySet<number>,
  maxLane: number,
  palette: GlyphPalette,
): string {
  const spanLaneCount = row.endLane - row.startLane + 1;
  const spanWidth = spanLaneCount * 2;
  let spanGlyph = (
    row.connectorKind === 'fanBelow'
      ? palette.fanBelow(row.branchCount)
      : palette.joinBelow(row.branchCount)
  )
    .padEnd(spanWidth, ' ')
    .slice(0, spanWidth);

  const hasOutsideOpen = [...openLanes].some((lane) => lane < row.startLane || lane > row.endLane);
  if (!hasOutsideOpen && spanGlyph.endsWith(' ')) {
    spanGlyph = spanGlyph.slice(0, -1);
  }

  let gutter = '';
  for (let lane = 0; lane < row.startLane; lane++) {
    gutter += openLanes.has(lane) ? laneCell(palette.lane) : emptyLaneCell();
  }
  gutter += spanGlyph;
  for (let lane = row.endLane + 1; lane <= maxLane; lane++) {
    gutter += openLanes.has(lane) ? laneCell(palette.lane) : emptyLaneCell();
  }
  return gutter;
}

function advanceOpenLanes(row: LayoutRow, openLanes: ReadonlySet<number>): ReadonlySet<number> {
  if (row.kind === 'migration') {
    return new Set([row.laneIndex, ...row.passThroughLanes]);
  }
  if (row.kind === 'connector') {
    if (row.connectorKind === 'fanBelow') {
      const next = new Set(openLanes);
      for (let lane = row.startLane; lane <= row.endLane; lane++) {
        next.add(lane);
      }
      return next;
    }
    const next = new Set(openLanes);
    for (let lane = row.startLane + 1; lane <= row.endLane; lane++) {
      next.delete(lane);
    }
    return next;
  }
  return openLanes;
}

export function renderMigrationListGraphWithStyle(
  layout: MigrationListGraphLayout,
  style: MigrationListStyler,
  glyphMode: GlyphMode,
): string {
  const palette = paletteFor(glyphMode);
  const migrations = migrationEntries(layout);
  const layoutMaxLane = layoutMaxLaneIndex(layout);
  const dirNameWidth = computeMigrationDirNameWidth(migrations);
  const gutterMaxLane = layoutMaxLane;
  const blockDataStart = layoutMaxLane === 0 ? 2 : (layoutMaxLane + 1) * 2 + 2;
  const lines: string[] = [];
  let openLanes: ReadonlySet<number> = new Set();

  function padToDataColumn(gutter: string, dataStart: number): string {
    return gutter + ' '.repeat(Math.max(0, dataStart - gutter.length));
  }

  for (const row of layout.rows) {
    if (row.kind === 'migration') {
      const gutter = renderMigrationGutter(row, gutterMaxLane, palette);
      const data = formatMigrationDataColumn(row.entry, {
        dirNameWidth,
        edgeKind: row.edgeKind,
        style,
        forwardArrow: palette.forwardArrow,
        emptySource: palette.emptySource,
      });
      lines.push(`${padToDataColumn(gutter, blockDataStart)}${data}`);
    } else if (row.kind === 'nodeLine') {
      const gutter = renderNodeLineGutter(row, openLanes, gutterMaxLane, palette);
      const data = formatNodeLineDataColumn(row.contractHash, style);
      lines.push(`${padToDataColumn(gutter, blockDataStart)}${data}`);
    } else {
      lines.push(renderConnectorGutter(row, openLanes, gutterMaxLane, palette));
    }
    openLanes = advanceOpenLanes(row, openLanes);
  }

  return lines.join('\n');
}

export function renderMigrationListGraph(
  layout: MigrationListGraphLayout,
  style: MigrationListStyler,
  glyphMode: GlyphMode,
): string {
  return renderMigrationListGraphWithStyle(layout, style, glyphMode);
}

export function formatGraphNodeLineHash(contractHash: string, style: MigrationListStyler): string {
  return style.sourceHash(abbreviateContractHash(contractHash));
}

function formatGraphEmptyStateLine(spaceId: string, style: MigrationListStyler): string {
  return style.emptyState(`There are no migrations in migrations/${spaceId}/ yet`);
}

function renderGraphSpaceBlock(
  spaceId: string,
  migrations: readonly MigrationListEntry[],
  multiSpace: boolean,
  style: MigrationListStyler,
  glyphMode: GlyphMode,
): readonly string[] {
  if (migrations.length === 0) {
    const emptyLine = formatGraphEmptyStateLine(spaceId, style);
    if (!multiSpace) {
      return [emptyLine];
    }
    return [style.spaceHeading(`${spaceId}:`), `  ${emptyLine}`];
  }

  const layout = computeMigrationListGraphLayout(migrations);
  const graphBody = renderMigrationListGraphWithStyle(layout, style, glyphMode);
  const rows = graphBody.split('\n');
  if (!multiSpace) {
    return rows;
  }
  return [style.spaceHeading(`${spaceId}:`), ...rows.map((row) => `  ${row}`)];
}

export function renderMigrationListGraphResult(
  result: MigrationListResult,
  style: MigrationListStyler,
  glyphMode: GlyphMode,
): string {
  const multiSpace = result.spaces.length > 1;
  const lines: string[] = [];

  for (let index = 0; index < result.spaces.length; index++) {
    const space = result.spaces[index]!;
    if (index > 0) {
      lines.push('');
    }
    lines.push(
      ...renderGraphSpaceBlock(space.spaceId, space.migrations, multiSpace, style, glyphMode),
    );
  }

  const totalMigrations = result.spaces.reduce(
    (count, space) => count + space.migrations.length,
    0,
  );
  if (totalMigrations > 0) {
    lines.push('');
    lines.push(style.summary(result.summary));
  }

  return lines.join('\n');
}
