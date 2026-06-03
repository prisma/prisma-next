import type { LedgerEntryRecord } from '@prisma-next/contract/types';
import stringWidth from 'string-width';
import {
  abbreviateContractHash,
  MIGRATION_LIST_EMPTY_SOURCE,
  MIGRATION_LIST_FORWARD_EDGE_GLYPH,
} from './migration-list-data-column';
import { IDENTITY_MIGRATION_LIST_STYLER, type MigrationListStyler } from './migration-list-render';

export type LedgerTimestampMode = 'local' | 'utc' | 'iso';

export interface RenderMigrationLogTableOptions {
  readonly utc?: boolean;
  readonly styler?: MigrationListStyler;
}

export interface SerializedLedgerEntryRecord {
  readonly space: string;
  readonly migrationName: string;
  readonly migrationHash: string;
  readonly from: string | null;
  readonly to: string;
  readonly appliedAt: string;
  readonly operationCount: number;
}

const HEADING_APPLIED_AT = 'Applied at';
const HEADING_SPACE = 'Space';
const HEADING_MIGRATION = 'Migration';
const HEADING_CHANGE = 'Change';
const HEADING_OPS = 'Ops';
const COLUMN_SEPARATOR = ' ';
const DIVIDER_CHAR = '─';

export function sortLedgerEntries(entries: readonly LedgerEntryRecord[]): LedgerEntryRecord[] {
  return [...entries].sort((left, right) => {
    const timeDiff = left.appliedAt.getTime() - right.appliedAt.getTime();
    if (timeDiff !== 0) {
      return timeDiff;
    }
    const spaceDiff = left.space.localeCompare(right.space);
    if (spaceDiff !== 0) {
      return spaceDiff;
    }
    return left.migrationName.localeCompare(right.migrationName);
  });
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatLedgerAppliedAt(date: Date, mode: LedgerTimestampMode): string {
  if (mode === 'iso') {
    return date.toISOString();
  }
  if (mode === 'utc') {
    return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}Z`;
  }
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absoluteOffset = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absoluteOffset / 60));
  const offsetMins = pad2(absoluteOffset % 60);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${sign}${offsetHours}:${offsetMins}`;
}

export function formatHashEndpoint(hash: string | null): string {
  if (hash === null) {
    return MIGRATION_LIST_EMPTY_SOURCE;
  }
  return abbreviateContractHash(hash);
}

export function formatHashTransition(from: string | null, to: string): string {
  return `${formatHashEndpoint(from)} ${MIGRATION_LIST_FORWARD_EDGE_GLYPH} ${abbreviateContractHash(to)}`;
}

export function styleHashTransition(
  from: string | null,
  to: string,
  styler: MigrationListStyler,
): string {
  const fromPart =
    from === null
      ? styler.glyph(MIGRATION_LIST_EMPTY_SOURCE)
      : styler.sourceHash(abbreviateContractHash(from));
  const arrow = styler.glyph(MIGRATION_LIST_FORWARD_EDGE_GLYPH);
  const dest = styler.destHash(abbreviateContractHash(to));
  return `${fromPart} ${arrow} ${dest}`;
}

function padVisible(text: string, targetWidth: number): string {
  const padding = Math.max(0, targetWidth - stringWidth(text));
  return text + ' '.repeat(padding);
}

function columnWidth(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), 0);
}

function padDividerCell(width: number): string {
  return DIVIDER_CHAR.repeat(width);
}

function textCellWidth(valueWidth: number): number {
  return valueWidth + 1;
}

function padTextCell(value: string, valueWidth: number): string {
  return padVisible(` ${value}`, textCellWidth(valueWidth));
}

function padOpsCell(value: string, valueWidth: number): string {
  const cellWidth = textCellWidth(valueWidth);
  return ' '.repeat(Math.max(0, cellWidth - value.length)) + value;
}

export function renderMigrationLogTable(
  entries: readonly LedgerEntryRecord[],
  options: RenderMigrationLogTableOptions = {},
): string {
  const sorted = sortLedgerEntries(entries);
  if (sorted.length === 0) {
    return '';
  }

  const styler = options.styler ?? IDENTITY_MIGRATION_LIST_STYLER;
  const showSpace = new Set(sorted.map((entry) => entry.space)).size > 1;
  const timestampMode: LedgerTimestampMode = options.utc ? 'utc' : 'local';
  const rows = sorted.map((entry) => ({
    appliedAt: formatLedgerAppliedAt(entry.appliedAt, timestampMode),
    space: entry.space,
    migrationName: entry.migrationName,
    transition: formatHashTransition(entry.from, entry.to),
    ops: `${entry.operationCount} ops`,
    from: entry.from,
    to: entry.to,
  }));

  const appliedAtWidth = columnWidth([HEADING_APPLIED_AT, ...rows.map((row) => row.appliedAt)]);
  const spaceWidth = showSpace ? columnWidth([HEADING_SPACE, ...rows.map((row) => row.space)]) : 0;
  const nameWidth = columnWidth([HEADING_MIGRATION, ...rows.map((row) => row.migrationName)]);
  const transitionWidth = columnWidth([HEADING_CHANGE, ...rows.map((row) => row.transition)]);
  const opsWidth = columnWidth([HEADING_OPS, ...rows.map((row) => row.ops)]);

  const headingParts = [padTextCell(HEADING_APPLIED_AT, appliedAtWidth)];
  if (showSpace) {
    headingParts.push(padTextCell(HEADING_SPACE, spaceWidth));
  }
  headingParts.push(
    padTextCell(HEADING_MIGRATION, nameWidth),
    padTextCell(HEADING_CHANGE, transitionWidth),
    padOpsCell(HEADING_OPS, opsWidth),
  );
  const heading = headingParts.join(COLUMN_SEPARATOR);

  const dividerParts = [padDividerCell(textCellWidth(appliedAtWidth))];
  if (showSpace) {
    dividerParts.push(padDividerCell(textCellWidth(spaceWidth)));
  }
  dividerParts.push(
    padDividerCell(textCellWidth(nameWidth)),
    padDividerCell(textCellWidth(transitionWidth)),
    padDividerCell(textCellWidth(opsWidth)),
  );
  const divider = dividerParts.map((cell) => styler.summary(cell)).join(COLUMN_SEPARATOR);

  const dataRows = rows.map((row) => {
    const parts = [padTextCell(row.appliedAt, appliedAtWidth)];
    if (showSpace) {
      parts.push(padTextCell(row.space, spaceWidth));
    }
    parts.push(
      padTextCell(styler.dirName(row.migrationName), nameWidth),
      padTextCell(styleHashTransition(row.from, row.to, styler), transitionWidth),
      padOpsCell(row.ops, opsWidth),
    );
    return parts.join(COLUMN_SEPARATOR);
  });

  return [heading, divider, ...dataRows].join('\n');
}

export function serializeLedgerEntriesForJson(
  entries: readonly LedgerEntryRecord[],
): SerializedLedgerEntryRecord[] {
  return sortLedgerEntries(entries).map(({ appliedAt, ...rest }) => ({
    ...rest,
    appliedAt: formatLedgerAppliedAt(appliedAt, 'iso'),
  }));
}

export const MIGRATION_LOG_EMPTY_MESSAGE = 'No migrations have been applied to this database.';
