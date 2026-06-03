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

  const appliedAtWidth = columnWidth(rows.map((row) => row.appliedAt));
  const spaceWidth = showSpace ? columnWidth(rows.map((row) => row.space)) : 0;
  const nameWidth = columnWidth(rows.map((row) => row.migrationName));
  const transitionWidth = columnWidth(rows.map((row) => row.transition));
  const opsWidth = columnWidth(rows.map((row) => row.ops));

  return rows
    .map((row) => {
      const appliedAt =
        styler.sourceHash(row.appliedAt) + ' '.repeat(appliedAtWidth - row.appliedAt.length);
      const parts = [appliedAt];
      if (showSpace) {
        parts.push(styler.summary(row.space) + ' '.repeat(spaceWidth - row.space.length));
      }
      parts.push(
        styler.dirName(row.migrationName) + ' '.repeat(nameWidth - row.migrationName.length),
        padVisible(styleHashTransition(row.from, row.to, styler), transitionWidth),
        ' '.repeat(opsWidth - row.ops.length) + styler.summary(row.ops),
      );
      return parts.join('   ');
    })
    .join('\n');
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
